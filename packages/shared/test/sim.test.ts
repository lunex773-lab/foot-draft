import { describe, expect, it } from 'vitest';
import { Rng, SIM_VERSION, cpuLineup, getCatalog, simulateMatch, type SimInput } from '../src';

const catalog = getCatalog();
function team(offset: number) {
  const gks = catalog.filter((p) => p.primaryPosition === 'GK');
  const out = catalog.filter((p) => p.primaryPosition !== 'GK');
  return [gks[offset], gks[offset + 5], ...out.slice(offset * 12, offset * 12 + 12)];
}
const home = team(1);
const away = team(2);
const rng = new Rng('lineups');
const input = (seed: string): SimInput => ({
  seed,
  home: { seat: 0, name: 'H', players: home, lineup: cpuLineup(home, rng.fork('h')) },
  away: { seat: 1, name: 'A', players: away, lineup: cpuLineup(away, rng.fork('a')) },
});

describe('match simulation', () => {
  it('is reproducible with the same input and seed (spec 6-4)', () => {
    const i = input('repro-1');
    expect(simulateMatch(i)).toEqual(simulateMatch(i));
  });

  it('different seeds give different matches', () => {
    const a = simulateMatch(input('a'));
    const b = simulateMatch(input('b'));
    expect(a.events).not.toEqual(b.events);
  });

  it('produces consistent results', () => {
    for (let s = 0; s < 30; s++) {
      const r = simulateMatch(input(`c-${s}`));
      expect(r.simVersion).toBe(SIM_VERSION);
      const goalsHome = r.events.filter((e) => e.type === 'goal' && e.side === 'home').length;
      const goalsAway = r.events.filter((e) => e.type === 'goal' && e.side === 'away').length;
      expect(goalsHome).toBe(r.score.home);
      expect(goalsAway).toBe(r.score.away);
      expect(r.stats.home.goals).toBe(r.score.home);
      expect(r.stats.home.shotsOnTarget).toBeGreaterThanOrEqual(r.score.home);
      expect(r.stats.home.shots).toBeGreaterThanOrEqual(r.stats.home.shotsOnTarget);
      expect(r.stats.home.possession + r.stats.away.possession).toBe(100);
      for (let i = 1; i < r.events.length; i++) expect(r.events[i].minute).toBeGreaterThanOrEqual(r.events[i - 1].minute);
      expect(r.events[r.events.length - 1].type).toBe('full_time');
      for (const side of ['home', 'away'] as const) {
        expect(r.events.filter((e) => e.type === 'sub' && e.side === side).length).toBeLessThanOrEqual(3);
      }
      expect(r.players.find((p) => p.playerId === r.mvpId)).toBeTruthy();
      for (const p of r.players) {
        expect(p.rating).toBeGreaterThanOrEqual(3);
        expect(p.rating).toBeLessThanOrEqual(10);
        expect(p.minutes).toBeLessThanOrEqual(90);
      }
      expect(r.track.length).toBeGreaterThan(50);
    }
  });

  it('tactics change the outcome distribution', () => {
    const base = input('t');
    const possession = { ...base, home: { ...base.home, lineup: { ...base.home.lineup, tactics: { ...base.home.lineup.tactics, offense: 'possession' as const, tempo: 'slow' as const } } } };
    const direct = { ...base, home: { ...base.home, lineup: { ...base.home.lineup, tactics: { ...base.home.lineup.tactics, offense: 'long_ball' as const, tempo: 'fast' as const } } } };
    let pPoss = 0;
    let pDirect = 0;
    for (let s = 0; s < 40; s++) {
      pPoss += simulateMatch({ ...possession, seed: `tp-${s}` }).stats.home.possession;
      pDirect += simulateMatch({ ...direct, seed: `tp-${s}` }).stats.home.possession;
    }
    expect(pPoss / 40).toBeGreaterThan(pDirect / 40 + 3);
  });
});
