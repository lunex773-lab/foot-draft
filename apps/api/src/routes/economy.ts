import { CURRENCIES, ECONOMY_CONFIG, MISSIONS, MISSION_BY_ID, periodKey, type Currency } from '@fd/shared';
import { Hono } from 'hono';
import { requireUser } from '../lib/auth';
import { randomId } from '../lib/crypto';
import { ensureWalletStmts, rewardStmts, walletOf } from '../lib/economy';
import { ApiError } from '../lib/http';
import { claimLoginBonus, leaguesRewardedToday, loginBonusStatus, settlePendingRewards } from '../lib/rewards';
import { ensureCurrentSeason } from '../lib/seasons';
import type { AppEnv, Env } from '../env';

/**
 * Wallet, login bonus and missions of the logged-in player (spec 8, 10).
 * Balances are read-only for the client; every change happens on the server.
 */
export const currencyRoutes = new Hono<AppEnv>();
currencyRoutes.use('*', requireUser);

/** balances (GEMS with breakdown), exchange points, today's login bonus and match reward count */
currencyRoutes.get('/', async (c) => {
  const user = c.get('user');
  const now = Date.now();
  // close finished seasons and pay rewards that are still pending (decision 40)
  await ensureCurrentSeason(c.env, now);
  await settlePendingRewards(c.env, user.id, now);
  return c.json({
    wallet: await walletOf(c.env, user.id),
    login: await loginBonusStatus(c.env, user.id, now),
    matchRewards: { leaguesToday: await leaguesRewardedToday(c.env, user.id, now), cap: ECONOMY_CONFIG.matchReward.dailyLeagueCap },
  });
});

/** ledger of the player (newest first) */
currencyRoutes.get('/history', async (c) => {
  const user = c.get('user');
  const currency = c.req.query('currency');
  if (currency && !CURRENCIES.includes(currency as Currency)) throw new ApiError('BAD_REQUEST', 'unknown currency');
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 200);
  const before = Number(c.req.query('before') ?? 0) || Number.MAX_SAFE_INTEGER;
  const rows = await c.env.DB.prepare(
    `SELECT id, currency, amount, balance_after, reason, ref_type, ref_id, created_at FROM currency_transactions
      WHERE user_id = ? ${currency ? 'AND currency = ?' : ''} AND created_at < ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  )
    .bind(...(currency ? [user.id, currency, before, limit] : [user.id, before, limit]))
    .all();
  const points = await c.env.DB.prepare('SELECT id, point_type, amount, balance_after, reason, ref_type, ref_id, created_at FROM exchange_transactions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50')
    .bind(user.id)
    .all();
  return c.json({ items: rows.results, points: points.results });
});

export const rewardRoutes = new Hono<AppEnv>();
rewardRoutes.use('*', requireUser);

rewardRoutes.get('/login', async (c) => c.json(await loginBonusStatus(c.env, c.get('user').id)));

/** receive today's login bonus (Japan day; once per day) */
rewardRoutes.post('/login', async (c) => {
  const user = c.get('user');
  const result = await claimLoginBonus(c.env, user.id);
  return c.json({ ...result, wallet: await walletOf(c.env, user.id) });
});

// ---------------------------------------------------------------- missions

export const missionRoutes = new Hono<AppEnv>();
missionRoutes.use('*', requireUser);

async function missionList(env: Env, userId: string, now: number) {
  const keys = [periodKey('daily', now), periodKey('weekly', now), 'once'];
  const rows = await env.DB.prepare('SELECT mission_id, period_key, progress, completed_at, claimed_at FROM mission_progress WHERE user_id = ? AND period_key IN (?, ?, ?)')
    .bind(userId, ...keys)
    .all<{ mission_id: string; period_key: string; progress: number; completed_at: number | null; claimed_at: number | null }>();
  const byKey = new Map(rows.results.map((r) => [`${r.mission_id}|${r.period_key}`, r]));
  return MISSIONS.map((m) => {
    const key = periodKey(m.period, now);
    const p = byKey.get(`${m.id}|${key}`);
    return {
      id: m.id,
      period: m.period,
      periodKey: key,
      title: m.titleJa,
      target: m.target,
      progress: Math.min(p?.progress ?? 0, m.target),
      completed: (p?.progress ?? 0) >= m.target,
      claimed: !!p?.claimed_at,
      reward: m.reward,
    };
  });
}

/** current daily / weekly missions and the beginner missions */
missionRoutes.get('/', async (c) => {
  const now = Date.now();
  const items = await missionList(c.env, c.get('user').id, now);
  return c.json({ items, resets: { daily: periodKey('daily', now), weekly: periodKey('weekly', now) } });
});

async function claimMission(env: Env, userId: string, missionId: string, now: number) {
  const m = MISSION_BY_ID[missionId];
  if (!m) throw new ApiError('NOT_FOUND', 'mission not found');
  const key = periodKey(m.period, now);
  const row = await env.DB.prepare('SELECT progress, claimed_at FROM mission_progress WHERE user_id = ? AND mission_id = ? AND period_key = ?')
    .bind(userId, m.id, key)
    .first<{ progress: number; claimed_at: number | null }>();
  if (!row || row.progress < m.target) throw new ApiError('CONFLICT', 'mission not completed yet');
  if (row.claimed_at) return { missionId: m.id, paid: 0, reward: m.reward };
  const opId = randomId();
  const rewardKey = `mission:${m.id}:${key}`;
  await env.DB.batch([
    ...ensureWalletStmts(env, userId, now),
    ...rewardStmts(env, { userId, key: rewardKey, kind: 'mission', currency: m.reward.currency, amount: m.reward.amount, refType: 'mission', refId: `${m.id}:${key}`, opId, now }),
    env.DB.prepare('UPDATE mission_progress SET claimed_at = COALESCE(claimed_at, ?) WHERE user_id = ? AND mission_id = ? AND period_key = ?').bind(now, userId, m.id, key),
  ]);
  const claim = await env.DB.prepare('SELECT op_id FROM reward_claims WHERE user_id = ? AND reward_key = ?').bind(userId, rewardKey).first<{ op_id: string }>();
  return { missionId: m.id, paid: claim?.op_id === opId ? m.reward.amount : 0, reward: m.reward };
}

missionRoutes.post('/:id/claim', async (c) => {
  const user = c.get('user');
  const now = Date.now();
  const result = await claimMission(c.env, user.id, c.req.param('id'), now);
  return c.json({ ...result, wallet: await walletOf(c.env, user.id) });
});

/** receive every completed mission at once */
missionRoutes.post('/claim-all', async (c) => {
  const user = c.get('user');
  const now = Date.now();
  const ready = (await missionList(c.env, user.id, now)).filter((m) => m.completed && !m.claimed);
  const results = [];
  for (const m of ready) results.push(await claimMission(c.env, user.id, m.id, now));
  return c.json({ results, wallet: await walletOf(c.env, user.id) });
});
