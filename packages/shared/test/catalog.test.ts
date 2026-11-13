import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CLUB_BY_ID,
  GAME_CONFIG,
  NATION_BY_CODE,
  PHOTO_CARD_IDS,
  POSITIONS,
  RARITY_INFO,
  TRAIT_IDS,
  convertPlayerDatabase,
  getCatalog,
  ratingAt,
  type RawPlayerDb,
  type RawSimDb,
} from '../src';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const raw = JSON.parse(readFileSync(join(ROOT, 'data/player-db-v1/players.json'), 'utf8')) as RawPlayerDb;
const sim = JSON.parse(readFileSync(join(ROOT, 'data/player-db-v1/simulation_attributes.json'), 'utf8')) as RawSimDb;

describe('player catalog = FOOTBALL DRAFT 300 Player Database v1', () => {
  const catalog = getCatalog();

  it('has 300 cards with unique ids and names', () => {
    expect(catalog).toHaveLength(GAME_CONFIG.catalogSize);
    expect(new Set(catalog.map((p) => p.id)).size).toBe(300);
    expect(new Set(catalog.map((p) => p.name)).size).toBe(300);
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

  it('takes display stats, OVR, positions, traits and SIM attributes from the database as-is', () => {
    const simById = new Map(sim.records.map((r) => [r.player_id, r.attributes]));
    for (const r of raw.players) {
      const p = catalog.find((x) => x.id === r.id)!;
      expect(p.name).toBe(r.name);
      expect(p.ovr).toBe(r.overall);
      expect(p.stats).toEqual({ pac: r.display_stats.PAC, sho: r.display_stats.SHO, pas: r.display_stats.PAS, dri: r.display_stats.DRI, def: r.display_stats.DEF, phy: r.display_stats.PHY });
      expect(p.positions).toEqual(r.positions);
      expect(p.traits.length).toBe(r.traits.length);
      expect(p.attributes.sprintSpeed).toBe(simById.get(r.id)!.sprint_speed);
      expect(p.attributes.gkReflexes).toBe(simById.get(r.id)!.goalkeeper_reflexes);
      expect(p.cardAsset).toBe(r.card_asset);
    }
  });

  it('every card has a valid nation, club, positions, traits and a card image', () => {
    for (const p of catalog) {
      expect(NATION_BY_CODE[p.nationality]).toBeTruthy();
      expect(CLUB_BY_ID[p.clubId].leagueId).toBe(p.leagueId);
      for (const pos of p.positions) expect(POSITIONS).toContain(pos);
      for (const t of p.traits) expect(TRAIT_IDS).toContain(t);
      expect(existsSync(join(ROOT, 'assets', p.cardAsset))).toBe(true);
    }
  });

  it('CF / LWB / RWB are supported as positions', () => {
    expect(catalog.some((p) => p.primaryPosition === 'CF')).toBe(true);
    expect(catalog.some((p) => p.positions.includes('LWB'))).toBe(true);
    const cf = catalog.find((p) => p.primaryPosition === 'CF')!;
    // a CF is natural in the ST slot (no familiarity penalty)
    expect(ratingAt(cf, 'ST')).toBeGreaterThanOrEqual(ratingAt({ ...cf, positions: ['CAM'] }, 'ST'));
  });

  it('rating at the primary position equals the card OVR', () => {
    for (const p of catalog) expect(ratingAt(p, p.primaryPosition)).toBe(p.ovr);
  });

  it('rejects an invalid database', () => {
    const broken = { ...raw, players: [{ ...raw.players[0], traits: ['Unknown Trait'] }] };
    expect(() => convertPlayerDatabase(broken, sim)).toThrow(/unknown trait/);
  });

  it('every card has its own player (distinct illustrated faces, rendered card images)', () => {
    const looks = JSON.parse(readFileSync(join(ROOT, 'data/player-db-v1/appearance.json'), 'utf8')).players as Record<string, Record<string, unknown>>;
    expect(Object.keys(looks)).toHaveLength(300);
    const faces = new Set(Object.values(looks).map((a) => `${a.skinTone}|${a.hairStyle}|${a.hairColor}|${a.facialHair}`));
    expect(faces.size).toBe(300);
    for (const p of catalog) {
      expect(looks[p.id]).toBeTruthy();
      // the served card differs from the original silhouette card of the database
      const original = readFileSync(join(ROOT, 'data/player-db-v1', p.cardAsset));
      const rendered = readFileSync(join(ROOT, 'assets', p.cardAsset));
      expect(rendered.equals(original)).toBe(false);
    }
  });

  it('photo cards: every listed portrait exists and was built into the served card', () => {
    const portraits = JSON.parse(readFileSync(join(ROOT, 'data/player-db-v1/portraits.json'), 'utf8')).players as Record<string, { model: string }>;
    const ids = new Set(catalog.map((p) => p.id));
    expect(PHOTO_CARD_IDS.size).toBe(Object.keys(portraits).length);
    for (const id of PHOTO_CARD_IDS) {
      expect(ids.has(id)).toBe(true);
      expect(portraits[id].model).toBeTruthy();
      expect(existsSync(join(ROOT, 'data/player-db-v1/portraits', `${id}.jpg`))).toBe(true);
    }
    // the portrait files and the list match exactly
    const jpgs = readdirSync(join(ROOT, 'data/player-db-v1/portraits')).filter((f) => f.endsWith('.jpg'));
    expect(jpgs.map((f) => f.slice(0, -4)).sort()).toEqual([...PHOTO_CARD_IDS].sort());
  });

  it('has enough goalkeepers for the draft pool', () => {
    expect(catalog.filter((p) => p.primaryPosition === 'GK').length).toBeGreaterThanOrEqual(GAME_CONFIG.pool.GK);
  });
});
