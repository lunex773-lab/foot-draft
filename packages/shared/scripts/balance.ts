/**
 * SIM balance check (spec 6-7: "SIMのバランスは大量の自動試合で検証する").
 *
 *   npm run sim:balance -w @fd/shared -- [matches]
 *
 * 1. Drafts random 4-team leagues with the CPU and simulates them.
 * 2. Prints average match statistics and win rate by team strength gap.
 * 3. Plays mirror matches (same squad) with different tactics to check that
 *    no single tactic dominates.
 */
import {
  DEFAULT_TACTICS,
  GAME_CONFIG,
  ROUND_ROBIN_4,
  Rng,
  applyPick,
  autoLineup,
  buildDraftPool,
  chooseAutoPick,
  cpuLineup,
  createDraftState,
  currentSeat,
  getCatalog,
  isDraftComplete,
  lineupStrength,
  rosterOf,
  simulateMatch,
  type Lineup,
  type MatchResultData,
  type Player,
  type Tactics,
} from '../src/index';

const N = Number(process.argv[2] ?? 300); // leagues
const catalog = getCatalog();
const byId = new Map(catalog.map((p) => [p.id, p]));

function draftLeague(seed: string): Player[][] {
  const rng = new Rng(seed);
  const state = createDraftState(buildDraftPool(catalog, rng.fork('pool')));
  while (!isDraftComplete(state)) {
    const seat = currentSeat(state)!;
    const id = chooseAutoPick(state, seat, byId, rng, 2);
    applyPick(state, seat, id, true, byId);
  }
  return [0, 1, 2, 3].map((s) => rosterOf(state, s).map((id) => byId.get(id)!));
}

const agg = { fouls: 0, matches: 0, goals: 0, shots: 0, onTarget: 0, xg: 0, draws: 0, yellow: 0, red: 0, subs: 0, possMax: 0, passAcc: 0, corners: 0 };
const gapBuckets = new Map<number, { n: number; strongerWins: number; draws: number }>();
const t0 = Date.now();

for (let i = 0; i < N; i++) {
  const rosters = draftLeague(`balance-${i}`);
  const rng = new Rng(`lineup-${i}`);
  const lineups: Lineup[] = rosters.map((r) => cpuLineup(r, rng));
  for (const md of ROUND_ROBIN_4) {
    for (const [h, a] of md) {
      const res = simulateMatch({
        seed: `bal-${i}-${h}-${a}`,
        home: { seat: h, name: `T${h}`, players: rosters[h], lineup: lineups[h] },
        away: { seat: a, name: `T${a}`, players: rosters[a], lineup: lineups[a] },
      });
      record(res);
      const sh = lineupStrength(lineups[h], byId);
      const sa = lineupStrength(lineups[a], byId);
      const gap = Math.min(10, Math.floor(Math.abs(sh - sa) / 2) * 2);
      const b = gapBuckets.get(gap) ?? { n: 0, strongerWins: 0, draws: 0 };
      b.n++;
      const strongerHome = sh >= sa;
      if (res.score.home === res.score.away) b.draws++;
      else if ((res.score.home > res.score.away) === strongerHome) b.strongerWins++;
      gapBuckets.set(gap, b);
    }
  }
}

function record(res: MatchResultData) {
  agg.matches++;
  agg.goals += res.score.home + res.score.away;
  for (const s of [res.stats.home, res.stats.away]) {
    agg.shots += s.shots;
    agg.onTarget += s.shotsOnTarget;
    agg.xg += s.xg;
    agg.yellow += s.yellow;
    agg.fouls += s.fouls;
    agg.red += s.red;
    agg.corners += s.corners;
    agg.passAcc += s.passes ? s.passesCompleted / s.passes : 0;
  }
  agg.possMax += Math.max(res.stats.home.possession, res.stats.away.possession);
  agg.subs += res.events.filter((e) => e.type === 'sub').length;
  if (res.score.home === res.score.away) agg.draws++;
}

const m = agg.matches;
console.log(`\n=== ${m} matches (${N} leagues) in ${Date.now() - t0} ms (${((Date.now() - t0) / m).toFixed(1)} ms/match incl. draft) ===`);
console.log(`goals/match      ${(agg.goals / m).toFixed(2)}   (target 2.4-3.0)`);
console.log(`shots/team       ${(agg.shots / m / 2).toFixed(1)}   (target 10-15)`);
console.log(`on target/team   ${(agg.onTarget / m / 2).toFixed(1)}   (target 3.5-5.5)`);
console.log(`xG/team          ${(agg.xg / m / 2).toFixed(2)}`);
console.log(`draw rate        ${((agg.draws / m) * 100).toFixed(1)}%   (target 20-30%)`);
console.log(`fouls/match      ${(agg.fouls / m).toFixed(1)}`);
console.log(`yellow/match     ${(agg.yellow / m).toFixed(2)}   red/match ${(agg.red / m).toFixed(3)}`);
console.log(`corners/team     ${(agg.corners / m / 2).toFixed(1)}`);
console.log(`subs/match       ${(agg.subs / m).toFixed(2)}`);
console.log(`pass accuracy    ${((agg.passAcc / m / 2) * 100).toFixed(1)}%`);
console.log(`avg max poss.    ${(agg.possMax / m).toFixed(1)}%`);
console.log('\nstrength gap (XI avg rating) -> stronger team result');
for (const [gap, b] of [...gapBuckets.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  gap ${String(gap).padStart(2)}+  n=${String(b.n).padStart(5)}  stronger win ${((b.strongerWins / b.n) * 100).toFixed(1)}%  draw ${((b.draws / b.n) * 100).toFixed(1)}%`);
}

// ---- strength test: random (undrafted) squads give a wide range of gaps
const wide = new Map<number, { n: number; strongerWins: number; draws: number }>();
const groups = { GK: catalog.filter((p) => p.primaryPosition === 'GK'), OUT: catalog.filter((p) => p.primaryPosition !== 'GK') };
for (let i = 0; i < 1500; i++) {
  const rng = new Rng(`wide-${i}`);
  const squad = () => [...rng.shuffle(groups.GK).slice(0, 2), ...rng.shuffle(groups.OUT).slice(0, 12)];
  const a = squad();
  const b = squad().filter((p) => !a.includes(p));
  if (b.length < 14) continue;
  const la = cpuLineup(a, rng);
  const lb = cpuLineup(b, rng);
  const r = simulateMatch({ seed: `wide-${i}`, home: { seat: 0, name: 'A', players: a, lineup: la }, away: { seat: 1, name: 'B', players: b, lineup: lb } });
  const sa = lineupStrength(la, byId);
  const sb = lineupStrength(lb, byId);
  const gap = Math.min(20, Math.floor(Math.abs(sa - sb) / 4) * 4);
  const e = wide.get(gap) ?? { n: 0, strongerWins: 0, draws: 0 };
  e.n++;
  if (r.score.home === r.score.away) e.draws++;
  else if ((r.score.home > r.score.away) === sa >= sb) e.strongerWins++;
  wide.set(gap, e);
}
console.log('\nrandom squads: strength gap -> stronger team result');
for (const [gap, b] of [...wide.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  gap ${String(gap).padStart(2)}+  n=${String(b.n).padStart(5)}  stronger win ${((b.strongerWins / b.n) * 100).toFixed(1)}%  draw ${((b.draws / b.n) * 100).toFixed(1)}%`);
}

// ---- tactic mirror test
const offense: Tactics['offense'][] = ['possession', 'counter', 'long_ball'];
const defense: Tactics['defense'][] = ['high_press', 'mid_block', 'low_block'];
const combos = offense.flatMap((o) => defense.map((d) => ({ o, d })));
const squads = Array.from({ length: 24 }, (_, i) => draftLeague(`mirror-${i}`)[i % 4]);
const pts = new Map<string, { pts: number; n: number }>();
const key = (c: { o: string; d: string }) => `${c.o}/${c.d}`;
for (const a of combos) {
  for (const b of combos) {
    if (a === b) continue;
    for (let s = 0; s < squads.length; s++) {
      const squad = squads[s];
      const base = autoLineup(squad);
      const la: Lineup = { ...base, tactics: { ...DEFAULT_TACTICS, offense: a.o, defense: a.d } };
      const lb: Lineup = { ...base, tactics: { ...DEFAULT_TACTICS, offense: b.o, defense: b.d } };
      const r = simulateMatch({ seed: `mirror-${key(a)}-${key(b)}-${s}`, home: { seat: 0, name: 'A', players: squad, lineup: la }, away: { seat: 1, name: 'B', players: squad, lineup: lb } });
      const pa = r.score.home > r.score.away ? 3 : r.score.home === r.score.away ? 1 : 0;
      const e = pts.get(key(a)) ?? { pts: 0, n: 0 };
      e.pts += pa;
      e.n++;
      pts.set(key(a), e);
    }
  }
}
console.log('\nmirror matches: points per game by tactic (same squad, vs every other tactic). Ideal ~1.35 each');
for (const [k, v] of [...pts.entries()].sort((a, b) => b[1].pts / b[1].n - a[1].pts / a[1].n)) {
  console.log(`  ${k.padEnd(24)} ${(v.pts / v.n).toFixed(2)}`);
}
void GAME_CONFIG;
