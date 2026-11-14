import { roleSynergy } from './chemistry';
import { GAME_CONFIG } from './config';
import { POSITION_GROUP } from './data/positions';
import { assignPlayers } from './lineup';
import { isEmptyFilter, matchesFilter, type PoolFilter } from './pool';
import { Rng } from './rng';
import type { FormationId, Player, PositionGroup } from './types';

/** Snake order: P1 P2 P3 P4 P4 P3 P2 P1 ... (spec 3-2). Returns seat index per pick. */
export function snakeOrder(players: number, rounds: number): number[] {
  const order: number[] = [];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < players; i++) order.push(r % 2 === 0 ? i : players - 1 - i);
  }
  return order;
}

/**
 * Build the candidate pool for one draft (provisional: 84 players,
 * GK12 / DF24 / MF24 / FW12 / free 12, spec 3-3).
 *
 * With a filter (Special Events / Solo Challenge) the matching players are
 * taken first in every slot group and the free slots (any position), and only
 * the remaining slots are filled with other players (decision 30).
 */
export function buildDraftPool(catalog: readonly Player[], rng: Rng, composition = GAME_CONFIG.pool, filter?: PoolFilter | null): string[] {
  const target = isEmptyFilter(filter) ? null : (p: Player) => matchesFilter(p, filter!);
  const byGroup: Record<PositionGroup, Player[]> = { GK: [], DF: [], MF: [], FW: [] };
  for (const p of catalog) byGroup[POSITION_GROUP[p.primaryPosition]].push(p);
  const chosen = new Set<string>();
  /** adds up to n players of the list (target players first); returns how many were added */
  const take = (list: Player[], n: number): number => {
    let added = 0;
    const lists = target ? [list.filter(target), list.filter((p) => !target(p))] : [list];
    for (const l of lists) {
      if (added >= n) break;
      const shuffled = rng.shuffle(l.filter((p) => !chosen.has(p.id)));
      for (const p of shuffled.slice(0, n - added)) {
        chosen.add(p.id);
        added++;
      }
    }
    return added;
  };
  for (const g of ['GK', 'DF', 'MF', 'FW'] as const) take(byGroup[g], composition[g]);
  const before = chosen.size;
  if (target) {
    // free slots: remaining target players first — outfield players, then goalkeepers
    // (so a goalkeeper event still includes every goalkeeper)
    const left = catalog.filter((p) => target(p) && !chosen.has(p.id));
    const remainingTargets = [...rng.shuffle(left.filter((p) => p.primaryPosition !== 'GK')), ...rng.shuffle(left.filter((p) => p.primaryPosition === 'GK'))];
    for (const p of remainingTargets.slice(0, composition.FREE)) chosen.add(p.id);
  }
  const freeLeft = composition.FREE - (chosen.size - before);
  if (freeLeft > 0) {
    const others = [...byGroup.DF, ...byGroup.MF, ...byGroup.FW].filter((p) => !target || !target(p));
    const shuffled = rng.shuffle(others.filter((p) => !chosen.has(p.id)));
    for (const p of shuffled.slice(0, freeLeft)) chosen.add(p.id);
  }
  // stable order: by OVR desc then id
  const byId = new Map(catalog.map((p) => [p.id, p]));
  return [...chosen].sort((a, b) => (byId.get(b)!.ovr - byId.get(a)!.ovr) || a.localeCompare(b));
}

export interface DraftPick {
  pickNo: number;
  seat: number;
  playerId: string;
  auto: boolean;
}

export interface DraftState {
  seats: number;
  rounds: number;
  pool: string[];
  order: number[];
  picks: DraftPick[];
  /**
   * Collection Draft (decision 36): player id -> the only seats allowed to pick
   * it (the owners who registered it; several when more players registered the
   * same card — whoever picks it first gets it)
   */
  reserved?: Record<string, number[]>;
}

export function createDraftState(pool: string[], seats: number = GAME_CONFIG.maxPlayers, rounds: number = GAME_CONFIG.picksPerPlayer): DraftState {
  return { seats, rounds, pool, order: snakeOrder(seats, rounds), picks: [] };
}

export function currentSeat(state: DraftState): number | null {
  return state.picks.length < state.order.length ? state.order[state.picks.length] : null;
}

export function isDraftComplete(state: DraftState): boolean {
  return state.picks.length >= state.order.length;
}

export function rosterOf(state: DraftState, seat: number): string[] {
  return state.picks.filter((p) => p.seat === seat).map((p) => p.playerId);
}

/** players still available; with `seat`, other players' reserved cards are excluded */
export function availablePlayers(state: DraftState, seat?: number): string[] {
  const taken = new Set(state.picks.map((p) => p.playerId));
  const reserved = state.reserved ?? {};
  return state.pool.filter((id) => !taken.has(id) && (seat === undefined || reserved[id] === undefined || reserved[id].includes(seat)));
}

export type PickError = 'DRAFT_FINISHED' | 'NOT_YOUR_TURN' | 'NOT_IN_POOL' | 'ALREADY_PICKED' | 'GK_LIMIT' | 'RESERVED';

export function validatePick(state: DraftState, seat: number, playerId: string, byId: Map<string, Player>): PickError | null {
  const cur = currentSeat(state);
  if (cur === null) return 'DRAFT_FINISHED';
  if (cur !== seat) return 'NOT_YOUR_TURN';
  if (!state.pool.includes(playerId)) return 'NOT_IN_POOL';
  if (state.picks.some((p) => p.playerId === playerId)) return 'ALREADY_PICKED';
  const owners = state.reserved?.[playerId];
  if (owners !== undefined && !owners.includes(seat)) return 'RESERVED';
  const player = byId.get(playerId);
  if (!player) return 'NOT_IN_POOL';
  if (player.primaryPosition === 'GK') {
    const gks = rosterOf(state, seat).filter((id) => byId.get(id)?.primaryPosition === 'GK').length;
    if (gks >= GAME_CONFIG.maxGkPerTeam) return 'GK_LIMIT';
  }
  return null;
}

/** Applies a pick. Throws if invalid (callers must validate first). */
export function applyPick(state: DraftState, seat: number, playerId: string, auto: boolean, byId: Map<string, Player>): DraftPick {
  const err = validatePick(state, seat, playerId, byId);
  if (err) throw new Error(err);
  const pick: DraftPick = { pickNo: state.picks.length + 1, seat, playerId, auto };
  state.picks.push(pick);
  return pick;
}

const EVAL_FORMATIONS: FormationId[] = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2'];

/**
 * Squad value used by the auto-pick AI.
 * = best XI score over a few formations + value of the bench + role synergy.
 */
export function squadValue(players: readonly Player[]): number {
  let bestXi = 0;
  let bestSlots: number[] = [];
  for (const f of EVAL_FORMATIONS) {
    const a = assignPlayers(players, f);
    if (a.score > bestXi) {
      bestXi = a.score;
      bestSlots = a.slotPlayer;
    }
  }
  const starters = new Set(bestSlots.filter((i) => i >= 0));
  // bench: up to 3 best remaining outfield players, valued lower (spec 6-5: subs matter)
  const bench = players
    .map((p, i) => ({ p, i }))
    .filter((x) => !starters.has(x.i))
    .map((x) => (x.p.primaryPosition === 'GK' ? x.p.ovr * 0.2 : x.p.ovr))
    .sort((a, b) => b - a)
    .slice(0, GAME_CONFIG.benchCount);
  const benchValue = bench.reduce((s, v) => s + v, 0) * 0.3;
  // role synergy among starters (small)
  const st = [...starters].map((i) => players[i]);
  let syn = 0;
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) syn += roleSynergy(st[i].role, st[j].role);
  return bestXi + benchValue + syn * 0.8;
}

/**
 * Server-side auto pick (spec 3-5). Considers missing positions, formation
 * fit, ability, position familiarity, synergy with existing players and the
 * need for substitutes — not just the highest OVR.
 *
 * @param noise random variation for CPU personalities (0 = deterministic best)
 */
export function chooseAutoPick(state: DraftState, seat: number, byId: Map<string, Player>, rng?: Rng, noise = 0): string {
  const roster = rosterOf(state, seat).map((id) => byId.get(id)!) as Player[];
  const gkCount = roster.filter((p) => p.primaryPosition === 'GK').length;
  const picksLeft = state.order.slice(state.picks.length).filter((s) => s === seat).length;
  const base = squadValue(roster);
  const candidates = availablePlayers(state, seat)
    .map((id) => byId.get(id)!)
    .filter((p) => !(p.primaryPosition === 'GK' && gkCount >= GAME_CONFIG.maxGkPerTeam));

  // must have at least one GK: force when only the last picks remain
  if (gkCount === 0 && picksLeft <= 2) {
    const gks = candidates.filter((p) => p.primaryPosition === 'GK').sort((a, b) => b.ovr - a.ovr);
    if (gks.length > 0) return gks[0].id;
  }

  // pre-filter: evaluate the top candidates per position group to keep it fast
  const byGroup = new Map<PositionGroup, Player[]>();
  for (const p of candidates) {
    const g = POSITION_GROUP[p.primaryPosition];
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(p);
  }
  const shortlist: Player[] = [];
  for (const list of byGroup.values()) shortlist.push(...list.sort((a, b) => b.ovr - a.ovr).slice(0, 10));

  let bestId = shortlist[0]?.id ?? candidates[0]?.id;
  let bestScore = -Infinity;
  for (const c of shortlist) {
    let gain = squadValue([...roster, c]) - base;
    // a second GK is only a backup (no injuries) -> discourage
    if (c.primaryPosition === 'GK' && gkCount >= 1) gain *= 0.25;
    // traits add a little value
    gain += c.traits.length * 0.3;
    if (rng && noise > 0) gain += rng.normal(0, noise);
    if (gain > bestScore) {
      bestScore = gain;
      bestId = c.id;
    }
  }
  return bestId;
}
