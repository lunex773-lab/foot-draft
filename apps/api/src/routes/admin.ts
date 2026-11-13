import { CLUB_BY_ID, LEAGUE_BY_ID, NATION_BY_CODE, RARITY_INFO, rarityRank, type Player } from '@fd/shared';
import { Hono } from 'hono';
import { createAdminSession, requireAdmin, requirePermission } from '../lib/auth';
import { randomId, verifyPassword, verifyTotp } from '../lib/crypto';
import { ApiError, readJson, str } from '../lib/http';
import { loadCatalog } from '../lib/players';
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
  else if (require2fa && (!row.totp_enabled || !row.totp_secret)) reason = '2fa_not_configured';
  else if (row.totp_enabled && row.totp_secret) {
    if (!totp) {
      await audit(c.env, row.id, 'login_2fa_required', { type: 'admin', id: username.toLowerCase() }, undefined, ipOf(c));
      return c.json({ error: { code: 'TOTP_REQUIRED', message: '2段階認証コードを入力してください' } }, 401);
    }
    if (!(await verifyTotp(row.totp_secret, totp))) reason = 'invalid_totp';
  }
  if (reason) {
    await audit(c.env, row?.id ?? null, 'login_failed', { type: 'admin', id: username.toLowerCase() }, { reason }, ipOf(c));
    if (reason === '2fa_not_configured') throw new ApiError('FORBIDDEN', '2段階認証の設定が必要です');
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
  return c.json({ admin: { id: a.id, username: a.username, role: a.role }, environment: c.env.ENVIRONMENT });
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
