/**
 * Conditions on the draft candidate pool (Special Events, Solo Challenge).
 *
 * Decision 30: the players matching the condition ("target players") are all
 * put in the pool; when they cannot fill the pool, the rest is filled with
 * other players as usual. See buildDraftPool().
 */
import { GAME_CONFIG } from './config';
import { LEAGUE_BY_ID, CLUB_BY_ID } from './data/clubs';
import { NATION_BY_CODE } from './data/nations';
import { POSITIONS, POSITION_GROUP } from './data/positions';
import { RARITIES, RARITY_INFO } from './data/rarities';
import { TRAIT_IDS, TRAITS } from './data/traits';
import type { Player, Position, PositionGroup, Rarity, TraitId } from './types';

export interface PoolFilter {
  /** nation codes, e.g. ["JPN"] */
  nationalities?: string[];
  rarities?: Rarity[];
  /** primary positions */
  positions?: Position[];
  /** league ids */
  leagues?: string[];
  /** club ids */
  clubs?: string[];
  /** at least one of these traits */
  traits?: TraitId[];
  minAge?: number;
  maxAge?: number;
  minOvr?: number;
  maxOvr?: number;
}

export function isEmptyFilter(f: PoolFilter | null | undefined): boolean {
  if (!f) return true;
  return !(
    f.nationalities?.length ||
    f.rarities?.length ||
    f.positions?.length ||
    f.leagues?.length ||
    f.clubs?.length ||
    f.traits?.length ||
    f.minAge !== undefined ||
    f.maxAge !== undefined ||
    f.minOvr !== undefined ||
    f.maxOvr !== undefined
  );
}

export function matchesFilter(p: Player, f: PoolFilter): boolean {
  if (f.nationalities?.length && !f.nationalities.includes(p.nationality)) return false;
  if (f.rarities?.length && !f.rarities.includes(p.rarity)) return false;
  if (f.positions?.length && !f.positions.includes(p.primaryPosition)) return false;
  if (f.leagues?.length && !f.leagues.includes(p.leagueId)) return false;
  if (f.clubs?.length && !f.clubs.includes(p.clubId)) return false;
  if (f.traits?.length && !f.traits.some((t) => p.traits.includes(t))) return false;
  if (f.minAge !== undefined && p.age < f.minAge) return false;
  if (f.maxAge !== undefined && p.age > f.maxAge) return false;
  if (f.minOvr !== undefined && p.ovr < f.minOvr) return false;
  if (f.maxOvr !== undefined && p.ovr > f.maxOvr) return false;
  return true;
}

const intIn = (v: unknown, min: number, max: number): number | undefined => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isInteger(n) || n < min || n > max ? undefined : n;
};
const listOf = <T extends string>(v: unknown, allowed: readonly T[]): T[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = [...new Set(v.filter((x): x is T => typeof x === 'string' && (allowed as readonly string[]).includes(x)))];
  return out.length ? out : undefined;
};

/** Validates untrusted input (admin API). Unknown values are dropped. */
export function sanitizeFilter(input: unknown): PoolFilter {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const f: PoolFilter = {
    nationalities: listOf(o.nationalities, Object.keys(NATION_BY_CODE)),
    rarities: listOf(o.rarities, RARITIES),
    positions: listOf(o.positions, POSITIONS),
    leagues: listOf(o.leagues, Object.keys(LEAGUE_BY_ID)),
    clubs: listOf(o.clubs, Object.keys(CLUB_BY_ID)),
    traits: listOf(o.traits, TRAIT_IDS),
    minAge: intIn(o.minAge, 15, 50),
    maxAge: intIn(o.maxAge, 15, 50),
    minOvr: intIn(o.minOvr, 1, 99),
    maxOvr: intIn(o.maxOvr, 1, 99),
  };
  for (const k of Object.keys(f) as (keyof PoolFilter)[]) if (f[k] === undefined) delete f[k];
  return f;
}

export interface PoolAnalysis {
  /** target players in the catalog */
  eligible: number;
  eligibleByGroup: Record<PositionGroup, number>;
  /** target players that fit in one pool (all of them unless there are more than the pool can hold) */
  included: number;
  /** true when the pool consists of target players only */
  pure: boolean;
  /** pool size */
  poolSize: number;
}

export function poolSize(composition = GAME_CONFIG.pool): number {
  return composition.GK + composition.DF + composition.MF + composition.FW + composition.FREE;
}

export function analyzePool(catalog: readonly Player[], filter: PoolFilter | null | undefined, composition = GAME_CONFIG.pool): PoolAnalysis {
  const size = poolSize(composition);
  const empty = isEmptyFilter(filter);
  const byGroup: Record<PositionGroup, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  let eligible = 0;
  for (const p of catalog) {
    if (empty || matchesFilter(p, filter!)) {
      eligible++;
      byGroup[POSITION_GROUP[p.primaryPosition]]++;
    }
  }
  // capacity: group slots first, then the free slots (any group)
  const groupFill = (g: PositionGroup) => Math.min(byGroup[g], composition[g]);
  const inGroups = groupFill('GK') + groupFill('DF') + groupFill('MF') + groupFill('FW');
  const included = Math.min(eligible, inGroups + composition.FREE);
  const outfieldLeft = byGroup.DF - groupFill('DF') + (byGroup.MF - groupFill('MF')) + (byGroup.FW - groupFill('FW'));
  const pure = (['GK', 'DF', 'MF', 'FW'] as const).every((g) => byGroup[g] >= composition[g]) && outfieldLeft >= composition.FREE;
  return { eligible, eligibleByGroup: byGroup, included, pure, poolSize: size };
}

/** Human-readable conditions (Japanese) */
export function describeFilter(f: PoolFilter | null | undefined): string[] {
  if (isEmptyFilter(f)) return ['条件なし（通常の候補）'];
  const out: string[] = [];
  if (f!.nationalities?.length) out.push(`国籍：${f!.nationalities.map((c) => NATION_BY_CODE[c]?.nameJa ?? c).join('・')}`);
  if (f!.rarities?.length) out.push(`レアリティ：${f!.rarities.map((r) => RARITY_INFO[r].label).join('・')}`);
  if (f!.positions?.length) out.push(`ポジション：${f!.positions.join('・')}`);
  if (f!.leagues?.length) out.push(`リーグ：${f!.leagues.map((l) => LEAGUE_BY_ID[l]?.nameJa ?? l).join('・')}`);
  if (f!.clubs?.length) out.push(`クラブ：${f!.clubs.map((c) => CLUB_BY_ID[c]?.name ?? c).join('・')}`);
  if (f!.traits?.length) out.push(`特殊能力：${f!.traits.map((t) => TRAITS[t]?.nameJa ?? t).join('・')}`);
  if (f!.minAge !== undefined || f!.maxAge !== undefined) {
    out.push(`年齢：${f!.minAge !== undefined ? `${f!.minAge}歳以上` : ''}${f!.minAge !== undefined && f!.maxAge !== undefined ? '・' : ''}${f!.maxAge !== undefined ? `${f!.maxAge}歳以下` : ''}`);
  }
  if (f!.minOvr !== undefined || f!.maxOvr !== undefined) {
    out.push(`OVR：${f!.minOvr !== undefined ? `${f!.minOvr}以上` : ''}${f!.minOvr !== undefined && f!.maxOvr !== undefined ? '・' : ''}${f!.maxOvr !== undefined ? `${f!.maxOvr}以下` : ''}`);
  }
  return out;
}
