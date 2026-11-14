/**
 * Gacha (spec 9, decisions 37-39). Pure logic: the draw engine takes a random
 * source so the server can use crypto randomness and tests a seeded one.
 */
import { RARITIES, rarityRank } from '../data/rarities';
import { Rng } from '../rng';
import type { Player, Rarity } from '../types';
import { ECONOMY_CONFIG, type PointType } from './config';

export type GachaKind = 'standard' | 'premium';

export interface GachaBannerDef {
  id: string;
  kind: GachaKind;
  /** pity is kept per series and carried over to reruns of the same series */
  seriesId: string;
  nameJa: string;
  descriptionJa: string;
  cost: { currency: 'COINS' | 'GEMS_PAID'; single: number; multi: number };
  /** parts per million, sum = 1,000,000 */
  ratesPpm: Record<Rarity, number>;
  pity: null | { epicAt: number; legendaryAt: number; bonusEvery: number };
  ratesVersion: number;
  /** epoch ms; null = no end (permanent) */
  startsAt: number;
  endsAt: number | null;
}

export const PPM = 1_000_000;

/** initial banners (seeded into D1 by migration 0005) */
export const GACHA_BANNERS: GachaBannerDef[] = [
  {
    id: 'standard',
    kind: 'standard',
    seriesId: 'standard',
    nameJa: 'スタンダードガシャ',
    descriptionJa: 'COINSで引ける常設ガシャ。天井・確率上昇・最低保証はありません（毎回独立した抽選）。',
    cost: { currency: 'COINS', single: 1000, multi: 10000 },
    ratesPpm: { common: 600_000, rare: 280_000, epic: 100_000, legendary: 20_000, icon: 0 },
    pity: null,
    ratesVersion: 1,
    startsAt: Date.UTC(2026, 10, 1),
    endsAt: null,
  },
  {
    id: 'premium-s1',
    kind: 'premium',
    seriesId: 'premium-s1',
    nameJa: 'プレミアムガシャ シリーズ1',
    descriptionJa:
      '有償GEMSで引けるガシャ。Epic以上が50回出なければ50回目でEpic以上、Legendary以上が100回出なければ100回目でLegendary以上を保証。累計150回ごとにEpic以上確定の単発が無料で1回引かれます。天井の回数はシリーズ内で引き継がれ、別シリーズには移りません。',
    cost: { currency: 'GEMS_PAID', single: 100, multi: 1000 },
    ratesPpm: { common: 0, rare: 650_000, epic: 250_000, legendary: 90_000, icon: 10_000 },
    pity: { epicAt: 50, legendaryAt: 100, bonusEvery: 150 },
    ratesVersion: 1,
    startsAt: Date.UTC(2026, 10, 1),
    // provisional: 2027-01-31 23:59:59 JST
    endsAt: Date.UTC(2027, 0, 31, 15, 0, 0) - 1000,
  },
];

export function ratesSum(rates: Record<Rarity, number>): number {
  return RARITIES.reduce((s, r) => s + (rates[r] ?? 0), 0);
}

/** cards of each rarity a banner can give (rarities with a 0 rate are empty) */
export function bannerPool(banner: GachaBannerDef, catalog: readonly Player[]): Record<Rarity, string[]> {
  const pool = Object.fromEntries(RARITIES.map((r) => [r, [] as string[]])) as Record<Rarity, string[]>;
  for (const p of catalog) if ((banner.ratesPpm[p.rarity] ?? 0) > 0) pool[p.rarity].push(p.id);
  for (const r of RARITIES) pool[r].sort();
  return pool;
}

/** probability of one specific card (ppm), for the transparency list (spec 9-6) */
export function cardRatePpm(banner: GachaBannerDef, pool: Record<Rarity, string[]>, rarity: Rarity): number {
  const n = pool[rarity].length;
  return n ? banner.ratesPpm[rarity] / n : 0;
}

// ---------------------------------------------------------------- randomness

export interface RandomSource {
  /** uniform integer in [0, max) */
  int(max: number): number;
}

/** unbiased integers from crypto.getRandomValues (rejection sampling) */
export function cryptoRandom(): RandomSource {
  const buf = new Uint32Array(1);
  return {
    int(max: number) {
      if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new Error('invalid range');
      const limit = 2 ** 32 - (2 ** 32 % max);
      for (;;) {
        crypto.getRandomValues(buf);
        if (buf[0] < limit) return buf[0] % max;
      }
    },
  };
}

/** deterministic source for tests */
export function seededRandom(seed: string): RandomSource {
  const rng = new Rng(seed);
  return { int: (max: number) => Math.floor(rng.next() * max) };
}

// ---------------------------------------------------------------- draws

export interface PityState {
  /** paid draws since the last Epic-or-better */
  sinceEpic: number;
  /** paid draws since the last Legendary-or-better */
  sinceLegendary: number;
  /** paid draws counted towards the next free bonus draw (150) */
  towardBonus: number;
  /** all paid draws in the series */
  total: number;
}

export const EMPTY_PITY: PityState = { sinceEpic: 0, sinceLegendary: 0, towardBonus: 0, total: 0 };

export type Guarantee = 'none' | 'epic' | 'legendary' | 'bonus';

export interface DrawResult {
  playerId: string;
  rarity: Rarity;
  /** which guarantee forced this draw (bonus = free 150 draw) */
  guarantee: Guarantee;
  /** a free draw that did not cost anything */
  free: boolean;
  duplicate: boolean;
  /** exchange points received for a duplicate */
  points: number;
  pointType: PointType;
}

/** rarity drawn by the rates, limited to `min` or better (rates renormalised) */
export function drawRarity(rates: Record<Rarity, number>, rnd: RandomSource, min?: Rarity): Rarity {
  const allowed = RARITIES.filter((r) => (rates[r] ?? 0) > 0 && (!min || rarityRank(r) >= rarityRank(min)));
  const total = allowed.reduce((s, r) => s + rates[r], 0);
  if (total <= 0) throw new Error('no rarity can be drawn');
  let x = rnd.int(total);
  for (const r of allowed) {
    if (x < rates[r]) return r;
    x -= rates[r];
  }
  return allowed[allowed.length - 1];
}

export interface GachaRun {
  results: DrawResult[];
  pity: PityState | null;
  pointsTotal: number;
}

/**
 * Runs `count` paid draws (+ free bonus draws reached on the way).
 * `owned` is the player's collection before the draw (not modified).
 */
export function runGacha(
  banner: GachaBannerDef,
  pool: Record<Rarity, string[]>,
  owned: ReadonlySet<string>,
  pityBefore: PityState | null,
  count: number,
  rnd: RandomSource,
): GachaRun {
  const pointType: PointType = banner.kind;
  const have = new Set(owned);
  const pity = banner.pity ? { ...(pityBefore ?? EMPTY_PITY) } : null;
  const results: DrawResult[] = [];
  let pointsTotal = 0;
  const take = (rarity: Rarity, guarantee: Guarantee, free: boolean) => {
    const cards = pool[rarity];
    if (!cards.length) throw new Error(`empty pool for ${rarity}`);
    const playerId = cards[rnd.int(cards.length)];
    const duplicate = have.has(playerId);
    const points = duplicate ? ECONOMY_CONFIG.duplicatePoints[rarity] : 0;
    have.add(playerId);
    pointsTotal += points;
    results.push({ playerId, rarity, guarantee, free, duplicate, points, pointType });
  };
  for (let i = 0; i < count; i++) {
    let guarantee: Guarantee = 'none';
    let min: Rarity | undefined;
    if (pity && banner.pity) {
      if (pity.sinceLegendary + 1 >= banner.pity.legendaryAt) {
        guarantee = 'legendary';
        min = 'legendary';
      } else if (pity.sinceEpic + 1 >= banner.pity.epicAt) {
        guarantee = 'epic';
        min = 'epic';
      }
    }
    const rarity = drawRarity(banner.ratesPpm, rnd, min);
    take(rarity, guarantee, false);
    if (pity && banner.pity) {
      const rank = rarityRank(rarity);
      if (rank >= rarityRank('legendary')) {
        pity.sinceLegendary = 0;
        pity.sinceEpic = 0;
      } else if (rank >= rarityRank('epic')) {
        pity.sinceEpic = 0;
        pity.sinceLegendary += 1;
      } else {
        pity.sinceEpic += 1;
        pity.sinceLegendary += 1;
      }
      pity.total += 1;
      pity.towardBonus += 1;
      // decision 38: every 150 paid draws, one free Epic-or-better draw (does not touch the counters)
      if (pity.towardBonus >= banner.pity.bonusEvery) {
        pity.towardBonus -= banner.pity.bonusEvery;
        take(drawRarity(banner.ratesPpm, rnd, 'epic'), 'bonus', true);
      }
    }
  }
  return { results, pity, pointsTotal };
}

/** draws left until each guarantee (for the UI, spec 9-6) */
export function pityStatus(banner: GachaBannerDef, pity: PityState | null) {
  if (!banner.pity) return null;
  const p = pity ?? EMPTY_PITY;
  return {
    epicIn: banner.pity.epicAt - p.sinceEpic,
    legendaryIn: banner.pity.legendaryAt - p.sinceLegendary,
    bonusIn: banner.pity.bonusEvery - p.towardBonus,
    total: p.total,
  };
}
