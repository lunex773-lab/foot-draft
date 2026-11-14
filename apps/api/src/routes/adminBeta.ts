import { ECONOMY_CONFIG, validDraftTimer } from '@fd/shared';
import { Hono } from 'hono';
import { audit, auditStatement, ipOf } from '../lib/audit';
import { requirePermission, testGrantsEnabled } from '../lib/auth';
import { betaReport } from '../lib/betaReport';
import { randomId } from '../lib/crypto';
import { GRANT_KINDS, claimedNow, ensureWalletStmts, pointStmts, requestIdOf, rewardStmts, type GrantKind } from '../lib/economy';
import { ApiError, readJson, str } from '../lib/http';
import { USER_TAGS, addDays, filterOf, periodOf, refreshDailyMetrics } from '../lib/metrics';
import { draftTimerSetting, settingOf } from '../lib/settings';
import { resetStmts, resetSummaryOf } from '../lib/testReset';
import type { AppEnv, Env } from '../env';

/**
 * Beta test tools (spec 12-2 Beta Testing, 15; decisions 60-67):
 * testers and their tags, test grants to many players, test data reset,
 * the draft timer comparison and the beta report.
 */
export const adminBetaRoutes = new Hono<AppEnv>();

/** tags given from the Beta Testing page ("normal" is what a player has without any of them) */
const BETA_TAGS = ['founder', 'beta_tester', 'friend_tester', 'developer'] as const;
const MAX_TARGETS = 500;
const RESET_CHUNK = 10;

type Target = { usernames: string[] } | { tag: string };

function targetOf(v: unknown): Target {
  const t = (v ?? {}) as Record<string, unknown>;
  if (typeof t.tag === 'string') {
    if (!(USER_TAGS as readonly string[]).includes(t.tag)) throw new ApiError('BAD_REQUEST', 'unknown tag');
    return { tag: t.tag };
  }
  if (Array.isArray(t.usernames)) {
    const names = [...new Set(t.usernames.map((x) => String(x).trim()).filter(Boolean))];
    if (names.length === 0 || names.length > MAX_TARGETS || names.some((n) => n.length > 40)) throw new ApiError('BAD_REQUEST', `usernames: 1-${MAX_TARGETS} names`);
    return { usernames: names };
  }
  throw new ApiError('BAD_REQUEST', 'target needs usernames or tag');
}

/** players of a target (and the names that were not found) */
async function playersOf(env: Env, t: Target): Promise<{ users: { id: string; username: string }[]; notFound: string[] }> {
  if ('tag' in t) {
    const rows = await env.DB.prepare('SELECT u.id, u.username FROM users u JOIN user_tags t ON t.user_id = u.id WHERE t.tag = ? ORDER BY u.created_at LIMIT ?')
      .bind(t.tag, MAX_TARGETS + 1)
      .all<{ id: string; username: string }>();
    if (rows.results.length > MAX_TARGETS) throw new ApiError('BAD_REQUEST', `more than ${MAX_TARGETS} players have this tag`);
    return { users: rows.results, notFound: [] };
  }
  const rows = await env.DB.prepare('SELECT id, username FROM users WHERE username IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(t.usernames))
    .all<{ id: string; username: string }>();
  const found = new Set(rows.results.map((r) => r.username));
  return { users: rows.results, notFound: t.usernames.filter((n) => !found.has(n)) };
}

async function batchAll(env: Env, stmts: D1PreparedStatement[]) {
  for (let i = 0; i < stmts.length; i += 60) await env.DB.batch(stmts.slice(i, i + 60));
}

// ---------------------------------------------------------------- testers

adminBetaRoutes.get('/beta/testers', requirePermission('users.read'), async (c) => {
  await refreshDailyMetrics(c.env);
  const counts = await c.env.DB.prepare('SELECT tag, COUNT(*) AS n FROM user_tags GROUP BY tag').all<{ tag: string; n: number }>();
  const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  const tag = c.req.query('tag');
  if (tag && !(USER_TAGS as readonly string[]).includes(tag)) throw new ApiError('BAD_REQUEST', 'unknown tag');
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.status, u.created_at,
            (SELECT group_concat(tag) FROM user_tags WHERE user_id = u.id) AS tags,
            (SELECT MAX(day_key) FROM daily_user_metrics WHERE user_id = u.id) AS last_active,
            (SELECT COUNT(*) FROM daily_user_metrics WHERE user_id = u.id) AS active_days,
            (SELECT COALESCE(SUM(matches_completed), 0) FROM daily_user_metrics WHERE user_id = u.id) AS matches,
            (SELECT COUNT(*) FROM feedback WHERE user_id = u.id) AS feedback,
            (SELECT MAX(done_at) FROM test_resets WHERE user_id = u.id) AS last_reset
       FROM users u
      WHERE ${tag ? 'u.id IN (SELECT user_id FROM user_tags WHERE tag = ?)' : "u.id IN (SELECT user_id FROM user_tags WHERE tag <> 'normal')"}
      ORDER BY u.created_at DESC LIMIT 500`,
  )
    .bind(...(tag ? [tag] : []))
    .all<Record<string, unknown>>();
  return c.json({
    total: total?.n ?? 0,
    counts: Object.fromEntries(USER_TAGS.map((t) => [t, counts.results.find((r) => r.tag === t)?.n ?? 0])),
    items: rows.results.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      status: r.status,
      createdAt: r.created_at,
      tags: String(r.tags ?? '').split(',').filter(Boolean),
      lastActive: r.last_active,
      activeDays: r.active_days,
      matches: r.matches,
      feedback: r.feedback,
      lastReset: r.last_reset,
    })),
    testToolsEnabled: testGrantsEnabled(c.env),
  });
});

/** add or remove one tag for many players (by user name) */
adminBetaRoutes.post('/beta/tags', requirePermission('beta.manage'), async (c) => {
  const admin = c.get('admin');
  const body = await readJson<{ usernames?: unknown; tag?: unknown; action?: unknown }>(c);
  const tag = String(body.tag ?? '');
  if (!(BETA_TAGS as readonly string[]).includes(tag)) throw new ApiError('BAD_REQUEST', `tag must be one of ${BETA_TAGS.join(', ')}`);
  if (body.action !== 'add' && body.action !== 'remove') throw new ApiError('BAD_REQUEST', 'action must be add or remove');
  const t = targetOf({ usernames: body.usernames });
  const { users, notFound } = await playersOf(c.env, t);
  const ids = JSON.stringify(users.map((u) => u.id));
  const now = Date.now();
  const stmts =
    body.action === 'add'
      ? [
          c.env.DB.prepare('INSERT OR IGNORE INTO user_tags (user_id, tag, created_at) SELECT value, ?, ? FROM json_each(?)').bind(tag, now, ids),
          c.env.DB.prepare("DELETE FROM user_tags WHERE tag = 'normal' AND user_id IN (SELECT value FROM json_each(?))").bind(ids),
        ]
      : [
          c.env.DB.prepare('DELETE FROM user_tags WHERE tag = ? AND user_id IN (SELECT value FROM json_each(?))').bind(tag, ids),
          // a player without any tag is a normal player again
          c.env.DB.prepare(
            "INSERT OR IGNORE INTO user_tags (user_id, tag, created_at) SELECT value, 'normal', ? FROM json_each(?) WHERE NOT EXISTS (SELECT 1 FROM user_tags WHERE user_id = value)",
          ).bind(now, ids),
        ];
  await c.env.DB.batch([
    ...stmts,
    auditStatement(c.env, admin.id, 'beta_tags_changed', { type: 'tag', id: tag }, { action: body.action, count: users.length, usernames: users.map((u) => u.username).slice(0, 200), notFound }, ipOf(c)),
  ]);
  return c.json({ changed: users.length, notFound });
});

// ---------------------------------------------------------------- test grants to many players (staging / local)

adminBetaRoutes.post('/beta/test-grants', requirePermission('economy.test_grant'), async (c) => {
  if (!testGrantsEnabled(c.env)) throw new ApiError('FORBIDDEN', 'test grants are disabled in this environment');
  const admin = c.get('admin');
  const body = await readJson<{ target?: unknown; kind?: unknown; amount?: unknown; note?: unknown; requestId?: unknown }>(c);
  const kind = body.kind as GrantKind;
  if (!GRANT_KINDS.includes(kind)) throw new ApiError('BAD_REQUEST', `kind must be one of ${GRANT_KINDS.join(', ')}`);
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > ECONOMY_CONFIG.testGrantMax) throw new ApiError('BAD_REQUEST', `amount must be 1-${ECONOMY_CONFIG.testGrantMax}`);
  const note = str(body.note, 'note', { max: 200, optional: true });
  const requestId = requestIdOf(body.requestId);
  const target = targetOf(body.target);
  const { users, notFound } = await playersOf(c.env, target);
  if (users.length === 0) throw new ApiError('NOT_FOUND', 'no players');
  // one claim per player and request: sending the same request again pays nobody twice
  const key = `test-grant:${requestId}`;
  const opId = randomId();
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const u of users) {
    const g = { userId: u.id, key, opId, now, refType: 'admin_test_grant', refId: requestId };
    stmts.push(...ensureWalletStmts(c.env, u.id, now));
    if (kind === 'POINTS_STANDARD' || kind === 'POINTS_PREMIUM') {
      stmts.push(
        c.env.DB.prepare('INSERT OR IGNORE INTO reward_claims (id, user_id, reward_key, kind, currency, amount, op_id, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(randomId(), u.id, key, 'test_grant', kind, amount, opId, now),
        ...pointStmts(c.env, { ...g, pointType: kind === 'POINTS_STANDARD' ? 'standard' : 'premium', amount, reason: 'test_grant' }, claimedNow(g)),
      );
    } else {
      stmts.push(...rewardStmts(c.env, { ...g, kind: 'test_grant', currency: kind, amount }));
    }
  }
  await batchAll(c.env, stmts);
  const paid = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM reward_claims WHERE reward_key = ? AND op_id = ?').bind(key, opId).first<{ n: number }>();
  await audit(
    c.env,
    admin.id,
    'test_grant_bulk',
    'tag' in target ? { type: 'tag', id: target.tag } : { type: 'users' },
    { kind, amount, players: users.length, paid: paid?.n ?? 0, notFound, note: note || undefined, environment: c.env.ENVIRONMENT, requestId },
    ipOf(c),
  );
  return c.json({ players: users.length, paid: paid?.n ?? 0, notFound });
});

// ---------------------------------------------------------------- test data reset (staging / local, decision 67)

async function resetProgress(env: Env, runId: string) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS total, SUM(done_at IS NOT NULL) AS done FROM test_resets WHERE run_id = ?').bind(runId).first<{ total: number; done: number | null }>();
  return { total: r?.total ?? 0, done: r?.done ?? 0, pending: (r?.total ?? 0) - (r?.done ?? 0) };
}

adminBetaRoutes.get('/beta/resets', requirePermission('users.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.target_json, r.note, r.total, r.status, r.created_at, r.finished_at, a.username AS admin,
            (SELECT COUNT(*) FROM test_resets x WHERE x.run_id = r.id AND x.done_at IS NOT NULL) AS done
       FROM test_reset_runs r LEFT JOIN admin_users a ON a.id = r.admin_id ORDER BY r.created_at DESC LIMIT 20`,
  ).all<Record<string, unknown>>();
  return c.json({
    enabled: testGrantsEnabled(c.env),
    items: rows.results.map((r) => ({ id: r.id, target: JSON.parse(String(r.target_json)), note: r.note, total: r.total, done: r.done, status: r.status, createdAt: r.created_at, finishedAt: r.finished_at, admin: r.admin })),
  });
});

/** fixes the players of a reset (then run it with /run until nothing is pending) */
adminBetaRoutes.post('/beta/resets', requirePermission('beta.manage'), async (c) => {
  if (!testGrantsEnabled(c.env)) throw new ApiError('FORBIDDEN', 'test data can only be reset on staging or locally');
  const admin = c.get('admin');
  const body = await readJson<{ target?: unknown; note?: unknown }>(c);
  const target = targetOf(body.target);
  const note = str(body.note, 'note', { max: 200, optional: true });
  const { users, notFound } = await playersOf(c.env, target);
  if (users.length === 0) throw new ApiError('NOT_FOUND', 'no players');
  const id = randomId();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO test_reset_runs (id, admin_id, target_json, note, total, status, environment, created_at) VALUES (?,?,?,?,?,'ready',?,?)").bind(
      id,
      admin.id,
      JSON.stringify(target),
      note || null,
      users.length,
      c.env.ENVIRONMENT,
      now,
    ),
    c.env.DB.prepare('INSERT INTO test_resets (run_id, user_id) SELECT ?, value FROM json_each(?)').bind(id, JSON.stringify(users.map((u) => u.id))),
    auditStatement(c.env, admin.id, 'test_reset_created', { type: 'test_reset', id }, { target, players: users.length, notFound, note: note || undefined, environment: c.env.ENVIRONMENT }, ipOf(c)),
  ]);
  return c.json({ id, players: users.length, notFound }, 201);
});

adminBetaRoutes.post('/beta/resets/:id/run', requirePermission('beta.manage'), async (c) => {
  if (!testGrantsEnabled(c.env)) throw new ApiError('FORBIDDEN', 'test data can only be reset on staging or locally');
  const admin = c.get('admin');
  const id = c.req.param('id');
  const run = await c.env.DB.prepare('SELECT status FROM test_reset_runs WHERE id = ?').bind(id).first<{ status: string }>();
  if (!run) throw new ApiError('NOT_FOUND', 'reset not found');
  const pending = await c.env.DB.prepare('SELECT user_id FROM test_resets WHERE run_id = ? AND done_at IS NULL LIMIT ?').bind(id, RESET_CHUNK).all<{ user_id: string }>();
  for (const p of pending.results) {
    const now = Date.now();
    // one player per batch: a player is either reset completely or not at all
    await c.env.DB.batch(resetStmts(c.env, p.user_id, id, await resetSummaryOf(c.env, p.user_id), now));
  }
  const progress = await resetProgress(c.env, id);
  if (progress.pending === 0) {
    const done = await c.env.DB.prepare("UPDATE test_reset_runs SET status = 'completed', finished_at = ? WHERE id = ? AND status = 'ready'").bind(Date.now(), id).run();
    if (done.meta.changes === 1) await audit(c.env, admin.id, 'test_reset_completed', { type: 'test_reset', id }, progress, ipOf(c));
  }
  return c.json({ progress, done: progress.pending === 0 });
});

// ---------------------------------------------------------------- draft timer comparison (decision 66)

adminBetaRoutes.get('/beta/draft-timer', requirePermission('analytics.read'), async (c) => {
  const s = await settingOf(c.env, 'draft_timer');
  return c.json({ setting: await draftTimerSetting(c.env), updatedAt: s?.updatedAt ?? null });
});

adminBetaRoutes.put('/beta/draft-timer', requirePermission('beta.manage'), async (c) => {
  const admin = c.get('admin');
  const setting = validDraftTimer(await readJson(c));
  if (!setting) throw new ApiError('BAD_REQUEST', 'mode "compare" with 2-3 different variants, or "fixed" with seconds (5, 8, 10, 12 or 15)');
  const before = await draftTimerSetting(c.env);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO app_settings (key, value_json, updated_by, updated_at) VALUES ('draft_timer', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
    ).bind(JSON.stringify(setting), admin.id, now),
    auditStatement(c.env, admin.id, 'draft_timer_changed', { type: 'setting', id: 'draft_timer' }, { before, after: setting }, ipOf(c)),
  ]);
  return c.json({ setting, updatedAt: now });
});

// ---------------------------------------------------------------- report (decision 63)

adminBetaRoutes.get('/beta/report', requirePermission('analytics.read'), async (c) => {
  const now = Date.now();
  await refreshDailyMetrics(c.env, now);
  const q = c.req.query();
  // default period: from the first registration (at most 90 days back) to today
  let from = q.from;
  if (!from) {
    const first = await c.env.DB.prepare('SELECT MIN(created_at) AS t FROM users').first<{ t: number | null }>();
    const today = periodOf({}, now).to;
    const firstDay = first?.t ? new Date(first.t + 9 * 3600 * 1000).toISOString().slice(0, 10) : today;
    from = firstDay < addDays(today, -89) ? addDays(today, -89) : firstDay;
  }
  const p = periodOf({ from, to: q.to }, now);
  return c.json(await betaReport(c.env, p, filterOf(q), now));
});
