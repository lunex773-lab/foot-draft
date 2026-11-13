import { describe, expect, it } from 'vitest';
import { ROUND_ROBIN_4, computeStandings } from '../src';

describe('round-robin league', () => {
  it('every pair plays exactly once over 3 matchdays', () => {
    const pairs = ROUND_ROBIN_4.flat().map(([a, b]) => [Math.min(a, b), Math.max(a, b)].join('-'));
    expect(new Set(pairs).size).toBe(6);
    for (const md of ROUND_ROBIN_4) expect(new Set(md.flat()).size).toBe(4);
  });

  it('ranks by points, goal difference, goals for', () => {
    const rows = computeStandings(
      4,
      [
        { matchday: 1, home: 0, away: 1, homeGoals: 2, awayGoals: 0 },
        { matchday: 1, home: 2, away: 3, homeGoals: 1, awayGoals: 1 },
        { matchday: 2, home: 2, away: 0, homeGoals: 3, awayGoals: 0 },
        { matchday: 2, home: 3, away: 1, homeGoals: 0, awayGoals: 1 },
        { matchday: 3, home: 0, away: 3, homeGoals: 1, awayGoals: 0 },
        { matchday: 3, home: 1, away: 2, homeGoals: 1, awayGoals: 1 },
      ],
      'x',
    );
    // seat 2: W1 D2 = 5pts GD +3 ; seat 0: W2 L1 = 6 pts GD 0 ; seat 1: W1 D1 L1 = 4 ; seat 3: D1 L2 = 1
    expect(rows.map((r) => r.seat)).toEqual([0, 2, 1, 3]);
    expect(rows[0].points).toBe(6);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it('breaks full ties deterministically', () => {
    const a = computeStandings(4, [], 'seed');
    const b = computeStandings(4, [], 'seed');
    expect(a.map((r) => r.seat)).toEqual(b.map((r) => r.seat));
  });
});
