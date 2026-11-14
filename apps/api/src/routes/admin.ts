import { CLUB_BY_ID, LEAGUE_BY_ID, NATION_BY_CODE, RARITY_INFO, analyzePool, describeFilter, rarityRank, sanitizeFilter, type Player } from '@fd/shared';
import { Hono } from 'hono';
import { createAdminSession, permissionsOf, requireAdmin, requirePermission } from '../lib/auth';
import { base32Encode, randomBytes, randomId, verifyPassword, verifyTotp } from '../lib/crypto';
import { ApiError, readJson, str } from '../lib/http';
import { loadCatalog } from '../lib/players';
import { ensureCurrentSeason, leaderboard, seasonView } from '../lib/seasons';
import { eventView, type EventRow } from './events';
import type { AppEnv, Env } from '../env';

/**
 * FOOTBALL DRAFT ADMIN API (spec 12 / 18-8). Separate authentication from
 * players; every login and sensitive action is written to admin_audit_logs.
 */
export const adminRoutes = new Hono<AppEnv>();

function audit(env: Env, adminId: string | null, action: string, target: { type?: string; id?: string } = {}, detail?: Record<string, unknown>, ip?: string | null) {
  return env.DB.prepare('INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, detail_json, ip, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(randomId(), adminId, action, target.type ?? null, target.id ?? null, detail ? JSON.stringify(detail) : null, ip ?? null, Date.now())
    .run();
}

const ipOf = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header('CF-Connecting-IP') ?? null;

adminRoutes.post('/auth/login', async (c) => {
  const body = await readJson(c);
  const username = str(body.username, 'username', { max: 40 });
  const password = str(body.password, 'password', { max: 128 });
  const totp = typeof body.totp === 'string' ? body.totp.trim() : '';
  const since = Date.now() - 15 * 60 * 1000;
  const fails = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action = 'login_failed' AND target_id = ? AND created_at > ?")
    .bind(username.toLowerCase(), since)
    .first<{ n: number }>();
  if ((fails?.n ?? 0) >= 5) throw new ApiError('RATE_LIMITED', 'too many failed attempts, try again later');

  const row = await c.env.DB.prepare('SELECT * FROM admin_users WHERE username = ?').bind(username).first<{
    id: string;
    username: string;
    password_hash: string;
    password_salt: string;
    password_iterations: number;
    role: string;
    totp_secret: string | null;
    totp_enabled: number;
    status: string;
  }>();
  const passOk = row ? await verifyPassword(password, row.password_hash, row.password_salt, row.password_iterations) : false;
  const require2fa = c.env.ADMIN_REQUIRE_2FA === 'true';
  let reason: string | null = null;
  if (!row || !passOk || row.status !== 'active') reason = 'invalid_credentials';
  else if (row.totp_enabled && row.totp_secret) {
    if (!totp) {
      await audit(c.env, row.id, 'login_2fa_required', { type: 'admin', id: username.toLowerCase() }, undefined, ipOf(c));
      return c.json({ error: { code: 'TOTP_REQUIRED', message: '2段階認証コードを入力してください' } }, 401);
    }
    if (!(await verifyTotp(row.totp_secret, totp))) reason = 'invalid_totp';
  } else if (require2fa) {
    // first login of an admin without 2FA: enrol an authenticator app now (password already verified).
    // The key is shown only to this admin (never printed by scripts or CI logs).
    let secret = row.totp_secret;
    if (!secret) {
      secret = base32Encode(randomBytes(20));
      await c.env.DB.prepare('UPDATE admin_users SET totp_secret = ?, updated_at = ? WHERE id = ? AND totp_enabled = 0').bind(secret, Date.now(), row.id).run();
      await audit(c.env, row.id, 'totp_setup_started', { type: 'admin', id: row.id }, undefined, ipOf(c));
    }
    if (!totp) {
      const label = encodeURIComponent(`FOOTBALL DRAFT ADMIN (${c.env.ENVIRONMENT}):${row.username}`);
      return c.json(
        {
          error: { code: 'TOTP_SETUP_REQUIRED', message: '2段階認証の設定が必要です' },
          setup: { secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('FOOTBALL DRAFT ADMIN')}` },
        },
        401,
      );
    }
    if (!(await verifyTotp(secret, totp))) reason = 'invalid_totp';
    else {
      await c.env.DB.prepare('UPDATE admin_users SET totp_enabled = 1, updated_at = ? WHERE id = ?').bind(Date.now(), row.id).run();
      await audit(c.env, row.id, 'totp_enrolled', { type: 'admin', id: row.id }, undefined, ipOf(c));
    }
  }
  if (reason) {
    await audit(c.env, row?.id ?? null, 'login_failed', { type: 'admin', id: username.toLowerCase() }, { reason }, ipOf(c));
    throw new ApiError('UNAUTHORIZED', 'invalid credentials');
  }
  await c.env.DB.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?').bind(Date.now(), row!.id).run();
  const token = await createAdminSession(c.env, row!.id, ipOf(c), c.req.header('User-Agent') ?? null);
  await audit(c.env, row!.id, 'login_succeeded', { type: 'admin', id: row!.id }, { totp: !!row!.totp_enabled }, ipOf(c));
  return c.json({ token, admin: { id: row!.id, username: row!.username, role: row!.role } });
});

adminRoutes.use('/*', async (c, next) => {
  if (c.req.path.endsWith('/auth/login')) return next();
  return requireAdmin(c, next);
});

adminRoutes.post('/auth/logout', async (c) => {
  const a = c.get('admin');
  await c.env.DB.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE id = ?').bind(Date.now(), a.sessionId).run();
  await audit(c.env, a.id, 'logout', { type: 'admin', id: a.id }, undefined, ipOf(c));
  return c.json({ ok: true });
});

adminRoutes.get('/auth/me', (c) => {
  const a = c.get('admin');
  return c.json({ admin: { id: a.id, username: a.username, role: a.role, permissions: permissionsOf(a.role) }, environment: c.env.ENVIRONMENT });
});

type SortKey = 'ovr' | 'name' | 'rarity' | 'position' | 'pac' | 'sho' | 'pas' | 'dri' | 'def' | 'phy' | 'id';

/** Card list with filters (spec request: 管理画面でカード一覧を確認). */
adminRoutes.get('/cards', requirePermission('cards.read'), async (c) => {
  const q = c.req.query();
  const all = await loadCatalog(c.env, { fresh: q.fresh === '1' });
  const text = (q.q ?? '').trim().toLowerCase();
  let items = all.filter((p) => {
    if (q.rarity && !q.rarity.split(',').includes(p.rarity)) return false;
    if (q.position && !q.position.split(',').includes(p.primaryPosition)) return false;
    if (q.league && p.leagueId !== q.league) return false;
    if (q.club && p.clubId !== q.club) return false;
    if (q.nation && p.nationality !== q.nation) return false;
    if (q.trait && !p.traits.includes(q.trait as Player['traits'][number])) return false;
    if (q.role && p.role !== q.role) return false;
    if (text && !(`${p.name} ${p.id} ${CLUB_BY_ID[p.clubId]?.name ?? ''} ${NATION_BY_CODE[p.nationality]?.name ?? ''}`.toLowerCase().includes(text))) return false;
    const min = Number(q.minOvr);
    const max = Number(q.maxOvr);
    if (Number.isFinite(min) && q.minOvr && p.ovr < min) return false;
    if (Number.isFinite(max) && q.maxOvr && p.ovr > max) return false;
    return true;
  });
  const sort = (q.sort ?? 'ovr') as SortKey;
  const dir = q.order === 'asc' ? 1 : -1;
  const val = (p: Player): number | string => {
    switch (sort) {
      case 'name':
        return p.name;
      case 'rarity':
        return rarityRank(p.rarity) * 100 + p.ovr;
      case 'position':
        return p.primaryPosition;
      case 'id':
        return p.id;
      case 'ovr':
        return p.ovr;
      default:
        return p.stats[sort];
    }
  };
  items = items.sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return cmp * dir || a.id.localeCompare(b.id);
  });
  const counts: Record<string, number> = {};
  for (const r of Object.keys(RARITY_INFO)) counts[r] = all.filter((p) => p.rarity === r).length;
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 500));
  const offset = Math.max(0, Number(q.offset) || 0);
  return c.json({ total: items.length, catalogTotal: all.length, counts, items: items.slice(offset, offset + limit) });
});

adminRoutes.get('/cards/:id', requirePermission('cards.read'), async (c) => {
  const all = await loadCatalog(c.env);
  const p = all.find((x) => x.id === c.req.param('id'));
  if (!p) throw new ApiError('NOT_FOUND', 'card not found');
  const usage = await c.env.DB.prepare(
    `SELECT COUNT(*) AS picks, SUM(CASE WHEN is_auto = 1 THEN 1 ELSE 0 END) AS auto_picks, AVG(pick_no) AS avg_pick
       FROM draft_picks WHERE player_id = ?`,
  )
    .bind(p.id)
    .first<{ picks: number; auto_picks: number | null; avg_pick: number | null }>();
  return c.json({
    player: p,
    league: LEAGUE_BY_ID[p.leagueId],
    club: CLUB_BY_ID[p.clubId],
    nation: NATION_BY_CODE[p.nationality],
    draftStats: { picks: usage?.picks ?? 0, autoPicks: usage?.auto_picks ?? 0, avgPickNo: usage?.avg_pick ? Math.round(usage.avg_pick * 10) / 10 : null },
  });
});

adminRoutes.get('/audit-logs', requirePermission('audit.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT l.id, l.action, l.target_type, l.target_id, l.detail_json, l.ip, l.created_at, a.username AS admin_username
       FROM admin_audit_logs l LEFT JOIN admin_users a ON a.id = l.admin_id ORDER BY l.created_at DESC LIMIT 200`,
  ).all();
  return c.json({ items: rows.results });
});

// ------------------------------------------------------------------ events

/** Special Events management (decision 28). */
adminRoutes.get('/events', requirePermission('events.read'), async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM events ORDER BY CASE status WHEN \'published\' THEN 0 WHEN \'draft\' THEN 1 ELSE 2 END, starts_at DESC').all<EventRow>();
  const stats = await c.env.DB.prepare(
    `SELECT r.event_id, COUNT(DISTINCT r.id) AS rooms, COUNT(DISTINCT rm.user_id) AS players,
            SUM(CASE WHEN r.status = 'finished' THEN 1 ELSE 0 END) AS finished_rows
       FROM rooms r LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.is_cpu = 0
      WHERE r.event_id IS NOT NULL GROUP BY r.event_id`,
  ).all<{ event_id: string; rooms: number; players: number }>();
  const byEvent = new Map(stats.results.map((x) => [x.event_id, x]));
  const now = Date.now();
  const items = [];
  for (const r of rows.results) {
    const st = byEvent.get(r.id);
    items.push({ ...(await eventView(c.env, r, now)), createdAt: r.created_at, updatedAt: r.updated_at, publishedAt: r.published_at, archivedAt: r.archived_at, rooms: st?.rooms ?? 0, players: st?.players ?? 0 });
  }
  return c.json({ items });
});

interface EventInput {
  name: string;
  description: string;
  startsAt: number;
  endsAt: number;
  filter: ReturnType<typeof sanitizeFilter>;
}

function eventInput(body: Record<string, unknown>): EventInput {
  const name = str(body.name, 'name', { min: 1, max: 60 });
  const description = str(body.description, 'description', { max: 500, optional: true });
  const startsAt = Number(body.startsAt);
  const endsAt = Number(body.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt <= 0) throw new ApiError('BAD_REQUEST', 'startsAt and endsAt are required');
  if (endsAt <= startsAt) throw new ApiError('BAD_REQUEST', 'endsAt must be after startsAt');
  if (endsAt - startsAt > 90 * 24 * 60 * 60 * 1000) throw new ApiError('BAD_REQUEST', 'an event can last at most 90 days');
  return { name, description, startsAt, endsAt, filter: sanitizeFilter(body.filter) };
}

/** Pool preview for the event form: how many players match, whether the rest is filled. */
adminRoutes.post('/events/preview', requirePermission('events.read'), async (c) => {
  const body = await readJson(c);
  const filter = sanitizeFilter(body.filter);
  const catalog = await loadCatalog(c.env);
  return c.json({ filter, conditions: describeFilter(filter), pool: analyzePool(catalog, filter) });
});

adminRoutes.post('/events', requirePermission('events.write'), async (c) => {
  const a = c.get('admin');
  const input = eventInput(await readJson(c));
  const id = `ev-${randomId(8)}`;
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO events (id, name, description, starts_at, ends_at, status, rules_json, created_by, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,'draft',?,?,?,?,?)",
  )
    .bind(id, input.name, input.description, input.startsAt, input.endsAt, JSON.stringify({ pool: input.filter }), a.id, a.id, now, now)
    .run();
  await audit(c.env, a.id, 'event_created', { type: 'event', id }, { name: input.name, startsAt: input.startsAt, endsAt: input.endsAt, filter: input.filter }, ipOf(c));
  return c.json({ id }, 201);
});

async function eventRow(env: Env, id: string): Promise<EventRow> {
  const row = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRow>();
  if (!row) throw new ApiError('NOT_FOUND', 'event not found');
  return row;
}

/** Edit an event. Changes apply to rooms created afterwards; archived events cannot be edited. */
adminRoutes.patch('/events/:id', requirePermission('events.write'), async (c) => {
  const a = c.get('admin');
  const row = await eventRow(c.env, c.req.param('id'));
  if (row.status === 'archived') throw new ApiError('CONFLICT', 'archived events cannot be edited');
  const input = eventInput(await readJson(c));
  await c.env.DB.prepare('UPDATE events SET name = ?, description = ?, starts_at = ?, ends_at = ?, rules_json = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .bind(input.name, input.description, input.startsAt, input.endsAt, JSON.stringify({ pool: input.filter }), a.id, Date.now(), row.id)
    .run();
  await audit(c.env, a.id, 'event_updated', { type: 'event', id: row.id }, { name: input.name, startsAt: input.startsAt, endsAt: input.endsAt, filter: input.filter }, ipOf(c));
  return c.json({ ok: true });
});

adminRoutes.post('/events/:id/publish', requirePermission('events.write'), async (c) => {
  const a = c.get('admin');
  const row = await eventRow(c.env, c.req.param('id'));
  if (row.status !== 'draft') throw new ApiError('CONFLICT', 'only draft events can be published');
  if (row.ends_at <= Date.now()) throw new ApiError('BAD_REQUEST', 'the event period has already ended');
  const now = Date.now();
  await c.env.DB.prepare("UPDATE events SET status = 'published', published_at = ?, updated_by = ?, updated_at = ? WHERE id = ?").bind(now, a.id, now, row.id).run();
  await audit(c.env, a.id, 'event_published', { type: 'event', id: row.id }, { name: row.name, startsAt: row.starts_at, endsAt: row.ends_at }, ipOf(c));
  return c.json({ ok: true });
});

/** End an event now (no new rooms; running rooms finish normally). */
adminRoutes.post('/events/:id/archive', requirePermission('events.write'), async (c) => {
  const a = c.get('admin');
  const row = await eventRow(c.env, c.req.param('id'));
  if (row.status === 'archived') throw new ApiError('CONFLICT', 'already archived');
  const now = Date.now();
  await c.env.DB.prepare("UPDATE events SET status = 'archived', archived_at = ?, updated_by = ?, updated_at = ? WHERE id = ?").bind(now, a.id, now, row.id).run();
  await audit(c.env, a.id, 'event_archived', { type: 'event', id: row.id }, { name: row.name, previousStatus: row.status }, ipOf(c));
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ seasons

adminRoutes.get('/seasons', requirePermission('seasons.read'), async (c) => {
  await ensureCurrentSeason(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.starts_at, s.ends_at, s.status, s.finalized_at,
            (SELECT COUNT(*) FROM ranked_ratings r WHERE r.season_id = s.id AND r.games > 0) AS players,
            (SELECT COUNT(DISTINCT room_id) FROM rating_changes rc WHERE rc.season_id = s.id) AS leagues,
            (SELECT COUNT(DISTINCT room_id) FROM rating_changes rc WHERE rc.season_id = s.id AND rc.rated = 1) AS rated_leagues
       FROM seasons s ORDER BY s.id DESC LIMIT 36`,
  ).all();
  return c.json({ items: rows.results });
});

adminRoutes.get('/seasons/:id/leaderboard', requirePermission('seasons.read'), async (c) => {
  const id = c.req.param('id');
  if (!/^\d{4}-\d{2}$/.test(id)) throw new ApiError('BAD_REQUEST', 'invalid season id');
  return c.json({ season: seasonView(id), items: await leaderboard(c.env, id) });
});
