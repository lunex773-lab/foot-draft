import { ECONOMY_CONFIG, MEMBERSHIP_CONFIG, jstDateKey, leagueXp, seasonAt, leagueMetrics, loginBonusFor, matchRewardFor, seasonRewardFor, type RoomMode, type SeatReward } from '@fd/shared';
import type { Env } from '../env';
import { randomId } from './crypto';
import { membershipOf } from './purchases';
import { claimedNow, currentMissionProgress, ensureWalletStmts, missionCompletedAnalytics, missionProgressStmts, missionsCompletedFrom, pointStmts, rewardStmts } from './economy';

/**
 * Rewards (spec 10, decisions 40-41). Every reward has a unique key per user;
 * see lib/economy.ts for how a key is paid at most once.
 */

const CAP = ECONOMY_CONFIG.matchReward.dailyLeagueCap;

export async function leaguesRewardedToday(env: Env, userId: string, now = Date.now()): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM daily_match_rewards WHERE user_id = ? AND day_key = ?').bind(userId, jstDateKey(now)).first<{ n: number }>();
  return row?.n ?? 0;
}

export interface LeagueRewardInput {
  userId: string;
  rank: number;
  matchWins: number;
  manualPicks: number;
  /** goals scored in the league (mission "goals") */
  goals?: number;
  /** Solo Challenge cleared (the first clear of a challenge is rewarded) */
  soloClearedChallengeId?: string | null;
  /** MATCH: Standard exchange points by rank, paid with the match reward only (decision 71) */
  exchangePoints?: number;
}

/**
 * Match reward (participation + rank, within the daily cap), Solo clear and
 * Special Event rank bonuses (outside the cap) and mission progress of the
 * human seats after a league. One D1 batch for all seats; safe to run again
 * (an already rewarded league pays nothing and adds no mission progress).
 */
export async function grantLeagueRewards(env: Env, roomId: string, mode: RoomMode, inputs: LeagueRewardInput[], now: number): Promise<Map<string, SeatReward>> {
  const out = new Map<string, SeatReward>();
  if (inputs.length === 0) return out;
  const day = jstDateKey(now);
  const passSeason = seasonAt(now).id;
  const opId = randomId();
  const matchKey = `match:${roomId}`;
  const users = inputs.map((i) => i.userId);
  const inList = users.map(() => '?').join(',');
  const done = new Set(
    (await env.DB.prepare(`SELECT user_id FROM reward_claims WHERE reward_key = ? AND user_id IN (${inList})`).bind(matchKey, ...users).all<{ user_id: string }>()).results.map((r) => r.user_id),
  );
  const progress = await currentMissionProgress(env, users.filter((u) => !done.has(u)), now);

  const stmts: D1PreparedStatement[] = [];
  const keysOf = new Map<string, string[]>();
  const completedOf = new Map<string, string[]>();
  for (const input of inputs) {
    const { userId } = input;
    const keys = [matchKey];
    const metrics = leagueMetrics({ mode, rank: input.rank, matchWins: input.matchWins, manualPicks: input.manualPicks, goals: input.goals });
    const slotHeld = { sql: 'EXISTS (SELECT 1 FROM daily_match_rewards WHERE user_id = ? AND room_id = ?)', binds: [userId, roomId] };
    stmts.push(
      ...ensureWalletStmts(env, userId, now),
      // take one of the 10 daily slots (none left -> no row, no reward)
      env.DB.prepare(
        `INSERT OR IGNORE INTO daily_match_rewards (user_id, day_key, slot, room_id, created_at)
         SELECT ?1, ?2, COUNT(*) + 1, ?3, ?4 FROM daily_match_rewards WHERE user_id = ?1 AND day_key = ?2
         HAVING COUNT(*) < ?5 AND NOT EXISTS (SELECT 1 FROM reward_claims WHERE user_id = ?1 AND reward_key = ?6)`,
      ).bind(userId, day, roomId, now, CAP, matchKey),
      ...rewardStmts(env, { userId, key: matchKey, kind: 'match_reward', currency: 'COINS', amount: matchRewardFor(input.rank).total, refType: 'room', refId: roomId, opId, now }, slotHeld),
    );
    if (input.exchangePoints && input.exchangePoints > 0) {
      // recorded like a reward (key per room), paid as Standard points when the daily slot was taken
      const key = `mpoints:${roomId}`;
      keys.push(key);
      stmts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO reward_claims (id, user_id, reward_key, kind, currency, amount, op_id, created_at)
           SELECT ?, ?, ?, 'match_points', 'POINTS_STANDARD', CASE WHEN ${slotHeld.sql} THEN ? ELSE 0 END, ?, ?`,
        ).bind(randomId(), userId, key, ...slotHeld.binds, input.exchangePoints, opId, now),
        ...pointStmts(env, { userId, pointType: 'standard', amount: input.exchangePoints, reason: 'match_reward', refType: 'room', refId: roomId, opId, now }, claimedNow({ userId, key, opId })),
      );
    }
    if (input.soloClearedChallengeId) {
      const key = `solo:${input.soloClearedChallengeId}`;
      keys.push(key);
      stmts.push(...rewardStmts(env, { userId, key, kind: 'solo_clear', currency: 'COINS', amount: ECONOMY_CONFIG.soloClearReward, refType: 'room', refId: roomId, opId, now }));
    }
    const eventBonus = mode === 'event' ? ECONOMY_CONFIG.eventRankBonus[input.rank] ?? 0 : 0;
    if (eventBonus > 0) {
      const key = `event:${roomId}`;
      keys.push(key);
      stmts.push(...rewardStmts(env, { userId, key, kind: 'event_bonus', currency: 'COINS', amount: eventBonus, refType: 'room', refId: roomId, opId, now }));
    }
    // Season Pass experience: only for leagues that gave a match reward (10 per day)
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO season_pass_xp (user_id, room_id, season_id, xp, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM daily_match_rewards WHERE user_id = ?1 AND room_id = ?2)`,
      ).bind(userId, roomId, passSeason, leagueXp(input.rank), now),
      env.DB.prepare(
        `INSERT INTO season_pass_progress (user_id, season_id, xp, updated_at)
         SELECT x.user_id, x.season_id, x.xp, ?3 FROM season_pass_xp x WHERE x.user_id = ?1 AND x.room_id = ?2 AND x.created_at = ?3
         ON CONFLICT (user_id, season_id) DO UPDATE SET xp = season_pass_progress.xp + excluded.xp, updated_at = excluded.updated_at`,
      ).bind(userId, roomId, now),
    );
    keysOf.set(userId, keys);
    if (!done.has(userId)) {
      // mission progress counts every league, also above the daily cap (decision 41)
      const completed = missionsCompletedFrom(progress, userId, metrics, now);
      completedOf.set(userId, completed);
      stmts.push(...missionProgressStmts(env, userId, metrics, now), ...missionCompletedAnalytics(env, userId, completed, now));
    }
  }
  await env.DB.batch(stmts);

  // a solo room has one human, so there is at most one challenge key
  const soloId = inputs.find((i) => i.soloClearedChallengeId)?.soloClearedChallengeId;
  const soloKey = soloId ? `solo:${soloId}` : null;
  const claims = await env.DB.prepare(
    `SELECT user_id, reward_key, amount, op_id FROM reward_claims WHERE user_id IN (${inList}) AND reward_key IN (?, ?, ?, ?)`,
  )
    .bind(...users, matchKey, `event:${roomId}`, soloKey ?? '-', `mpoints:${roomId}`)
    .all<{ user_id: string; reward_key: string; amount: number; op_id: string }>();
  const xpRows = await env.DB.prepare(`SELECT user_id, xp FROM season_pass_xp WHERE room_id = ? AND user_id IN (${inList})`)
    .bind(roomId, ...users)
    .all<{ user_id: string; xp: number }>();
  const counts = await env.DB.prepare(`SELECT user_id, COUNT(*) AS n FROM daily_match_rewards WHERE day_key = ? AND user_id IN (${inList}) GROUP BY user_id`)
    .bind(day, ...users)
    .all<{ user_id: string; n: number }>();
  for (const userId of users) {
    const mine = claims.results.filter((c) => c.user_id === userId && keysOf.get(userId)!.includes(c.reward_key));
    const matchPaid = mine.find((c) => c.reward_key === matchKey)?.amount ?? 0;
    const exchangePoints = mine.find((c) => c.reward_key.startsWith('mpoints:'))?.amount ?? 0;
    // a solo clear is paid once per challenge: a later clear of the same challenge shows no bonus
    const bonus = mine
      .filter((c) => c.reward_key !== matchKey && !c.reward_key.startsWith('mpoints:') && (c.op_id === opId || c.reward_key.startsWith('event:')))
      .reduce((sum, c) => sum + c.amount, 0);
    out.set(userId, {
      coins: matchPaid + bonus,
      matchRewardGiven: matchPaid > 0,
      bonus,
      leaguesToday: counts.results.find((r) => r.user_id === userId)?.n ?? 0,
      missionsCompleted: completedOf.get(userId) ?? [],
      passXp: xpRows.results.find((r) => r.user_id === userId)?.xp ?? 0,
      ...(mode === 'match' ? { exchangePoints } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------- login bonus

export interface LoginBonusStatus {
  dayKey: string;
  claimedToday: boolean;
  /** streak including today when claimed */
  streak: number;
  /** amount of today's bonus (claimed or not) */
  amount: number;
}

function previousDayKey(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function loginBonusStatus(env: Env, userId: string, now = Date.now()): Promise<LoginBonusStatus> {
  const dayKey = jstDateKey(now);
  const row = await env.DB.prepare('SELECT last_day_key, streak FROM login_streaks WHERE user_id = ?').bind(userId).first<{ last_day_key: string; streak: number }>();
  if (row?.last_day_key === dayKey) return { dayKey, claimedToday: true, streak: row.streak, amount: loginBonusFor(row.streak) };
  const streak = row && row.last_day_key === previousDayKey(dayKey) ? row.streak + 1 : 1;
  return { dayKey, claimedToday: false, streak, amount: loginBonusFor(streak) };
}

/** Premium Membership (decision 55): daily FREE GEMS while active; once per Japan day */
async function claimMembershipDaily(env: Env, userId: string, now: number): Promise<number> {
  if (!(await membershipOf(env, userId, now)).active) return 0;
  const dayKey = jstDateKey(now);
  const key = `membership:${dayKey}`;
  const opId = randomId();
  await env.DB.batch([
    ...ensureWalletStmts(env, userId, now),
    ...rewardStmts(env, { userId, key, kind: 'membership_daily', currency: 'GEMS_FREE', amount: MEMBERSHIP_CONFIG.dailyFreeGems, refType: 'day', refId: dayKey, opId, now }),
  ]);
  const row = await env.DB.prepare('SELECT op_id, amount FROM reward_claims WHERE user_id = ? AND reward_key = ?').bind(userId, key).first<{ op_id: string; amount: number }>();
  return row?.op_id === opId ? row.amount : 0;
}

/** pays today's login bonus once (Japan day), and the membership's daily GEMS */
export async function claimLoginBonus(env: Env, userId: string, now = Date.now()): Promise<LoginBonusStatus & { paid: number; membershipGems: number }> {
  const membershipGems = await claimMembershipDaily(env, userId, now);
  const result = await claimLoginBonusOnly(env, userId, now);
  return { ...result, membershipGems };
}

async function claimLoginBonusOnly(env: Env, userId: string, now: number): Promise<LoginBonusStatus & { paid: number }> {
  const status = await loginBonusStatus(env, userId, now);
  if (status.claimedToday) return { ...status, paid: 0 };
  const opId = randomId();
  const key = `login:${status.dayKey}`;
  await env.DB.batch([
    ...ensureWalletStmts(env, userId, now),
    ...rewardStmts(env, { userId, key, kind: 'login_bonus', currency: 'COINS', amount: status.amount, refType: 'day', refId: status.dayKey, opId, now }),
    env.DB.prepare(
      `INSERT INTO login_streaks (user_id, last_day_key, streak, best_streak, updated_at) VALUES (?1, ?2, ?3, ?3, ?4)
       ON CONFLICT (user_id) DO UPDATE SET last_day_key = ?2, streak = ?3, best_streak = MAX(best_streak, ?3), updated_at = ?4
       WHERE login_streaks.last_day_key <> ?2`,
    ).bind(userId, status.dayKey, status.streak, now),
  ]);
  const row = await env.DB.prepare('SELECT op_id, amount FROM reward_claims WHERE user_id = ? AND reward_key = ?').bind(userId, key).first<{ op_id: string; amount: number }>();
  return { ...status, claimedToday: true, paid: row?.op_id === opId ? row.amount : 0 };
}

// ---------------------------------------------------------------- season rewards and pending rewards

/** FREE GEMS for the final standings of a finished season (decision 40) */
export async function grantSeasonRewards(env: Env, seasonId: string, now = Date.now(), userId?: string) {
  const rows = await env.DB.prepare(`SELECT user_id, final_position FROM season_results WHERE season_id = ?${userId ? ' AND user_id = ?' : ''}`)
    .bind(...(userId ? [seasonId, userId] : [seasonId]))
    .all<{ user_id: string; final_position: number }>();
  const opId = randomId();
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows.results) {
    stmts.push(
      ...ensureWalletStmts(env, r.user_id, now),
      ...rewardStmts(env, {
        userId: r.user_id,
        key: `season:${seasonId}`,
        kind: 'season_reward',
        currency: 'GEMS_FREE',
        amount: seasonRewardFor(r.final_position),
        refType: 'season',
        refId: seasonId,
        opId,
        now,
      }),
    );
  }
  // D1 limits the statements per batch: write in chunks
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
}

/**
 * Pays rewards that were recorded before the currencies existed (Phase 3) or
 * that could not be written at the time: season rewards, Solo Challenge clears
 * and Special Event rank bonuses. Cheap when nothing is pending.
 */
export async function settlePendingRewards(env: Env, userId: string, now = Date.now()) {
  const seasons = await env.DB.prepare(
    `SELECT sr.season_id FROM season_results sr
      WHERE sr.user_id = ?1 AND NOT EXISTS (SELECT 1 FROM reward_claims c WHERE c.user_id = ?1 AND c.reward_key = 'season:' || sr.season_id)`,
  )
    .bind(userId)
    .all<{ season_id: string }>();
  for (const s of seasons.results) await grantSeasonRewards(env, s.season_id, now, userId);

  const solos = await env.DB.prepare(
    `SELECT a.challenge_id, MIN(a.room_id) AS room_id FROM solo_attempts a
      WHERE a.user_id = ?1 AND a.status = 'cleared'
        AND NOT EXISTS (SELECT 1 FROM reward_claims c WHERE c.user_id = ?1 AND c.reward_key = 'solo:' || a.challenge_id)
      GROUP BY a.challenge_id`,
  )
    .bind(userId)
    .all<{ challenge_id: string; room_id: string }>();
  const events = await env.DB.prepare(
    `SELECT r.id AS room_id, rm.final_rank FROM rooms r JOIN room_members rm ON rm.room_id = r.id
      WHERE rm.user_id = ?1 AND r.mode = 'event' AND r.status = 'finished' AND rm.final_rank IN (1, 2)
        AND NOT EXISTS (SELECT 1 FROM reward_claims c WHERE c.user_id = ?1 AND c.reward_key = 'event:' || r.id)
      LIMIT 50`,
  )
    .bind(userId)
    .all<{ room_id: string; final_rank: number }>();
  if (solos.results.length === 0 && events.results.length === 0) return;
  const opId = randomId();
  const stmts: D1PreparedStatement[] = [...ensureWalletStmts(env, userId, now)];
  for (const s of solos.results) {
    stmts.push(...rewardStmts(env, { userId, key: `solo:${s.challenge_id}`, kind: 'solo_clear', currency: 'COINS', amount: ECONOMY_CONFIG.soloClearReward, refType: 'room', refId: s.room_id, opId, now }));
  }
  for (const e of events.results) {
    const amount = ECONOMY_CONFIG.eventRankBonus[e.final_rank] ?? 0;
    if (amount > 0) stmts.push(...rewardStmts(env, { userId, key: `event:${e.room_id}`, kind: 'event_bonus', currency: 'COINS', amount, refType: 'room', refId: e.room_id, opId, now }));
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
}
