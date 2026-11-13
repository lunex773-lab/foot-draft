import { describe, expect, it } from 'vitest';
import {
  CLUB_BY_ID,
  GAME_CONFIG,
  NATION_BY_CODE,
  RARITY_INFO,
  SHOWCASE,
  computeDisplayStats,
  computeOvr,
  generateCatalog,
  getCatalog,
} from '../src';

describe('player catalog', () => {
  const catalog = getCatalog();

  it('has 240 cards with unique ids and names', () => {
    expect(catalog).toHaveLength(GAME_CONFIG.catalogSize);
    expect(new Set(catalog.map((p) => p.id)).size).toBe(catalog.length);
    expect(new Set(catalog.map((p) => p.name)).size).toBe(catalog.length);
  });

  it('is deterministic', () => {
    expect(generateCatalog()).toEqual(catalog);
  });

  it('matches the rarity counts and OVR bands', () => {
    for (const r of Object.values(RARITY_INFO)) {
      const list = catalog.filter((p) => p.rarity === r.id);
      expect(list).toHaveLength(r.catalogCount);
      for (const p of list) {
        expect(p.ovr).toBeGreaterThanOrEqual(r.ovrMin);
        expect(p.ovr).toBeLessThanOrEqual(r.ovrMax);
      }
    }
  });

  it('derives display stats and OVR from internal attributes', () => {
    for (const p of catalog) {
      expect(computeDisplayStats(p.attributes)).toEqual(p.stats);
      expect(computeOvr(p.attributes, p.primaryPosition)).toBe(p.ovr);
      for (const v of Object.values(p.attributes)) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(99);
      }
    }
  });

  it('reproduces the showcase cards from the design image exactly', () => {
    for (const s of SHOWCASE) {
      const p = catalog.find((x) => x.name === `${s.firstName} ${s.lastName}`)!;
      expect(p).toBeTruthy();
      expect(p.ovr).toBe(s.ovr);
      expect(p.stats).toEqual(s.stats);
      expect(p.rarity).toBe(s.rarity);
      expect(p.primaryPosition).toBe(s.position);
    }
  });

  it('every card has a valid nation, club, role and 2 traits', () => {
    for (const p of catalog) {
      expect(NATION_BY_CODE[p.nationality]).toBeTruthy();
      expect(CLUB_BY_ID[p.clubId].leagueId).toBe(p.leagueId);
      expect(p.traits).toHaveLength(2);
      expect(new Set(p.traits).size).toBe(2);
      expect(p.positions[0]).toBe(p.primaryPosition);
    }
  });

  it('has enough goalkeepers for the draft pool', () => {
    expect(catalog.filter((p) => p.primaryPosition === 'GK').length).toBeGreaterThanOrEqual(GAME_CONFIG.pool.GK);
  });
});
