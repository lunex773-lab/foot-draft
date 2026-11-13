/**
 * Ranked (spec 2-2, Phase 3): rating, tiers and seasons.
 *
 * Decisions (docs/02-decisions.md 24-27):
 * - Elo from the final league ranks: every pair of human players is treated as
 *   one game (the better final rank wins). Start 1000.
 * - Only human players count. CPU seats (empty seats filled after 60 s) are
 *   ignored; with fewer than 2 humans the rating does not change.
 * - Monthly seasons in Japan time. A new season starts from the previous rating
 *   pulled halfway back to 1000.
 */

/** provisional values (tuned after beta tests) */
export const RANKED_CONFIG = {
  initialRating: 1000,
  /** Elo K factor for one league (split across the opponents) */
  k: 32,
  /** seconds to wait for 4 humans before filling with CPU */
  queueSeconds: 60,
  /** new season: rating = initial + (previous - initial) * carryOver */
  carryOver: 0.5,
  /** leaderboard size */
  leaderboardSize: 100,
} as const;

export type TierId = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'legend';

export interface TierInfo {
  id: TierId;
  label: string;
  labelJa: string;
  /** inclusive lower bound */
  min: number;
  color: string;
}

/** provisional tier thresholds */
export const TIERS: TierInfo[] = [
  { id: 'bronze', label: 'BRONZE', labelJa: 'ブロンズ', min: -Infinity, color: '#b0793f' },
  { id: 'silver', label: 'SILVER', labelJa: 'シルバー', min: 900, color: '#c3c9d4' },
  { id: 'gold', label: 'GOLD', labelJa: 'ゴールド', min: 1050, color: '#e6b84a' },
  { id: 'platinum', label: 'PLATINUM', labelJa: 'プラチナ', min: 1200, color: '#6fd3c9' },
  { id: 'diamond', label: 'DIAMOND', labelJa: 'ダイヤモンド', min: 1350, color: '#7fb2ff' },
  { id: 'legend', label: 'LEGEND', labelJa: 'レジェンド', min: 1500, color: '#c58bff' },
];

export function tierOf(rating: number): TierInfo {
  let t = TIERS[0];
  for (const x of TIERS) if (rating >= x.min) t = x;
  return t;
}

export interface RatedEntry {
  id: string;
  rating: number;
  /** final league rank (1 = best) */
  rank: number;
}

export interface RatingChange {
  id: string;
  before: number;
  after: number;
  delta: number;
}

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/**
 * Multiplayer Elo. Each pair is one game (better rank = 1, equal rank = 0.5);
 * K is split across the n-1 opponents so a league moves a rating by at most K.
 * With fewer than two entries nobody changes.
 */
export function eloFromRanks(entries: readonly RatedEntry[], k: number = RANKED_CONFIG.k): RatingChange[] {
  const n = entries.length;
  if (n < 2) return entries.map((e) => ({ id: e.id, before: e.rating, after: e.rating, delta: 0 }));
  return entries.map((e) => {
    let sum = 0;
    for (const o of entries) {
      if (o === e) continue;
      const score = e.rank < o.rank ? 1 : e.rank > o.rank ? 0 : 0.5;
      sum += score - expectedScore(e.rating, o.rating);
    }
    const delta = Math.round((k / (n - 1)) * sum);
    return { id: e.id, before: e.rating, after: e.rating + delta, delta };
  });
}

/** starting rating of a new season */
export function carryOverRating(previous: number | null | undefined): number {
  if (previous === null || previous === undefined || !Number.isFinite(previous)) return RANKED_CONFIG.initialRating;
  return Math.round(RANKED_CONFIG.initialRating + (previous - RANKED_CONFIG.initialRating) * RANKED_CONFIG.carryOver);
}

// ------------------------------------------------------------------ seasons

/** Japan time offset (no daylight saving) */
const JST_MS = 9 * 60 * 60 * 1000;

export interface SeasonInfo {
  /** e.g. "2026-11" */
  id: string;
  /** e.g. "2026年11月シーズン" */
  nameJa: string;
  /** epoch ms, inclusive (00:00 JST on the 1st) */
  startsAt: number;
  /** epoch ms, exclusive (00:00 JST on the 1st of the next month) */
  endsAt: number;
}

/** monthly season (Japan time) that contains the given time */
export function seasonAt(time: number): SeasonInfo {
  const d = new Date(time + JST_MS);
  return seasonById(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
}

export function seasonById(id: string): SeasonInfo {
  const m = /^(\d{4})-(\d{2})$/.exec(id);
  if (!m) throw new Error(`invalid season id: ${id}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error(`invalid season id: ${id}`);
  const startsAt = Date.UTC(year, month - 1, 1) - JST_MS;
  const endsAt = Date.UTC(year, month, 1) - JST_MS;
  return { id, nameJa: `${year}年${month}月シーズン`, startsAt, endsAt };
}

export function previousSeasonId(id: string): string {
  return seasonAt(seasonById(id).startsAt - 1).id;
}

/** Japan date key "YYYY-MM-DD" (used by the daily Solo Challenge) */
export function jstDateKey(time: number): string {
  return new Date(time + JST_MS).toISOString().slice(0, 10);
}

/** [start, end) of a Japan date key in epoch ms */
export function jstDayRange(dateKey: string): { startsAt: number; endsAt: number } {
  const startsAt = Date.parse(`${dateKey}T00:00:00Z`) - JST_MS;
  return { startsAt, endsAt: startsAt + 24 * 60 * 60 * 1000 };
}
