import { Rng } from './rng';

/**
 * Round-robin league for 4 teams (confirmed: 3 matchdays, 6 matches).
 * Seats are 0..3.
 */
export const ROUND_ROBIN_4: [number, number][][] = [
  [
    [0, 1],
    [2, 3],
  ],
  [
    [2, 0],
    [3, 1],
  ],
  [
    [0, 3],
    [1, 2],
  ],
];

export interface FixtureResult {
  matchday: number;
  home: number;
  away: number;
  homeGoals: number;
  awayGoals: number;
}

export interface StandingRow {
  seat: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  rank: number;
}

/**
 * Standings: points (3/1/0) -> goal difference -> goals for ->
 * head-to-head points -> seeded lot (deterministic).
 */
export function computeStandings(seats: number, results: readonly FixtureResult[], lotSeed: string): StandingRow[] {
  const rows: StandingRow[] = Array.from({ length: seats }, (_, seat) => ({
    seat,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    points: 0,
    rank: 0,
  }));
  for (const r of results) {
    const h = rows[r.home];
    const a = rows[r.away];
    h.played++;
    a.played++;
    h.goalsFor += r.homeGoals;
    h.goalsAgainst += r.awayGoals;
    a.goalsFor += r.awayGoals;
    a.goalsAgainst += r.homeGoals;
    if (r.homeGoals > r.awayGoals) {
      h.won++;
      a.lost++;
      h.points += 3;
    } else if (r.homeGoals < r.awayGoals) {
      a.won++;
      h.lost++;
      a.points += 3;
    } else {
      h.drawn++;
      a.drawn++;
      h.points++;
      a.points++;
    }
  }
  for (const r of rows) r.goalDiff = r.goalsFor - r.goalsAgainst;

  const lot = new Rng(`lot:${lotSeed}`);
  const lotValue = rows.map(() => lot.next());
  const h2h = (x: number, y: number) => {
    let px = 0;
    let py = 0;
    for (const r of results) {
      if ((r.home === x && r.away === y) || (r.home === y && r.away === x)) {
        const xg = r.home === x ? r.homeGoals : r.awayGoals;
        const yg = r.home === y ? r.homeGoals : r.awayGoals;
        if (xg > yg) px += 3;
        else if (xg < yg) py += 3;
        else {
          px++;
          py++;
        }
      }
    }
    return py - px;
  };
  const sorted = [...rows].sort(
    (a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor || h2h(a.seat, b.seat) || lotValue[a.seat] - lotValue[b.seat],
  );
  sorted.forEach((r, i) => (r.rank = i + 1));
  return sorted;
}
