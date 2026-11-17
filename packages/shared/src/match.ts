/**
 * MATCH (official spec "MATCH / DRAFT MATCH v2.0", decisions 68-74):
 * every player brings the team of the cards they own. 4-player round robin
 * league (3 matches), empty seats are CPU teams.
 */
import { POSITION_GROUP } from './data/positions';
import { FORMATIONS } from './data/formations';
import type { RandomSource } from './economy/gacha';
import { autoLineup } from './lineup';
import type { FormationId, Lineup, Player, Position, PositionGroup } from './types';

export const MATCH_CONFIG = {
  /** decision 70: a duplicate card adds one level, up to +5 */
  maxLevel: 5,
  /** decision 72: the first 11 cards (spec: GK1, DF4, MF3, FW3, all COMMON) */
  starter: { GK: 1, DF: 4, MF: 3, FW: 3 } as Record<PositionGroup, number>,
  starterFormation: '4-3-3' as FormationId,
  /** decision 73: saved teams */
  squadSlots: 3,
  /** decision 71: Standard exchange points by final rank (with the daily match reward) */
  rankPoints: { 1: 30, 2: 20, 3: 10, 4: 5 } as Record<number, number>,
  /** CPU teams are built around the average OVR of the people in the room (provisional) */
  cpuOvrSpread: 3,
} as const;

const cap = (n: number) => Math.min(99, n);

/** a card strengthened by duplicates: +1 to OVR, the six card stats and the SIM attributes per level (MATCH only) */
export function enhancePlayer(p: Player, level: number): Player {
  const lv = Math.max(0, Math.min(MATCH_CONFIG.maxLevel, Math.floor(level)));
  if (lv === 0) return p;
  const attributes = Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, cap(v + lv)])) as unknown as Player['attributes'];
  return {
    ...p,
    ovr: cap(p.ovr + lv),
    stats: { pac: cap(p.stats.pac + lv), sho: cap(p.stats.sho + lv), pas: cap(p.stats.pas + lv), dri: cap(p.stats.dri + lv), def: cap(p.stats.def + lv), phy: cap(p.stats.phy + lv) },
    attributes,
  };
}

/** preferred positions for the starter 4-3-3 (fallback: any card of the group) */
const STARTER_SLOTS: { group: PositionGroup; want: Position[] }[] = [
  { group: 'GK', want: ['GK'] },
  { group: 'DF', want: ['LB', 'LWB'] },
  { group: 'DF', want: ['CB'] },
  { group: 'DF', want: ['CB'] },
  { group: 'DF', want: ['RB', 'RWB'] },
  { group: 'MF', want: ['CM', 'CDM'] },
  { group: 'MF', want: ['CM', 'CAM'] },
  { group: 'MF', want: ['CM', 'CDM', 'CAM'] },
  { group: 'FW', want: ['LW', 'LM'] },
  { group: 'FW', want: ['ST', 'CF'] },
  { group: 'FW', want: ['RW', 'RM'] },
];

/**
 * The first 11 cards (decision 72): random COMMON cards, GK1 / DF4 / MF3 / FW3,
 * chosen so that they fit a 4-3-3.
 */
export function pickStarterCards(commons: readonly Player[], rnd: RandomSource): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  const draw = (list: readonly Player[]) => {
    const free = list.filter((p) => !used.has(p.id));
    if (!free.length) return null;
    return free[rnd.int(free.length)];
  };
  for (const slot of STARTER_SLOTS) {
    const p =
      draw(commons.filter((x) => POSITION_GROUP[x.primaryPosition] === slot.group && slot.want.includes(x.primaryPosition))) ??
      draw(commons.filter((x) => POSITION_GROUP[x.primaryPosition] === slot.group));
    if (!p) throw new Error(`no COMMON card for ${slot.group}`);
    used.add(p.id);
    out.push(p.id);
  }
  return out;
}

/** a team (lineup) of exactly the given cards, best formation for them (11 cards -> no bench) */
export function squadLineup(cards: readonly Player[], formation?: FormationId): Lineup {
  return autoLineup(cards, formation);
}

/**
 * A CPU team of 14 cards around a target OVR (MATCH): one card per slot of a
 * random formation, close to the target, plus 3 substitutes.
 */
export function buildCpuSquad(catalog: readonly Player[], targetOvr: number, rnd: RandomSource, exclude: ReadonlySet<string> = new Set()): { cards: Player[]; formation: FormationId } {
  const ids = Object.keys(FORMATIONS) as FormationId[];
  const formation = ids[rnd.int(ids.length)];
  const used = new Set<string>(exclude);
  const cards: Player[] = [];
  const pickNear = (ok: (p: Player) => boolean) => {
    for (let spread = MATCH_CONFIG.cpuOvrSpread; spread <= 40; spread += 3) {
      const list = catalog.filter((p) => !used.has(p.id) && ok(p) && Math.abs(p.ovr - targetOvr) <= spread);
      if (list.length) return list[rnd.int(list.length)];
    }
    const any = catalog.filter((p) => !used.has(p.id) && ok(p));
    return any.length ? any[rnd.int(any.length)] : null;
  };
  for (const slot of FORMATIONS[formation].slots) {
    const p = pickNear((x) => x.primaryPosition === slot.pos) ?? pickNear((x) => POSITION_GROUP[x.primaryPosition] === POSITION_GROUP[slot.pos]);
    if (!p) throw new Error(`no card for ${slot.pos}`);
    used.add(p.id);
    cards.push(p);
  }
  for (const group of ['GK', 'DF', 'MF'] as PositionGroup[]) {
    const p = pickNear((x) => POSITION_GROUP[x.primaryPosition] === group);
    if (p) {
      used.add(p.id);
      cards.push(p);
    }
  }
  return { cards, formation };
}

/** average OVR of a lineup's starters (the "team strength" shown in the team screen) */
export function startersAverage(lineup: Lineup, byId: Map<string, Player>): number {
  const list = lineup.starters.map((id) => byId.get(id)).filter(Boolean) as Player[];
  return list.length ? Math.round((list.reduce((s, p) => s + p.ovr, 0) / list.length) * 10) / 10 : 0;
}
