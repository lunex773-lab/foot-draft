import { GAME_CONFIG } from './config';
import { DEFAULT_TACTICS, FORMATIONS, FORMATION_IDS, isValidTactics } from './data/formations';
import { POSITIONS } from './data/positions';
import { ratingAt } from './players/ratings';
import type { FormationId, Lineup, Player, Position, Tactics } from './types';

const ratingCache = new WeakMap<Player, Record<Position, number>>();

/** Cached rating of a player at each position (includes out-of-position penalty). */
export function positionRatings(p: Player): Record<Position, number> {
  let r = ratingCache.get(p);
  if (!r) {
    r = {} as Record<Position, number>;
    for (const pos of POSITIONS) r[pos] = ratingAt(p, pos);
    ratingCache.set(p, r);
  }
  return r;
}

export interface Assignment {
  /** player index per slot, -1 = empty */
  slotPlayer: number[];
  score: number;
}

/**
 * Assign players to formation slots maximizing the sum of slot ratings.
 * Greedy + local improvement (swap / replace). Fast enough for draft AI.
 */
export function assignPlayers(players: readonly Player[], formation: FormationId): Assignment {
  const slots = FORMATIONS[formation].slots;
  const R = players.map((p) => {
    const pr = positionRatings(p);
    return slots.map((s) => pr[s.pos]);
  });
  const slotPlayer = new Array<number>(slots.length).fill(-1);
  const used = new Array<boolean>(players.length).fill(false);

  // greedy
  for (let step = 0; step < Math.min(slots.length, players.length); step++) {
    let best = -1;
    let bp = -1;
    let bs = -1;
    for (let i = 0; i < players.length; i++) {
      if (used[i]) continue;
      for (let j = 0; j < slots.length; j++) {
        if (slotPlayer[j] !== -1) continue;
        if (R[i][j] > best) {
          best = R[i][j];
          bp = i;
          bs = j;
        }
      }
    }
    if (bp < 0) break;
    used[bp] = true;
    slotPlayer[bs] = bp;
  }

  // local improvement
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 30) {
    improved = false;
    for (let a = 0; a < slots.length; a++) {
      for (let b = a + 1; b < slots.length; b++) {
        const pa = slotPlayer[a];
        const pb = slotPlayer[b];
        const cur = (pa >= 0 ? R[pa][a] : 0) + (pb >= 0 ? R[pb][b] : 0);
        const sw = (pb >= 0 ? R[pb][a] : 0) + (pa >= 0 ? R[pa][b] : 0);
        if (sw > cur + 1e-9) {
          slotPlayer[a] = pb;
          slotPlayer[b] = pa;
          improved = true;
        }
      }
    }
    for (let i = 0; i < players.length; i++) {
      if (used[i]) continue;
      for (let j = 0; j < slots.length; j++) {
        const pj = slotPlayer[j];
        const cur = pj >= 0 ? R[pj][j] : 0;
        if (R[i][j] > cur + 1e-9) {
          if (pj >= 0) used[pj] = false;
          slotPlayer[j] = i;
          used[i] = true;
          improved = true;
          break;
        }
      }
    }
  }
  let score = 0;
  for (let j = 0; j < slots.length; j++) if (slotPlayer[j] >= 0) score += R[slotPlayer[j]][j];
  return { slotPlayer, score };
}

/** Pick the formation where the roster fits best. */
export function bestFormation(players: readonly Player[], candidates: readonly FormationId[] = FORMATION_IDS): { formation: FormationId; assignment: Assignment } {
  let best: { formation: FormationId; assignment: Assignment } | null = null;
  for (const f of candidates) {
    const a = assignPlayers(players, f);
    if (!best || a.score > best.assignment.score) best = { formation: f, assignment: a };
  }
  return best as { formation: FormationId; assignment: Assignment };
}

/** Automatic lineup used for timeouts and CPU teams. */
export function autoLineup(roster: readonly Player[], formation?: FormationId, tactics?: Tactics): Lineup {
  const pick = formation ? { formation, assignment: assignPlayers(roster, formation) } : bestFormation(roster);
  const starters = pick.assignment.slotPlayer.map((i) => (i >= 0 ? roster[i].id : ''));
  const startersSet = new Set(starters);
  const bench = roster
    .filter((p) => !startersSet.has(p.id))
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, GAME_CONFIG.benchCount)
    .map((p) => p.id);
  return { formation: pick.formation, starters, bench, tactics: { ...(tactics ?? DEFAULT_TACTICS) } };
}

export type LineupError =
  | 'INVALID_FORMATION'
  | 'INVALID_STARTERS'
  | 'INVALID_BENCH'
  | 'UNKNOWN_PLAYER'
  | 'DUPLICATE_PLAYER'
  | 'INVALID_TACTICS';

/** Server-side validation of a lineup submitted by a client. */
export function validateLineup(lineup: unknown, rosterIds: readonly string[]): LineupError | null {
  if (!lineup || typeof lineup !== 'object') return 'INVALID_STARTERS';
  const l = lineup as Partial<Lineup>;
  if (typeof l.formation !== 'string' || !(l.formation in FORMATIONS)) return 'INVALID_FORMATION';
  if (!Array.isArray(l.starters) || l.starters.length !== GAME_CONFIG.startersCount) return 'INVALID_STARTERS';
  const expectedBench = Math.min(GAME_CONFIG.benchCount, rosterIds.length - GAME_CONFIG.startersCount);
  if (!Array.isArray(l.bench) || l.bench.length !== expectedBench) return 'INVALID_BENCH';
  const all = [...l.starters, ...l.bench];
  const roster = new Set(rosterIds);
  for (const id of all) if (typeof id !== 'string' || !roster.has(id)) return 'UNKNOWN_PLAYER';
  if (new Set(all).size !== all.length) return 'DUPLICATE_PLAYER';
  if (!isValidTactics(l.tactics)) return 'INVALID_TACTICS';
  return null;
}

/** Sum of slot ratings / 11 for display ("team strength"). */
export function lineupStrength(lineup: Lineup, byId: Map<string, Player> | Record<string, Player>): number {
  const get = (id: string) => (byId instanceof Map ? byId.get(id) : byId[id]);
  const slots = FORMATIONS[lineup.formation].slots;
  let sum = 0;
  lineup.starters.forEach((id, i) => {
    const p = get(id);
    if (p) sum += positionRatings(p)[slots[i].pos];
  });
  return Math.round(sum / slots.length);
}
