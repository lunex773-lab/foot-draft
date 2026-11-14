/**
 * Season Pass (decisions 54, 56). Monthly like the Ranked season (Japan
 * time), 30 levels. Provisional values (docs/09-phase6-plan.md).
 */
import type { Currency } from './config';

export const PASS_CONFIG = {
  levels: 30,
  xpPerLevel: 200,
  /** per finished league that gave a match reward (10 per Japan day) */
  xpPerLeague: 100,
  xpFirstPlaceBonus: 50,
  /** premium track price in GEMS (FREE GEMS first, decision 56) */
  premiumPriceGems: 800,
} as const;

export type PassTrack = 'free' | 'premium';

export type PassReward =
  | { type: 'currency'; currency: Extract<Currency, 'COINS' | 'GEMS_FREE'>; amount: number }
  | { type: 'points'; pointType: 'standard' | 'premium'; amount: number }
  /** a card the player does not own yet (points when every card is owned) */
  | { type: 'card'; rarity: 'epic' | 'legendary'; fallbackPoints: number };

/** rewards of one level and track (several per level are possible) */
export function passRewards(track: PassTrack, level: number): PassReward[] {
  if (level < 1 || level > PASS_CONFIG.levels) return [];
  const out: PassReward[] = [];
  if (track === 'free') {
    if (level % 2 === 1) out.push({ type: 'currency', currency: 'COINS', amount: 100 });
    if (level % 3 === 0) out.push({ type: 'currency', currency: 'GEMS_FREE', amount: 30 });
    return out;
  }
  if (level === 15) return [{ type: 'card', rarity: 'epic', fallbackPoints: 1000 }];
  if (level === 30) return [{ type: 'card', rarity: 'legendary', fallbackPoints: 3000 }];
  if (level === 5 || level === 20) return [{ type: 'points', pointType: 'standard', amount: 300 }];
  if (level === 10 || level === 25) return [{ type: 'points', pointType: 'premium', amount: 100 }];
  return [{ type: 'currency', currency: 'COINS', amount: 200 }];
}

export function passLevel(xp: number): number {
  return Math.min(PASS_CONFIG.levels, Math.floor(Math.max(0, xp) / PASS_CONFIG.xpPerLevel));
}

export function leagueXp(rank: number): number {
  return PASS_CONFIG.xpPerLeague + (rank === 1 ? PASS_CONFIG.xpFirstPlaceBonus : 0);
}

/** totals of a track (for the UI and tests) */
export function passTotals(track: PassTrack) {
  const t = { coins: 0, gemsFree: 0, standardPoints: 0, premiumPoints: 0, cards: 0 };
  for (let l = 1; l <= PASS_CONFIG.levels; l++) {
    for (const r of passRewards(track, l)) {
      if (r.type === 'currency') r.currency === 'COINS' ? (t.coins += r.amount) : (t.gemsFree += r.amount);
      else if (r.type === 'points') r.pointType === 'standard' ? (t.standardPoints += r.amount) : (t.premiumPoints += r.amount);
      else t.cards += 1;
    }
  }
  return t;
}

/**
 * Splits a GEMS price across the balances, FREE GEMS first, then distributed
 * PAID GEMS, then purchased PAID GEMS (decision 56). null = not enough.
 */
export function splitGemsFreeFirst(
  cost: number,
  b: { GEMS_FREE: number; GEMS_PAID_GRANTED: number; GEMS_PAID_PURCHASED: number },
): Partial<Record<'GEMS_FREE' | 'GEMS_PAID_GRANTED' | 'GEMS_PAID_PURCHASED', number>> | null {
  if (b.GEMS_FREE + b.GEMS_PAID_GRANTED + b.GEMS_PAID_PURCHASED < cost) return null;
  let left = cost;
  const out: Partial<Record<'GEMS_FREE' | 'GEMS_PAID_GRANTED' | 'GEMS_PAID_PURCHASED', number>> = {};
  for (const c of ['GEMS_FREE', 'GEMS_PAID_GRANTED', 'GEMS_PAID_PURCHASED'] as const) {
    const take = Math.min(b[c], left);
    if (take > 0) out[c] = take;
    left -= take;
  }
  return out;
}
