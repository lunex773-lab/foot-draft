/**
 * DRAFT MATCH (official spec "MATCH / DRAFT MATCH v2.0", decisions 75-85):
 * 2-4 people, a common card pool built for the chosen formations, draft order
 * by チンチロ, snake draft of 11 picks each (15 s), 11 players without bench,
 * round robin, results and ranking decided by the server. Owned cards and
 * strengthening are not used.
 */
import type { Dice, Hand } from './chinchiro';
import { POSITION_GROUP } from './data/positions';
import { RARITIES } from './data/rarities';
import { FORMATIONS } from './data/formations';
import type { RandomSource } from './economy/gacha';
import { ROUND_ROBIN_4, type FixtureResult, type StandingRow } from './league';
import type { DraftPick } from './draft';
import type { LiveMatch, MatchSummary, RankedOutcome, SeatReward } from './protocol';
import type { FormationId, Lineup, Player, PositionGroup, Rarity } from './types';

export const DRAFT_MATCH_CONFIG = {
  minPlayers: 2,
  maxPlayers: 4,
  /** spec 4: 11 rounds, 11 players each, no bench */
  picksPerPlayer: 11,
  /** spec 4: seconds per pick */
  pickSeconds: 15,
  /** spec 5: 11 x players + 12 cards */
  poolExtra: 12,
  /** decision 75: matching waits about 60 s; 2-3 people then play with that number */
  matchingSeconds: 60,
  /** a second person joining after the wait starts the room shortly after */
  lateJoinSeconds: 15,
  /** decision 82 */
  formationSeconds: 30,
  confirmSeconds: 60,
  /** team changes before the 2nd / 3rd matchday */
  betweenSeconds: 30,
  /** the draft order is shown before the draft */
  orderSeconds: 6,
  /** formation when the time runs out */
  defaultFormation: '4-3-3' as FormationId,
  /** extra cards of the pool by position group (12 = spec 5) */
  spare: { GK: 2, DF: 4, MF: 4, FW: 2 } as Record<PositionGroup, number>,
} as const;

/** spec 9: the states of a DRAFT MATCH room (CANCELLED: everybody left before the start) */
export const DRAFT_MATCH_STATES = [
  'WAITING',
  'MATCHING',
  'FORMATION_SELECTION',
  'POOL_GENERATION',
  'CHINCHIRO',
  'DRAFT_ORDER',
  'PLAYER_DRAFT',
  'TEAM_CONFIRMATION',
  'SIMULATION',
  'RESULT',
  'COMPLETED',
  'CANCELLED',
] as const;
export type DraftMatchStatus = (typeof DRAFT_MATCH_STATES)[number];

/** allowed transitions (TEAM_CONFIRMATION <-> SIMULATION repeats once per matchday) */
export const DRAFT_MATCH_TRANSITIONS: Record<DraftMatchStatus, DraftMatchStatus[]> = {
  WAITING: ['MATCHING', 'CANCELLED'],
  MATCHING: ['WAITING', 'FORMATION_SELECTION', 'CANCELLED'],
  FORMATION_SELECTION: ['POOL_GENERATION'],
  POOL_GENERATION: ['CHINCHIRO'],
  CHINCHIRO: ['DRAFT_ORDER'],
  DRAFT_ORDER: ['PLAYER_DRAFT'],
  PLAYER_DRAFT: ['TEAM_CONFIRMATION'],
  TEAM_CONFIRMATION: ['SIMULATION'],
  SIMULATION: ['TEAM_CONFIRMATION', 'RESULT'],
  RESULT: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canMove(from: DraftMatchStatus, to: DraftMatchStatus): boolean {
  return DRAFT_MATCH_TRANSITIONS[from].includes(to);
}

const GROUPS: PositionGroup[] = ['GK', 'DF', 'MF', 'FW'];

/** players needed per position group by a formation (e.g. 4-3-3: GK1 DF4 MF3 FW3) */
export function groupNeeds(formation: FormationId): Record<PositionGroup, number> {
  const out: Record<PositionGroup, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const slot of FORMATIONS[formation].slots) out[POSITION_GROUP[slot.pos]]++;
  return out;
}

export const groupOf = (p: Player): PositionGroup => POSITION_GROUP[p.primaryPosition];

export function poolSize(players: number): number {
  return DRAFT_MATCH_CONFIG.picksPerPlayer * players + DRAFT_MATCH_CONFIG.poolExtra;
}

/** how many cards of each position group the pool needs: the formations' needs + the spare cards */
export function poolQuota(formations: readonly FormationId[]): Record<PositionGroup, number> {
  const q: Record<PositionGroup, number> = { ...DRAFT_MATCH_CONFIG.spare };
  for (const f of formations) {
    const n = groupNeeds(f);
    for (const g of GROUPS) q[g] += n[g];
  }
  return q;
}

/** rarity counts in the same ratio as the whole catalog, at least 1 of each (decision 81) */
export function rarityTargets(catalog: readonly Player[], size: number): Record<Rarity, number> {
  const total = catalog.length;
  const share = (r: Rarity) => catalog.filter((p) => p.rarity === r).length / total;
  const raw = RARITIES.map((r) => ({ r, exact: size * share(r) }));
  const out = Object.fromEntries(raw.map(({ r, exact }) => [r, Math.max(1, Math.floor(exact))])) as Record<Rarity, number>;
  let sum = RARITIES.reduce((s, r) => s + out[r], 0);
  // largest remainders get the missing cards; too many (minimum of 1) are taken from the largest group
  const byRemainder = [...raw].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)));
  for (let i = 0; sum < size; i = (i + 1) % byRemainder.length, sum++) out[byRemainder[i].r]++;
  while (sum > size) {
    const biggest = [...RARITIES].sort((a, b) => out[b] - out[a])[0];
    out[biggest]--;
    sum--;
  }
  return out;
}

/** splits `n` into parts proportional to `weights` (largest remainder), each part at most its cap */
function proportional<K extends string>(n: number, weights: Record<K, number>, caps: Record<K, number>): Record<K, number> {
  const keys = Object.keys(weights) as K[];
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  let left = n;
  for (let guard = 0; left > 0 && guard < 20; guard++) {
    const open = keys.filter((k) => out[k] < caps[k] && weights[k] > 0);
    const pool = open.length ? open : keys.filter((k) => out[k] < caps[k]);
    if (!pool.length) break;
    const wsum = pool.reduce((s, k) => s + (open.length ? weights[k] : 1), 0);
    const shares = pool.map((k) => ({ k, exact: (left * (open.length ? weights[k] : 1)) / wsum }));
    let given = 0;
    for (const s of shares) {
      const add = Math.min(Math.floor(s.exact), caps[s.k] - out[s.k]);
      out[s.k] += add;
      given += add;
    }
    for (const s of shares.sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)))) {
      if (given >= left) break;
      if (out[s.k] < caps[s.k]) {
        out[s.k]++;
        given++;
      }
    }
    left -= given;
    if (given === 0) break;
  }
  return out;
}

function shuffle<T>(list: readonly T[], rnd: RandomSource): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The common card pool (spec 5, decisions 79 / 81): 11 x players + 12 cards.
 * Every position group has the cards all chosen formations need plus spares,
 * rarities follow the catalog ratio with at least one card of each rarity.
 * `exclude`: cards that must never be in the pool (paid-only cards, spec 5 —
 * there are none in the catalog yet).
 */
export function buildDraftMatchPool(catalog: readonly Player[], formations: readonly FormationId[], rnd: RandomSource, exclude: ReadonlySet<string> = new Set()): string[] {
  const cards = catalog.filter((p) => !exclude.has(p.id));
  const quota = poolQuota(formations);
  const size = GROUPS.reduce((s, g) => s + quota[g], 0);
  const rarity = rarityTargets(cards, size);
  const chosen = new Set<string>();
  const left = { ...rarity };
  // scarce groups first so that their rarities are not used up by the big groups
  for (const g of ['GK', 'FW', 'DF', 'MF'] as PositionGroup[]) {
    const inGroup = cards.filter((p) => groupOf(p) === g);
    const caps = Object.fromEntries(RARITIES.map((r) => [r, inGroup.filter((p) => p.rarity === r).length])) as Record<Rarity, number>;
    const alloc = proportional(quota[g], left, caps);
    for (const r of RARITIES) {
      for (const p of shuffle(
        inGroup.filter((x) => x.rarity === r),
        rnd,
      ).slice(0, alloc[r])) {
        chosen.add(p.id);
        left[r] = Math.max(0, left[r] - 1);
      }
    }
    // a group short of cards (caps) is filled with any card of the group
    let short = quota[g] - inGroup.filter((p) => chosen.has(p.id)).length;
    for (const p of shuffle(
      inGroup.filter((x) => !chosen.has(x.id)),
      rnd,
    )) {
      if (short <= 0) break;
      chosen.add(p.id);
      left[p.rarity] = Math.max(0, left[p.rarity] - 1);
      short--;
    }
  }
  // at least one card of every rarity: swap within the same position group
  const byId = new Map(cards.map((p) => [p.id, p]));
  for (const r of RARITIES) {
    if ([...chosen].some((id) => byId.get(id)!.rarity === r)) continue;
    const candidates = shuffle(
      cards.filter((p) => p.rarity === r && !chosen.has(p.id)),
      rnd,
    );
    for (const c of candidates) {
      const counts = (rr: Rarity) => [...chosen].filter((id) => byId.get(id)!.rarity === rr).length;
      const out = shuffle(
        [...chosen].map((id) => byId.get(id)!).filter((p) => groupOf(p) === groupOf(c) && counts(p.rarity) > 1),
        rnd,
      ).sort((a, b) => counts(b.rarity) - counts(a.rarity))[0];
      if (out) {
        chosen.delete(out.id);
        chosen.add(c.id);
        break;
      }
    }
  }
  return [...chosen].sort((a, b) => byId.get(b)!.ovr - byId.get(a)!.ovr || a.localeCompare(b));
}

/** the position groups a player still has to fill */
export function remainingNeeds(formation: FormationId, roster: readonly Player[]): Record<PositionGroup, number> {
  const need = groupNeeds(formation);
  for (const p of roster) need[groupOf(p)]--;
  return need;
}

export type DraftMatchPickError = 'DRAFT_FINISHED' | 'NOT_YOUR_TURN' | 'NOT_IN_POOL' | 'ALREADY_PICKED' | 'POSITION_FULL';

export interface DraftMatchDraft {
  /** seat of each pick in order (snake) */
  order: number[];
  pool: string[];
  picks: DraftPick[];
}

export function dmCurrentSeat(d: DraftMatchDraft): number | null {
  return d.picks.length < d.order.length ? d.order[d.picks.length] : null;
}

export function dmRoster(d: DraftMatchDraft, seat: number): string[] {
  return d.picks.filter((p) => p.seat === seat).map((p) => p.playerId);
}

/** spec 4 / decision 78: the turn, the pool, no card twice, and only position groups the formation still needs */
export function validateDraftMatchPick(d: DraftMatchDraft, seat: number, playerId: string, formation: FormationId, byId: Map<string, Player>): DraftMatchPickError | null {
  const cur = dmCurrentSeat(d);
  if (cur === null) return 'DRAFT_FINISHED';
  if (cur !== seat) return 'NOT_YOUR_TURN';
  const p = byId.get(playerId);
  if (!p || !d.pool.includes(playerId)) return 'NOT_IN_POOL';
  if (d.picks.some((x) => x.playerId === playerId)) return 'ALREADY_PICKED';
  const roster = dmRoster(d, seat).map((id) => byId.get(id)!);
  if (remainingNeeds(formation, roster)[groupOf(p)] <= 0) return 'POSITION_FULL';
  return null;
}

/**
 * Pick when the time runs out (spec 4): the position group with the most
 * missing players first (the scarcer one when equal), then the best card of
 * that group for the formation's open slots.
 */
export function draftMatchAutoPick(d: DraftMatchDraft, seat: number, formation: FormationId, byId: Map<string, Player>): string {
  const taken = new Set(d.picks.map((p) => p.playerId));
  const available = d.pool.filter((id) => !taken.has(id)).map((id) => byId.get(id)!);
  const roster = dmRoster(d, seat).map((id) => byId.get(id)!);
  const need = remainingNeeds(formation, roster);
  const supply = (g: PositionGroup) => available.filter((p) => groupOf(p) === g).length;
  const groups = GROUPS.filter((g) => need[g] > 0 && supply(g) > 0).sort((a, b) => need[b] - need[a] || supply(a) / need[a] - supply(b) / need[b]);
  const g = groups[0];
  const list = g ? available.filter((p) => groupOf(p) === g) : available;
  // the best player for one of the formation's slots of that group (positions the player can play first)
  const openPositions = FORMATIONS[formation].slots.filter((s) => !g || POSITION_GROUP[s.pos] === g).map((s) => s.pos);
  const score = (p: Player) => p.ovr + (p.positions.some((pos) => openPositions.includes(pos)) ? 3 : 0);
  return [...list].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0].id;
}

/** the snake order of the picks for the draft positions decided by チンチロ (index 0 picks first) */
export function draftMatchOrder(draftPositions: readonly number[], rounds: number = DRAFT_MATCH_CONFIG.picksPerPlayer): number[] {
  const n = draftPositions.length;
  const out: number[] = [];
  for (let r = 0; r < rounds; r++) for (let i = 0; i < n; i++) out.push(draftPositions[r % 2 === 0 ? i : n - 1 - i]);
  return out;
}

/** round robin for 2-4 teams (decision 76): 2 = 1 match, 3 = 3 matches (one team rests), 4 = 6 matches */
export function roundRobin(n: number): [number, number][][] {
  if (n === 4) return ROUND_ROBIN_4;
  if (n === 3)
    return [
      [[0, 1]],
      [[2, 0]],
      [[1, 2]],
    ];
  if (n === 2) return [[[0, 1]]];
  throw new Error('2-4 teams');
}

// ---------------------------------------------------------------- protocol

export interface DmSeat {
  seat: number;
  userId: string;
  displayName: string;
  connected: boolean;
  member?: boolean;
  /** shown to everybody after the formation selection; own choice always */
  formation: FormationId | null;
  formationChosen: boolean;
  left?: boolean;
}

export interface DmThrow {
  dice: Dice;
  hand: Hand;
  auto: boolean;
}

export interface DmChinchiroRound {
  no: number;
  /** seats taking part (a re-match has only the tied players) */
  seats: number[];
  throws: Record<number, DmThrow[]>;
  rematch: boolean;
}

export interface DmChinchiroView {
  rounds: DmChinchiroRound[];
  /** the throw being waited for */
  current: null | {
    round: number;
    throwNo: number;
    /** seats that have to throw now */
    seats: number[];
    /** seats that already tapped (their dice stay hidden until everybody threw) */
    thrown: number[];
    deadline: number;
  };
  /** the animation of the last throw ends at (the next throw starts after it) */
  revealUntil: number | null;
  /** final ranking groups (best first; a group of 2+ is waiting for a re-match) */
  groups: number[][];
}

export interface DraftMatchOutcome {
  rewards?: Record<number, SeatReward>;
  ranking?: RankedOutcome;
}

export interface DraftMatchSnapshot {
  roomId: string;
  status: DraftMatchStatus;
  serverNow: number;
  you: number | null;
  seats: DmSeat[];
  /** deadline of the current step (matching / formation / pick / team / playback) */
  deadline: number | null;
  pool: string[] | null;
  chinchiro: DmChinchiroView | null;
  /** draft positions decided by チンチロ (seats, first pick first) */
  draftPositions: number[] | null;
  draft: null | { order: number[]; picks: DraftPick[]; currentSeat: number | null; deadline: number | null };
  rosters: Record<number, string[]>;
  /** own lineup always; others' after they were used in a match */
  lineups: Record<number, Lineup | null>;
  lineupReady: Record<number, boolean>;
  matchday: number;
  matchdays: number;
  fixtures: MatchSummary[];
  live: LiveMatch[];
  standings: StandingRow[];
  results: FixtureResult[];
  finalRanks: Record<number, number> | null;
  outcome: DraftMatchOutcome | null;
  /** state changes so far (spec 9) */
  history: { status: DraftMatchStatus; at: number }[];
}

export type DraftMatchClientMessage =
  | { type: 'hello' }
  | { type: 'formation'; formation: FormationId }
  | { type: 'throw' }
  | { type: 'pick'; playerId: string }
  | { type: 'lineup'; lineup: Lineup; ready?: boolean }
  | { type: 'ready'; ready: boolean }
  | { type: 'leave' }
  | { type: 'ping'; t: number };

export type DraftMatchServerMessage =
  | { type: 'snapshot'; state: DraftMatchSnapshot }
  | { type: 'players'; players: Player[] }
  | { type: 'error'; code: string; message?: string }
  | { type: 'pong'; t: number; serverNow: number };
