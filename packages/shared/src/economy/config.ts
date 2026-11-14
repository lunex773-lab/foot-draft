/**
 * Economy configuration (Phase 4). Values marked provisional come from the
 * specification (sections 8-10) or docs/07-phase4-plan.md and are tuned after
 * beta tests. Decisions: docs/02-decisions.md 36-44.
 */
import type { Rarity } from '../types';

/** wallet balances are kept separately (spec 8-1, 8-4) */
export type Currency = 'COINS' | 'GEMS_FREE' | 'GEMS_PAID_PURCHASED' | 'GEMS_PAID_GRANTED';
export const CURRENCIES: Currency[] = ['COINS', 'GEMS_FREE', 'GEMS_PAID_PURCHASED', 'GEMS_PAID_GRANTED'];

/** exchange points from duplicate cards, kept separately per gacha kind (spec 9-4) */
export type PointType = 'standard' | 'premium';

export const CURRENCY_LABEL_JA: Record<Currency, string> = {
  COINS: 'COINS',
  GEMS_FREE: 'GEMS（無償）',
  GEMS_PAID_PURCHASED: 'GEMS（有償・購入）',
  GEMS_PAID_GRANTED: 'GEMS（有償・配布）',
};

export const ECONOMY_CONFIG = {
  /** provisional (spec 10-1): per league */
  matchReward: {
    participation: 100,
    rankBonus: { 1: 150, 2: 100, 3: 50, 4: 25 } as Record<number, number>,
    /** decision 41: leagues per Japan day that give match rewards (all modes) */
    dailyLeagueCap: 10,
  },
  /** provisional (spec 10-1: 100-300) */
  loginBonus: { daily: 100, streakDays: 7, streakAmount: 300 },
  /** provisional: first clear of the day's Solo Challenge */
  soloClearReward: 200,
  /** provisional: Special Event league rank bonus (outside the daily cap) */
  eventRankBonus: { 1: 100, 2: 50 } as Record<number, number>,
  /** provisional (spec 10-2: 100-300 FREE GEMS) */
  seasonReward: { first: 300, top10: 200, participant: 100 },
  /** spec 9-4 */
  duplicatePoints: { common: 10, rare: 30, epic: 100, legendary: 300, icon: 1000 } as Record<Rarity, number>,
  /** spec 9-5 */
  exchangePrices: { common: 100, rare: 300, epic: 1000, legendary: 3000, icon: 10000 } as Record<Rarity, number>,
  /** decision 43 */
  exchangeRarities: { standard: ['common', 'rare', 'epic', 'legendary'], premium: ['rare', 'epic', 'legendary', 'icon'] } as Record<PointType, Rarity[]>,
  /** decision 44: spend order of PAID GEMS (expert check pending) */
  paidGemsSpendOrder: ['GEMS_PAID_GRANTED', 'GEMS_PAID_PURCHASED'] as Currency[],
  /** decision 36: own cards reserved per player in Collection Draft */
  collectionDraftSlots: 3,
  /** staging-only test grants: max per operation */
  testGrantMax: 1_000_000,
} as const;

export function matchRewardFor(rank: number): { participation: number; rankBonus: number; total: number } {
  const participation = ECONOMY_CONFIG.matchReward.participation;
  const rankBonus = ECONOMY_CONFIG.matchReward.rankBonus[rank] ?? 0;
  return { participation, rankBonus, total: participation + rankBonus };
}

export function seasonRewardFor(position: number): number {
  const r = ECONOMY_CONFIG.seasonReward;
  return position === 1 ? r.first : position <= 10 ? r.top10 : r.participant;
}

/** day N of a login streak (1-based) */
export function loginBonusFor(streakDay: number): number {
  const b = ECONOMY_CONFIG.loginBonus;
  return streakDay > 0 && streakDay % b.streakDays === 0 ? b.streakAmount : b.daily;
}

/**
 * Splits a PAID GEMS cost across the two paid balances in the configured
 * order (decision 44). Returns null when the total is not enough.
 */
export function splitPaidGems(cost: number, balances: { GEMS_PAID_GRANTED: number; GEMS_PAID_PURCHASED: number }): Partial<Record<Currency, number>> | null {
  if (balances.GEMS_PAID_GRANTED + balances.GEMS_PAID_PURCHASED < cost) return null;
  let left = cost;
  const out: Partial<Record<Currency, number>> = {};
  for (const c of ECONOMY_CONFIG.paidGemsSpendOrder) {
    const have = balances[c as 'GEMS_PAID_GRANTED' | 'GEMS_PAID_PURCHASED'];
    const take = Math.min(have, left);
    if (take > 0) out[c] = take;
    left -= take;
  }
  return out;
}
