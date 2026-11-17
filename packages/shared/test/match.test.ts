import { describe, expect, it } from 'vitest';
import { FORMATIONS, MATCH_CONFIG, POSITION_GROUP, buildCpuSquad, enhancePlayer, getCatalog, pickStarterCards, seededRandom, squadLineup, validateLineup } from '../src';


const catalog = getCatalog();
const commons = catalog.filter((p) => p.rarity === 'common');

describe('MATCH (decisions 68-74)', () => {
  it('strengthening adds +1 per level to OVR, card stats and SIM attributes (max +5, max 99)', () => {
    const p = commons[0];
    const e = enhancePlayer(p, 3);
    expect(e.ovr).toBe(p.ovr + 3);
    expect(e.stats.pac).toBe(Math.min(99, p.stats.pac + 3));
    expect(e.attributes.finishing).toBe(Math.min(99, p.attributes.finishing + 3));
    expect(enhancePlayer(p, 9).ovr).toBe(p.ovr + MATCH_CONFIG.maxLevel);
    expect(enhancePlayer(p, 0)).toBe(p);
    const top = catalog.reduce((a, b) => (a.ovr > b.ovr ? a : b));
    expect(enhancePlayer(top, 5).ovr).toBeLessThanOrEqual(99);
  });

  it('the first 11 cards: COMMON, GK1 DF4 MF3 FW3, different every time, valid 4-3-3', () => {
    const a = pickStarterCards(commons, seededRandom('a'));
    const b = pickStarterCards(commons, seededRandom('b'));
    expect(a).toHaveLength(11);
    expect(new Set(a).size).toBe(11);
    expect(a).not.toEqual(b);
    const byId = new Map(catalog.map((p) => [p.id, p]));
    const groups = a.map((id) => POSITION_GROUP[byId.get(id)!.primaryPosition]);
    expect(groups.filter((g) => g === 'GK')).toHaveLength(1);
    expect(groups.filter((g) => g === 'DF')).toHaveLength(4);
    expect(groups.filter((g) => g === 'MF')).toHaveLength(3);
    expect(groups.filter((g) => g === 'FW')).toHaveLength(3);
    for (const id of a) expect(byId.get(id)!.rarity).toBe('common');
    const lineup = squadLineup(a.map((id) => byId.get(id)!), MATCH_CONFIG.starterFormation);
    expect(validateLineup(lineup, a)).toBeNull();
    expect(lineup.bench).toEqual([]);
  });

  it('CPU teams: 14 different cards around the target OVR that fit their formation', () => {
    for (const target of [58, 72, 85]) {
      const { cards, formation } = buildCpuSquad(catalog, target, seededRandom(`cpu${target}`));
      expect(cards).toHaveLength(14);
      expect(new Set(cards.map((c) => c.id)).size).toBe(14);
      const starters = cards.slice(0, 11);
      const avg = starters.reduce((s, p) => s + p.ovr, 0) / 11;
      expect(Math.abs(avg - target)).toBeLessThan(6);
      FORMATIONS[formation].slots.forEach((slot, i) => expect(POSITION_GROUP[starters[i].primaryPosition]).toBe(POSITION_GROUP[slot.pos]));
    }
  });
});
