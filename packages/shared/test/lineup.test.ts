import { describe, expect, it } from 'vitest';
import { DEFAULT_TACTICS, FORMATIONS, autoLineup, computeChemistry, getCatalog, validateLineup } from '../src';

const catalog = getCatalog();
const gk = catalog.filter((p) => p.primaryPosition === 'GK').slice(0, 2);
const out = catalog.filter((p) => p.primaryPosition !== 'GK').slice(0, 12);
const roster = [...gk, ...out];
const ids = roster.map((p) => p.id);

describe('lineup', () => {
  it('auto lineup uses 11 starters + 3 bench with a GK in goal', () => {
    const l = autoLineup(roster);
    expect(l.starters).toHaveLength(11);
    expect(l.bench).toHaveLength(3);
    expect(new Set([...l.starters, ...l.bench]).size).toBe(14);
    const gkSlot = FORMATIONS[l.formation].slots.findIndex((s) => s.pos === 'GK');
    expect(roster.find((p) => p.id === l.starters[gkSlot])!.primaryPosition).toBe('GK');
    expect(validateLineup(l, ids)).toBeNull();
  });

  it('rejects invalid lineups', () => {
    const l = autoLineup(roster);
    expect(validateLineup({ ...l, formation: '9-9-9' }, ids)).toBe('INVALID_FORMATION');
    expect(validateLineup({ ...l, starters: l.starters.slice(0, 10) }, ids)).toBe('INVALID_STARTERS');
    expect(validateLineup({ ...l, bench: [l.starters[0], ...l.bench.slice(1)] }, ids)).toBe('DUPLICATE_PLAYER');
    expect(validateLineup({ ...l, starters: ['x', ...l.starters.slice(1)] }, ids)).toBe('UNKNOWN_PLAYER');
    expect(validateLineup({ ...l, tactics: { ...DEFAULT_TACTICS, offense: 'tiki' } }, ids)).toBe('INVALID_TACTICS');
  });

  it('chemistry is within 0..100 and modifies the SIM by at most ±6%', () => {
    const l = autoLineup(roster);
    const c = computeChemistry(l.starters.map((id) => roster.find((p) => p.id === id)), l.formation, l.tactics);
    expect(c.score).toBeGreaterThanOrEqual(0);
    expect(c.score).toBeLessThanOrEqual(100);
    expect(c.modifier).toBeGreaterThanOrEqual(0.94);
    expect(c.modifier).toBeLessThanOrEqual(1.06);
  });
});
