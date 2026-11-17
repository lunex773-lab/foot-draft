import { Hono } from 'hono';
import { audit, ipOf } from '../lib/audit';
import { can, requirePermission } from '../lib/auth';
import { walletOf } from '../lib/economy';
import { membershipOf } from '../lib/purchases';
import { ApiError, readJson } from '../lib/http';
import { USER_TAGS } from '../lib/metrics';
import type { AppEnv } from '../env';

/** Users (spec 12-4, 15-1): search, details, tags, suspension. */
export const adminUserRoutes = new Hono<AppEnv>();

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  status: 'active' | 'suspended';
  created_at: number;
  last_login_at: number | null;
  tags: string | null;
  last_active: string | null;
}

const USER_SELECT = `SELECT u.id, u.username, u.display_name, u.status, u.created_at, u.last_login_at,
       (SELECT group_concat(tag) FROM user_tags t WHERE t.user_id = u.id) AS tags,
       (SELECT MAX(day_key) FROM daily_user_metrics m WHERE m.user_id = u.id) AS last_active
  FROM users u`;

const view = (r: UserRow) => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  status: r.status,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
  lastActiveDay: r.last_active,
  tags: r.tags ? r.tags.split(',') : [],
});

adminUserRoutes.get('/users', requirePermission('users.read'), async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const binds: unknown[] = [];
  const text = (q.q ?? '').trim();
  if (text) {
    where.push('(u.id = ? OR u.username LIKE ? OR u.display_name LIKE ?)');
    binds.push(text, `%${text}%`, `%${text}%`);
  }
  if (q.tag) {
    if (!(USER_TAGS as readonly string[]).includes(q.tag)) throw new ApiError('BAD_REQUEST', 'unknown tag');
    where.push('u.id IN (SELECT user_id FROM user_tags WHERE tag = ?)');
    binds.push(q.tag);
  }
  if (q.status === 'active' || q.status === 'suspended') {
    where.push('u.status = ?');
    binds.push(q.status);
  }
  if (q.registeredFrom) {
    where.push('u.created_at >= ?');
    binds.push(Number(q.registeredFrom) || 0);
  }
  const sort = q.sort === 'last_login' ? 'u.last_login_at DESC' : q.sort === 'username' ? 'u.username ASC' : 'u.created_at DESC';
  const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
  const sqlWhere = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const rows = await c.env.DB.prepare(`${USER_SELECT}${sqlWhere} ORDER BY ${sort} LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all<UserRow>();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users u${sqlWhere}`).bind(...binds).first<{ n: number }>();
  return c.json({ items: rows.results.map(view), total: total?.n ?? 0, limit, offset });
});

adminUserRoutes.get('/users/:id', requirePermission('users.read'), async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(`${USER_SELECT} WHERE u.id = ? OR u.username = ?`).bind(id, id).first<UserRow>();
  if (!row) throw new ApiError('NOT_FOUND', 'player not found');
  const uid = row.id;
  const admin = c.get('admin');
  const [logins, leagues, matches, drafts, collection, feedback] = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT event_name, timestamp, platform, app_version FROM analytics_events WHERE user_id = ? AND event_name IN ('login_succeeded', 'session_started', 'login_failed') ORDER BY timestamp DESC LIMIT 30",
    ).bind(uid),
    c.env.DB.prepare(
      `SELECT r.id AS room_id, r.mode, r.status, r.created_at, r.finished_at, rm.final_rank, rm.points
         FROM room_members rm JOIN rooms r ON r.id = rm.room_id WHERE rm.user_id = ? ORDER BY r.created_at DESC LIMIT 30`,
    ).bind(uid),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS played,
              SUM(CASE WHEN (m.home_user_id = ?1 AND res.home_goals > res.away_goals) OR (m.away_user_id = ?1 AND res.away_goals > res.home_goals) THEN 1 ELSE 0 END) AS won,
              SUM(CASE WHEN res.home_goals = res.away_goals THEN 1 ELSE 0 END) AS drawn
         FROM matches m JOIN match_results res ON res.match_id = m.id
        WHERE (m.home_user_id = ?1 OR m.away_user_id = ?1) AND m.status = 'completed'`,
    ).bind(uid),
    c.env.DB.prepare(
      `SELECT d.id AS draft_id, d.room_id, d.started_at, COUNT(p.pick_no) AS picks, SUM(p.is_auto) AS auto_picks
         FROM legacy_draft_picks p JOIN legacy_drafts d ON d.id = p.draft_id WHERE p.user_id = ? GROUP BY d.id ORDER BY d.started_at DESC LIMIT 20`,
    ).bind(uid),
    c.env.DB.prepare(
      'SELECT c.player_id, p.name, p.rarity, c.source, c.obtained_at FROM user_collections c JOIN player_cards p ON p.id = c.player_id WHERE c.user_id = ? ORDER BY c.obtained_at DESC',
    ).bind(uid),
    c.env.DB.prepare('SELECT id, category, subject, status, priority, created_at FROM feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').bind(uid),
  ]);
  const leaguesPlayed = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n, SUM(CASE WHEN rm.final_rank = 1 THEN 1 ELSE 0 END) AS wins FROM room_members rm JOIN rooms r ON r.id = rm.room_id WHERE rm.user_id = ? AND r.status = 'finished'",
  )
    .bind(uid)
    .first<{ n: number; wins: number | null }>();
  const m = (matches.results[0] ?? {}) as { played?: number; won?: number; drawn?: number };
  // balances and ledgers: users.wallet (support can read, viewer cannot reach this endpoint at all)
  let economy: unknown = null;
  if (can(admin.role, 'users.wallet')) {
    const [ledger, gacha] = await c.env.DB.batch([
      c.env.DB.prepare('SELECT currency, amount, balance_after, reason, ref_type, ref_id, created_at FROM currency_transactions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50').bind(uid),
      c.env.DB.prepare(
        `SELECT h.draw_id, h.idx, h.player_id, p.name, h.rarity, h.guarantee, h.is_free, h.is_duplicate, h.points, h.created_at, d.banner_id
           FROM gacha_history h JOIN gacha_draws d ON d.id = h.draw_id JOIN player_cards p ON p.id = h.player_id WHERE h.user_id = ? ORDER BY h.created_at DESC, h.idx LIMIT 50`,
      ).bind(uid),
    ]);
    economy = { wallet: await walletOf(c.env, uid), ledger: ledger.results, gacha: gacha.results };
  }
  return c.json({
    user: view(row),
    stats: {
      leagues: leaguesPlayed?.n ?? 0,
      leagueWins: leaguesPlayed?.wins ?? 0,
      matches: m.played ?? 0,
      matchWins: m.won ?? 0,
      matchDraws: m.drawn ?? 0,
      winRate: m.played ? (m.won ?? 0) / m.played : null,
    },
    logins: logins.results,
    leagues: leagues.results,
    drafts: drafts.results,
    collection: collection.results,
    feedback: feedback.results,
    economy,
    purchases: can(admin.role, 'purchases.read') || can(admin.role, 'users.wallet')
      ? {
          implemented: true,
          items: (
            await c.env.DB.prepare(
              `SELECT t.id, t.product_id, p.name AS product_name, t.store, t.status, t.price_jpy, t.gems_purchased, t.gems_granted, t.is_renewal, t.created_at, t.completed_at, t.refunded_at
                 FROM purchase_transactions t JOIN purchase_products p ON p.id = t.product_id WHERE t.user_id = ? ORDER BY t.created_at DESC LIMIT 50`,
            )
              .bind(uid)
              .all()
          ).results,
          membership: await membershipOf(c.env, uid),
        }
      : null,
  });
});

/** tags (spec 15-1) and suspension (spec 15-2) */
adminUserRoutes.patch('/users/:id', requirePermission('users.write'), async (c) => {
  const admin = c.get('admin');
  const body = await readJson<{ tags?: unknown; status?: unknown; reason?: unknown }>(c);
  const user = await c.env.DB.prepare('SELECT id, username, status FROM users WHERE id = ?').bind(c.req.param('id')).first<{ id: string; username: string; status: string }>();
  if (!user) throw new ApiError('NOT_FOUND', 'player not found');
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const detail: Record<string, unknown> = { username: user.username };
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.some((t) => !(USER_TAGS as readonly string[]).includes(t as string))) throw new ApiError('BAD_REQUEST', `tags must be some of ${USER_TAGS.join(', ')}`);
    const tags = [...new Set(body.tags as string[])];
    const before = await c.env.DB.prepare('SELECT tag FROM user_tags WHERE user_id = ?').bind(user.id).all<{ tag: string }>();
    detail.tagsBefore = before.results.map((r) => r.tag);
    detail.tagsAfter = tags;
    stmts.push(c.env.DB.prepare('DELETE FROM user_tags WHERE user_id = ?').bind(user.id));
    for (const t of tags) stmts.push(c.env.DB.prepare('INSERT INTO user_tags (user_id, tag, created_at) VALUES (?,?,?)').bind(user.id, t, now));
  }
  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'suspended') throw new ApiError('BAD_REQUEST', 'status must be active or suspended');
    detail.statusBefore = user.status;
    detail.statusAfter = body.status;
    detail.reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : undefined;
    stmts.push(c.env.DB.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').bind(body.status, now, user.id));
    // a suspended player is logged out everywhere
    if (body.status === 'suspended') stmts.push(c.env.DB.prepare('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, user.id));
  }
  if (stmts.length === 0) throw new ApiError('BAD_REQUEST', 'nothing to change');
  await c.env.DB.batch(stmts);
  await audit(c.env, admin.id, body.status !== undefined ? (body.status === 'suspended' ? 'user_suspended' : 'user_reactivated') : 'user_tags_changed', { type: 'user', id: user.id }, detail, ipOf(c));
  const row = await c.env.DB.prepare(`${USER_SELECT} WHERE u.id = ?`).bind(user.id).first<UserRow>();
  return c.json({ user: view(row!) });
});
