import { Hono } from 'hono';
import { audit, auditStatement, ipOf } from '../lib/audit';
import { requirePermission } from '../lib/auth';
import { randomId } from '../lib/crypto';
import { ensureWalletStmts, rewardStmts } from '../lib/economy';
import { ApiError, readJson, str } from '../lib/http';
import { USER_TAGS } from '../lib/metrics';
import type { AppEnv, Env } from '../env';

/**
 * FREE GEMS distribution (spec 14, decisions 46-47).
 *
 * 1. conditions -> preview (target count, total, limits)
 * 2. create: the target players are fixed in gem_distribution_items
 * 3. run: processes up to RUN_CHUNK players per call (the admin site calls it
 *    until nothing is pending). Every player is paid once through
 *    reward_claims ("distribution:<id>"), so an interrupted or repeated run
 *    never pays twice.
 * 4. reconciliation: granted items = claims = ledger rows of the distribution
 */
export const adminDistributionRoutes = new Hono<AppEnv>();

export const DISTRIBUTION_LIMITS = { perUser: 1000, total: 1_000_000 } as const;
const RUN_CHUNK = 50;
const REASONS = ['test_play', 'beta_reward', 'apology', 'campaign', 'season', 'event', 'other'] as const;

export type Target =
  | { kind: 'all' }
  | { kind: 'users'; usernames: string[] }
  | { kind: 'tags'; tags: string[] }
  | { kind: 'registered'; from: number; to: number }
  | { kind: 'active'; sinceDay: string };

function targetOf(v: unknown): Target {
  const t = (v ?? {}) as Record<string, unknown>;
  switch (t.kind) {
    case 'all':
      return { kind: 'all' };
    case 'users': {
      if (!Array.isArray(t.usernames) || t.usernames.length === 0 || t.usernames.length > 1000) throw new ApiError('BAD_REQUEST', 'usernames: 1-1000 names');
      return { kind: 'users', usernames: [...new Set(t.usernames.map((x) => String(x).trim()).filter(Boolean))] };
    }
    case 'tags': {
      if (!Array.isArray(t.tags) || t.tags.length === 0 || t.tags.some((x) => !(USER_TAGS as readonly string[]).includes(String(x)))) throw new ApiError('BAD_REQUEST', `tags: some of ${USER_TAGS.join(', ')}`);
      return { kind: 'tags', tags: t.tags.map(String) };
    }
    case 'registered': {
      const from = Number(t.from);
      const to = Number(t.to);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new ApiError('BAD_REQUEST', 'registered: from < to (epoch ms)');
      return { kind: 'registered', from, to };
    }
    case 'active': {
      if (typeof t.sinceDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.sinceDay)) throw new ApiError('BAD_REQUEST', 'active: sinceDay YYYY-MM-DD');
      return { kind: 'active', sinceDay: t.sinceDay };
    }
    default:
      throw new ApiError('BAD_REQUEST', 'target.kind must be all, users, tags, registered or active');
  }
}

/** SQL selecting the target user ids (suspended players are never included) */
function targetSql(t: Target): { sql: string; binds: unknown[] } {
  const base = "SELECT u.id FROM users u WHERE u.status = 'active'";
  switch (t.kind) {
    case 'all':
      return { sql: base, binds: [] };
    case 'users':
      return { sql: `${base} AND u.username IN (SELECT value FROM json_each(?))`, binds: [JSON.stringify(t.usernames)] };
    case 'tags':
      return { sql: `${base} AND u.id IN (SELECT user_id FROM user_tags WHERE tag IN (SELECT value FROM json_each(?)))`, binds: [JSON.stringify(t.tags)] };
    case 'registered':
      return { sql: `${base} AND u.created_at >= ? AND u.created_at < ?`, binds: [t.from, t.to] };
    case 'active':
      return { sql: `${base} AND u.id IN (SELECT user_id FROM daily_user_metrics WHERE day_key >= ?)`, binds: [t.sinceDay] };
  }
}

async function preview(env: Env, target: Target, amount: number) {
  const q = targetSql(target);
  const count = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM (${q.sql})`).bind(...q.binds).first<{ n: number }>())?.n ?? 0;
  const sample = await env.DB.prepare(`SELECT username FROM users WHERE id IN (${q.sql}) ORDER BY created_at LIMIT 20`).bind(...q.binds).all<{ username: string }>();
  let notFound: string[] = [];
  if (target.kind === 'users') {
    const found = await env.DB.prepare("SELECT username FROM users WHERE status = 'active' AND username IN (SELECT value FROM json_each(?))").bind(JSON.stringify(target.usernames)).all<{ username: string }>();
    const ok = new Set(found.results.map((r) => r.username.toLowerCase()));
    notFound = target.usernames.filter((u) => !ok.has(u.toLowerCase()));
  }
  const total = count * amount;
  const problems: string[] = [];
  if (!Number.isInteger(amount) || amount < 1 || amount > DISTRIBUTION_LIMITS.perUser) problems.push(`1人あたりの数量は 1〜${DISTRIBUTION_LIMITS.perUser}`);
  if (count === 0) problems.push('対象者がいません');
  if (total > DISTRIBUTION_LIMITS.total) problems.push(`合計 ${total} は上限 ${DISTRIBUTION_LIMITS.total} を超えています`);
  return { count, amount, total, sample: sample.results.map((r) => r.username), notFound, limits: DISTRIBUTION_LIMITS, problems };
}

adminDistributionRoutes.post('/distributions/preview', requirePermission('distribution.write'), async (c) => {
  const body = await readJson<{ target?: unknown; amount?: unknown }>(c);
  return c.json(await preview(c.env, targetOf(body.target), Number(body.amount)));
});

adminDistributionRoutes.post('/distributions', requirePermission('distribution.write'), async (c) => {
  const admin = c.get('admin');
  const body = await readJson<Record<string, unknown>>(c);
  const target = targetOf(body.target);
  const amount = Number(body.amount);
  const reason = body.reason as (typeof REASONS)[number];
  if (!REASONS.includes(reason)) throw new ApiError('BAD_REQUEST', `reason must be one of ${REASONS.join(', ')}`);
  const title = str(body.title, 'title', { min: 1, max: 80 });
  const note = str(body.note, 'note', { max: 500, optional: true });
  const requestKey = typeof body.requestId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.requestId) ? body.requestId : null;
  if (!requestKey) throw new ApiError('BAD_REQUEST', 'requestId is required');
  const existing = await c.env.DB.prepare('SELECT id FROM gem_distribution_batches WHERE request_key = ?').bind(requestKey).first<{ id: string }>();
  if (existing) return c.json(await batchView(c.env, existing.id));
  const p = await preview(c.env, target, amount);
  if (p.problems.length) throw new ApiError('BAD_REQUEST', p.problems.join(' / '));
  const id = `dist-${randomId(8)}`;
  const now = Date.now();
  const q = targetSql(target);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO gem_distribution_batches (id, reason, title, note, currency, amount_per_user, target_json, target_count, total_amount, status, created_by, request_key, created_at)
         VALUES (?,?,?,?,'GEMS_FREE',?,?,?,?,'ready',?,?,?)`,
      ).bind(id, reason, title, note || null, amount, JSON.stringify(target), p.count, p.total, admin.id, requestKey, now),
      // the list of players is fixed now (players registering later are not added)
      c.env.DB.prepare(`INSERT INTO gem_distribution_items (batch_id, user_id) SELECT ?, id FROM (${q.sql})`).bind(id, ...q.binds),
      // counts follow the fixed list (a player could have changed between preview and now)
      c.env.DB.prepare(
        'UPDATE gem_distribution_batches SET target_count = (SELECT COUNT(*) FROM gem_distribution_items WHERE batch_id = ?1), total_amount = amount_per_user * (SELECT COUNT(*) FROM gem_distribution_items WHERE batch_id = ?1) WHERE id = ?1',
      ).bind(id),
      auditStatement(c.env, admin.id, 'distribution_created', { type: 'distribution', id }, { reason, title, amount, target, count: p.count, total: p.total }, ipOf(c)),
    ]);
  } catch (err) {
    // the CHECK constraints (count >= 1, total <= limit) reject a list that changed in between
    console.error('distribution create failed', err);
    throw new ApiError('CONFLICT', 'the target list changed; preview again');
  }
  return c.json(await batchView(c.env, id), 201);
});

async function counts(env: Env, id: string) {
  const rows = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM gem_distribution_items WHERE batch_id = ? GROUP BY status').bind(id).all<{ status: string; n: number }>();
  const m = Object.fromEntries(rows.results.map((r) => [r.status, r.n])) as Record<string, number>;
  return { pending: m.pending ?? 0, granted: m.granted ?? 0, skipped: m.skipped ?? 0, failed: m.failed ?? 0 };
}

async function batchView(env: Env, id: string) {
  const b = await env.DB.prepare(
    `SELECT b.*, c.username AS created_by_name, e.username AS executed_by_name FROM gem_distribution_batches b
       LEFT JOIN admin_users c ON c.id = b.created_by LEFT JOIN admin_users e ON e.id = b.executed_by WHERE b.id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!b) throw new ApiError('NOT_FOUND', 'distribution not found');
  return { batch: { ...b, target: JSON.parse(String(b.target_json)) }, progress: await counts(env, id) };
}

/** granted items vs reward claims vs ledger rows (spec 14-5: 配布結果の照合) */
async function reconcile(env: Env, id: string) {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM gem_distribution_items WHERE batch_id = ?1 AND status = 'granted') AS granted,
            (SELECT COUNT(*) FROM reward_claims WHERE reward_key = 'distribution:' || ?1) AS claims,
            (SELECT COALESCE(SUM(amount), 0) FROM reward_claims WHERE reward_key = 'distribution:' || ?1) AS claimed_total,
            (SELECT COUNT(*) FROM currency_transactions WHERE ref_type = 'gem_distribution' AND ref_id = ?1) AS ledger_rows,
            (SELECT COALESCE(SUM(amount), 0) FROM currency_transactions WHERE ref_type = 'gem_distribution' AND ref_id = ?1) AS ledger_total,
            (SELECT amount_per_user FROM gem_distribution_batches WHERE id = ?1) AS per_user`,
  )
    .bind(id)
    .first<{ granted: number; claims: number; claimed_total: number; ledger_rows: number; ledger_total: number; per_user: number }>();
  const r = row!;
  const expected = r.granted * r.per_user;
  return { ...r, expectedTotal: expected, ok: r.granted === r.claims && r.claims === r.ledger_rows && r.ledger_total === expected && r.claimed_total === expected };
}

adminDistributionRoutes.get('/distributions', requirePermission('distribution.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT b.id, b.reason, b.title, b.amount_per_user, b.target_count, b.total_amount, b.status, b.granted_count, b.skipped_count, b.failed_count,
            b.created_at, b.started_at, b.completed_at, c.username AS created_by_name, e.username AS executed_by_name
       FROM gem_distribution_batches b LEFT JOIN admin_users c ON c.id = b.created_by LEFT JOIN admin_users e ON e.id = b.executed_by
      ORDER BY b.created_at DESC LIMIT 100`,
  ).all();
  return c.json({ items: rows.results, limits: DISTRIBUTION_LIMITS });
});

adminDistributionRoutes.get('/distributions/:id', requirePermission('distribution.read'), async (c) => {
  const id = c.req.param('id');
  const view = await batchView(c.env, id);
  const items = await c.env.DB.prepare(
    'SELECT i.user_id, u.username, i.status, i.error, i.processed_at FROM gem_distribution_items i JOIN users u ON u.id = i.user_id WHERE i.batch_id = ? ORDER BY i.status, u.username LIMIT 500',
  )
    .bind(id)
    .all();
  return c.json({ ...view, items: items.results, reconciliation: await reconcile(c.env, id) });
});

/** pays the next pending players (call again until progress.pending is 0) */
adminDistributionRoutes.post('/distributions/:id/run', requirePermission('distribution.write'), async (c) => {
  const admin = c.get('admin');
  const id = c.req.param('id');
  const b = await c.env.DB.prepare('SELECT status, amount_per_user, title FROM gem_distribution_batches WHERE id = ?').bind(id).first<{ status: string; amount_per_user: number; title: string }>();
  if (!b) throw new ApiError('NOT_FOUND', 'distribution not found');
  if (b.status === 'completed' || b.status === 'cancelled') throw new ApiError('CONFLICT', `the distribution is ${b.status}`);
  const now = Date.now();
  if (b.status === 'ready') {
    const started = await c.env.DB.prepare("UPDATE gem_distribution_batches SET status = 'running', started_at = ?, executed_by = ? WHERE id = ? AND status = 'ready'").bind(now, admin.id, id).run();
    if (started.meta.changes === 1) await audit(c.env, admin.id, 'distribution_started', { type: 'distribution', id }, { title: b.title }, ipOf(c));
  }
  const pending = await c.env.DB.prepare(
    "SELECT i.user_id, u.status AS user_status FROM gem_distribution_items i JOIN users u ON u.id = i.user_id WHERE i.batch_id = ? AND i.status = 'pending' LIMIT ?",
  )
    .bind(id, RUN_CHUNK)
    .all<{ user_id: string; user_status: string }>();
  const key = `distribution:${id}`;
  const grant = (userId: string, opId: string) => [
    ...ensureWalletStmts(c.env, userId, now),
    ...rewardStmts(c.env, { userId, key, kind: 'distribution', currency: 'GEMS_FREE', amount: b.amount_per_user, refType: 'gem_distribution', refId: id, opId, now }),
    // granted when the claim exists (also when an interrupted earlier run already paid it)
    c.env.DB.prepare(
      "UPDATE gem_distribution_items SET status = 'granted', processed_at = ? WHERE batch_id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM reward_claims WHERE user_id = ? AND reward_key = ?)",
    ).bind(now, id, userId, userId, key),
  ];
  const active = pending.results.filter((p) => p.user_status === 'active');
  const suspended = pending.results.filter((p) => p.user_status !== 'active');
  const stmts: D1PreparedStatement[] = suspended.map((p) =>
    c.env.DB.prepare("UPDATE gem_distribution_items SET status = 'skipped', error = 'suspended', processed_at = ? WHERE batch_id = ? AND user_id = ?").bind(now, id, p.user_id),
  );
  const opId = randomId();
  for (const p of active) stmts.push(...grant(p.user_id, opId));
  try {
    for (let i = 0; i < stmts.length; i += 60) await c.env.DB.batch(stmts.slice(i, i + 60));
  } catch (err) {
    // isolate the failing player(s): one player at a time
    console.error('distribution chunk failed, retrying one by one', err);
    for (const p of active) {
      try {
        await c.env.DB.batch(grant(p.user_id, randomId()));
      } catch (e) {
        await c.env.DB.prepare("UPDATE gem_distribution_items SET status = 'failed', error = ?, processed_at = ? WHERE batch_id = ? AND user_id = ? AND status = 'pending'")
          .bind(String(e).slice(0, 200), now, id, p.user_id)
          .run();
      }
    }
  }
  const progress = await counts(c.env, id);
  await c.env.DB.prepare('UPDATE gem_distribution_batches SET granted_count = ?, skipped_count = ?, failed_count = ? WHERE id = ?')
    .bind(progress.granted, progress.skipped, progress.failed, id)
    .run();
  if (progress.pending === 0) {
    const done = await c.env.DB.prepare("UPDATE gem_distribution_batches SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'running'").bind(Date.now(), id).run();
    if (done.meta.changes === 1) {
      const rec = await reconcile(c.env, id);
      await audit(c.env, admin.id, 'distribution_completed', { type: 'distribution', id }, { ...progress, reconciliation: rec }, ipOf(c));
    }
  }
  return c.json({ progress, done: progress.pending === 0 });
});

/** stops a distribution: players not paid yet are skipped */
adminDistributionRoutes.post('/distributions/:id/cancel', requirePermission('distribution.write'), async (c) => {
  const admin = c.get('admin');
  const id = c.req.param('id');
  const now = Date.now();
  const r = await c.env.DB.prepare("UPDATE gem_distribution_batches SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status IN ('ready', 'running')").bind(now, id).run();
  if (r.meta.changes !== 1) throw new ApiError('CONFLICT', 'only a ready or running distribution can be cancelled');
  await c.env.DB.prepare("UPDATE gem_distribution_items SET status = 'skipped', error = 'cancelled', processed_at = ? WHERE batch_id = ? AND status = 'pending'").bind(now, id).run();
  const progress = await counts(c.env, id);
  await c.env.DB.prepare('UPDATE gem_distribution_batches SET granted_count = ?, skipped_count = ?, failed_count = ? WHERE id = ?')
    .bind(progress.granted, progress.skipped, progress.failed, id)
    .run();
  await audit(c.env, admin.id, 'distribution_cancelled', { type: 'distribution', id }, progress, ipOf(c));
  return c.json({ progress });
});
