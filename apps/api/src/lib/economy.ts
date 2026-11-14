import { MISSIONS, MISSION_BY_ID, periodKey, type Currency, type MissionMetric, type PointType } from '@fd/shared';
import type { Env } from '../env';
import { randomId } from './crypto';
import { ApiError } from './http';

/**
 * Wallets and ledgers (Phase 4, docs/07-phase4-plan.md).
 *
 * - Every change of a balance is one UPDATE of the wallet plus one ledger row
 *   whose balance_after is read from the wallet inside the same batch.
 * - Balances have CHECK (>= 0): a spend that is not covered makes the whole
 *   D1 batch fail and nothing changes.
 * - Grants (rewards) are recorded in reward_claims (unique per user and key)
 *   with INSERT OR IGNORE; the credit only happens when the claim row was
 *   written by this operation (same op_id), so a reward is never paid twice.
 * - Spending operations (gacha, exchange) take the next per-user number in
 *   economy_ops and store their response under the client's request id.
 */

export const CURRENCY_COLUMN: Record<Currency, string> = {
  COINS: 'coins',
  GEMS_FREE: 'gems_free',
  GEMS_PAID_PURCHASED: 'gems_paid_purchased',
  GEMS_PAID_GRANTED: 'gems_paid_granted',
};

export const POINT_COLUMN: Record<PointType, string> = { standard: 'standard_points', premium: 'premium_points' };

export interface Condition {
  sql: string;
  binds: unknown[];
}

export interface WalletView {
  coins: number;
  gems: { free: number; paidPurchased: number; paidGranted: number; paid: number; total: number };
  points: { standard: number; premium: number };
}

export function ensureWalletStmts(env: Env, userId: string, now: number): D1PreparedStatement[] {
  return [
    env.DB.prepare('INSERT OR IGNORE INTO currency_wallets (user_id, updated_at) VALUES (?, ?)').bind(userId, now),
    env.DB.prepare('INSERT OR IGNORE INTO exchange_wallets (user_id, updated_at) VALUES (?, ?)').bind(userId, now),
  ];
}

export async function walletOf(env: Env, userId: string): Promise<WalletView> {
  const row = await env.DB.prepare(
    `SELECT w.coins, w.gems_free, w.gems_paid_purchased, w.gems_paid_granted, x.standard_points, x.premium_points
       FROM (SELECT ? AS user_id) u
       LEFT JOIN currency_wallets w ON w.user_id = u.user_id
       LEFT JOIN exchange_wallets x ON x.user_id = u.user_id`,
  )
    .bind(userId)
    .first<{ coins: number | null; gems_free: number | null; gems_paid_purchased: number | null; gems_paid_granted: number | null; standard_points: number | null; premium_points: number | null }>();
  const free = row?.gems_free ?? 0;
  const purchased = row?.gems_paid_purchased ?? 0;
  const granted = row?.gems_paid_granted ?? 0;
  return {
    coins: row?.coins ?? 0,
    gems: { free, paidPurchased: purchased, paidGranted: granted, paid: purchased + granted, total: free + purchased + granted },
    points: { standard: row?.standard_points ?? 0, premium: row?.premium_points ?? 0 },
  };
}

export interface CurrencyChange {
  userId: string;
  currency: Currency;
  /** positive = credit, negative = debit */
  amount: number;
  reason: string;
  refType?: string | null;
  refId?: string | null;
  opId: string;
  now: number;
}

/** analytics row written only when `cond` holds (same batch) */
export function analyticsWhen(env: Env, name: string, userId: string, properties: Record<string, unknown>, now: number, cond?: Condition): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO analytics_events (event_id, event_name, user_id, session_id, timestamp, platform, app_version, environment, properties_json)
     SELECT ?, ?, ?, NULL, ?, NULL, NULL, ?, ? WHERE ${cond ? cond.sql : '1'}`,
  ).bind(randomId(), name, userId, now, env.ENVIRONMENT, JSON.stringify(properties), ...(cond?.binds ?? []));
}

/** wallet update + ledger row + analytics (optionally only when `cond` holds) */
export function currencyStmts(env: Env, c: CurrencyChange, cond?: Condition): D1PreparedStatement[] {
  if (!Number.isInteger(c.amount) || c.amount === 0) throw new Error('invalid amount');
  const col = CURRENCY_COLUMN[c.currency];
  const where = cond ? ` AND ${cond.sql}` : '';
  const binds = cond?.binds ?? [];
  return [
    env.DB.prepare(`UPDATE currency_wallets SET ${col} = ${col} + ?, updated_at = ? WHERE user_id = ?${where}`).bind(c.amount, c.now, c.userId, ...binds),
    env.DB.prepare(
      `INSERT INTO currency_transactions (id, user_id, currency, amount, balance_after, reason, ref_type, ref_id, op_id, created_at)
       SELECT ?, ?, ?, ?, ${col}, ?, ?, ?, ?, ? FROM currency_wallets WHERE user_id = ?${where}`,
    ).bind(randomId(), c.userId, c.currency, c.amount, c.reason, c.refType ?? null, c.refId ?? null, c.opId, c.now, c.userId, ...binds),
    analyticsWhen(
      env,
      c.amount > 0 ? 'currency_earned' : 'currency_spent',
      c.userId,
      { currency: c.currency, amount: Math.abs(c.amount), reason: c.reason, refType: c.refType ?? undefined, refId: c.refId ?? undefined },
      c.now,
      cond,
    ),
  ];
}

export interface PointChange {
  userId: string;
  pointType: PointType;
  amount: number;
  reason: string;
  refType?: string | null;
  refId?: string | null;
  opId: string;
  now: number;
}

export function pointStmts(env: Env, c: PointChange): D1PreparedStatement[] {
  if (!Number.isInteger(c.amount) || c.amount === 0) throw new Error('invalid amount');
  const col = POINT_COLUMN[c.pointType];
  return [
    env.DB.prepare(`UPDATE exchange_wallets SET ${col} = ${col} + ?, updated_at = ? WHERE user_id = ?`).bind(c.amount, c.now, c.userId),
    env.DB.prepare(
      `INSERT INTO exchange_transactions (id, user_id, point_type, amount, balance_after, reason, ref_type, ref_id, op_id, created_at)
       SELECT ?, ?, ?, ?, ${col}, ?, ?, ?, ?, ? FROM exchange_wallets WHERE user_id = ?`,
    ).bind(randomId(), c.userId, c.pointType, c.amount, c.reason, c.refType ?? null, c.refId ?? null, c.opId, c.now, c.userId),
  ];
}

// ---------------------------------------------------------------- rewards

export interface RewardGrant {
  userId: string;
  /** unique per user, e.g. "login:2026-11-14" */
  key: string;
  kind: string;
  currency: Currency;
  amount: number;
  refType?: string | null;
  refId?: string | null;
  opId: string;
  now: number;
}

/** condition: the claim row of `g` was written by this operation */
export function claimedNow(g: Pick<RewardGrant, 'userId' | 'key' | 'opId'>): Condition {
  return { sql: 'EXISTS (SELECT 1 FROM reward_claims WHERE user_id = ? AND reward_key = ? AND op_id = ? AND amount > 0)', binds: [g.userId, g.key, g.opId] };
}

/**
 * Records a reward and pays it once (4 statements). `amountSql` lets the amount
 * depend on rows written earlier in the same batch (daily match cap).
 */
export function rewardStmts(env: Env, g: RewardGrant, amountSql?: Condition): D1PreparedStatement[] {
  const claim = amountSql
    ? env.DB.prepare(
        `INSERT OR IGNORE INTO reward_claims (id, user_id, reward_key, kind, currency, amount, op_id, created_at)
         SELECT ?, ?, ?, ?, ?, CASE WHEN ${amountSql.sql} THEN ? ELSE 0 END, ?, ?`,
      ).bind(randomId(), g.userId, g.key, g.kind, g.currency, ...amountSql.binds, g.amount, g.opId, g.now)
    : env.DB.prepare('INSERT OR IGNORE INTO reward_claims (id, user_id, reward_key, kind, currency, amount, op_id, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(
        randomId(),
        g.userId,
        g.key,
        g.kind,
        g.currency,
        g.amount,
        g.opId,
        g.now,
      );
  const cond = claimedNow(g);
  const change: CurrencyChange = { userId: g.userId, currency: g.currency, amount: g.amount, reason: g.kind, refType: g.refType, refId: g.refId, opId: g.opId, now: g.now };
  const [update, ledger] = currencyStmts(env, change, cond);
  // reward_claimed + currency_earned in one statement
  const props = (name: string) => JSON.stringify(name === 'reward_claimed' ? { kind: g.kind, key: g.key, currency: g.currency, amount: g.amount } : { currency: g.currency, amount: g.amount, reason: g.kind, refType: g.refType ?? undefined, refId: g.refId ?? undefined });
  const analytics = env.DB.prepare(
    `INSERT INTO analytics_events (event_id, event_name, user_id, session_id, timestamp, platform, app_version, environment, properties_json)
     SELECT ?, 'reward_claimed', ?, NULL, ?, NULL, NULL, ?, ? WHERE ${cond.sql}
     UNION ALL
     SELECT ?, 'currency_earned', ?, NULL, ?, NULL, NULL, ?, ? WHERE ${cond.sql}`,
  ).bind(randomId(), g.userId, g.now, env.ENVIRONMENT, props('reward_claimed'), ...cond.binds, randomId(), g.userId, g.now, env.ENVIRONMENT, props('currency_earned'), ...cond.binds);
  return [claim, update, ledger, analytics];
}

/** amount actually paid for a reward key (null = not recorded) */
export async function claimedAmount(env: Env, userId: string, key: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT amount FROM reward_claims WHERE user_id = ? AND reward_key = ?').bind(userId, key).first<{ amount: number }>();
  return row ? row.amount : null;
}

// ---------------------------------------------------------------- missions

/** progress increments for every mission of the given metrics (current periods), one statement */
export function missionProgressStmts(env: Env, userId: string, metrics: Partial<Record<MissionMetric, number>>, now: number): D1PreparedStatement[] {
  const rows = MISSIONS.filter((m) => (metrics[m.metric] ?? 0) > 0).map((m) => ({ id: m.id, period: periodKey(m.period, now), inc: metrics[m.metric]!, target: m.target }));
  if (rows.length === 0) return [];
  return [
    env.DB.prepare(
      `INSERT INTO mission_progress (user_id, mission_id, period_key, progress, completed_at, updated_at)
       SELECT ?1, json_extract(j.value, '$.id'), json_extract(j.value, '$.period'),
              MIN(json_extract(j.value, '$.inc'), json_extract(j.value, '$.target')),
              CASE WHEN json_extract(j.value, '$.inc') >= json_extract(j.value, '$.target') THEN ?2 END, ?2
         FROM json_each(?3) j WHERE 1
       ON CONFLICT (user_id, mission_id, period_key) DO UPDATE SET
         completed_at = COALESCE(mission_progress.completed_at,
           CASE WHEN mission_progress.progress + excluded.progress >= (SELECT target FROM missions WHERE id = excluded.mission_id) THEN ?2 END),
         progress = MIN(mission_progress.progress + excluded.progress, (SELECT target FROM missions WHERE id = excluded.mission_id)),
         updated_at = ?2`,
    ).bind(userId, now, JSON.stringify(rows)),
  ];
}

/** current-period progress of the given users (one query) */
export async function currentMissionProgress(env: Env, userIds: string[], now: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  const keys = [periodKey('daily', now), periodKey('weekly', now), 'once'];
  const rows = await env.DB.prepare(
    `SELECT user_id, mission_id, period_key, progress FROM mission_progress
      WHERE user_id IN (${userIds.map(() => '?').join(',')}) AND period_key IN (?, ?, ?)`,
  )
    .bind(...userIds, ...keys)
    .all<{ user_id: string; mission_id: string; period_key: string; progress: number }>();
  for (const r of rows.results) out.set(`${r.user_id}|${r.mission_id}|${r.period_key}`, r.progress);
  return out;
}

/** missions that `metrics` completes, given the progress before */
export function missionsCompletedFrom(progress: Map<string, number>, userId: string, metrics: Partial<Record<MissionMetric, number>>, now: number): string[] {
  return MISSIONS.filter((m) => {
    const inc = metrics[m.metric] ?? 0;
    if (inc <= 0) return false;
    const before = progress.get(`${userId}|${m.id}|${periodKey(m.period, now)}`) ?? 0;
    return before < m.target && before + inc >= m.target;
  }).map((m) => m.id);
}

export async function missionsCompletedBy(env: Env, userId: string, metrics: Partial<Record<MissionMetric, number>>, now: number): Promise<string[]> {
  if (!MISSIONS.some((m) => (metrics[m.metric] ?? 0) > 0)) return [];
  return missionsCompletedFrom(await currentMissionProgress(env, [userId], now), userId, metrics, now);
}

export function missionCompletedAnalytics(env: Env, userId: string, missionIds: string[], now: number): D1PreparedStatement[] {
  if (missionIds.length === 0) return [];
  const rows = missionIds.map((id) => ({ e: randomId(), p: JSON.stringify({ missionId: id, periodKey: periodKey(MISSION_BY_ID[id].period, now) }) }));
  return [
    env.DB.prepare(
      `INSERT INTO analytics_events (event_id, event_name, user_id, session_id, timestamp, platform, app_version, environment, properties_json)
       SELECT json_extract(j.value, '$.e'), 'mission_completed', ?, NULL, ?, NULL, NULL, ?, json_extract(j.value, '$.p') FROM json_each(?) j`,
    ).bind(userId, now, env.ENVIRONMENT, JSON.stringify(rows)),
  ];
}

// ---------------------------------------------------------------- spending operations

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function requestIdOf(v: unknown): string {
  if (typeof v !== 'string' || !REQUEST_ID.test(v)) throw new ApiError('BAD_REQUEST', 'requestId (8-64 characters: letters, digits, - and _) is required');
  return v;
}

async function storedResponse<T>(env: Env, userId: string, requestId: string, kind: string): Promise<T | null> {
  const row = await env.DB.prepare('SELECT kind, response_json FROM economy_requests WHERE user_id = ? AND request_key = ?').bind(userId, requestId).first<{ kind: string; response_json: string }>();
  if (!row) return null;
  if (row.kind !== kind) throw new ApiError('CONFLICT', 'requestId was already used for another operation');
  return { ...(JSON.parse(row.response_json) as T), replayed: true };
}

export interface OperationPlan<T> {
  statements: D1PreparedStatement[];
  response: T;
}

/**
 * Runs a read-compute-write operation of one user exactly once per request id.
 * `plan` reads the current state and returns the statements to write; it is
 * re-run (up to 8 times) when another operation of the same user committed in
 * between. Errors thrown by `plan` (e.g. not enough balance) are returned as is.
 */
const MAX_ATTEMPTS = 8;

export async function runOperation<T extends object>(
  env: Env,
  userId: string,
  requestId: string,
  kind: string,
  plan: (ctx: { opId: string; now: number }) => Promise<OperationPlan<T>>,
): Promise<T & { replayed?: boolean }> {
  const previous = await storedResponse<T>(env, userId, requestId, kind);
  if (previous) return previous;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // short random wait before a retry so simultaneous requests do not collide again
    if (attempt > 0) await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 40 * attempt)));
    const now = Date.now();
    const opId = randomId();
    const seqRow = await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM economy_ops WHERE user_id = ?').bind(userId).first<{ seq: number }>();
    const seq = (seqRow?.seq ?? 0) + 1;
    const { statements, response } = await plan({ opId, now });
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO economy_ops (user_id, seq, op, op_id, created_at) VALUES (?,?,?,?,?)').bind(userId, seq, kind, opId, now),
        ...ensureWalletStmts(env, userId, now),
        ...statements,
        env.DB.prepare('INSERT INTO economy_requests (user_id, request_key, kind, op_id, response_json, created_at) VALUES (?,?,?,?,?,?)').bind(userId, requestId, kind, opId, JSON.stringify(response), now),
      ]);
      return response;
    } catch (err) {
      const stored = await storedResponse<T>(env, userId, requestId, kind);
      if (stored) return stored;
      console.warn('economy operation retried', kind, String(err));
    }
  }
  throw new ApiError('CONFLICT', 'the operation could not be completed, please try again');
}
