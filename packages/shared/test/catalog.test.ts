import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ABILITY_COUNT,
  CARD_ABILITIES,
  CLUB_BY_ID,
  GAME_CONFIG,
  NATION_BY_CODE,
  PHOTO_CARD_IDS,
  POSITIONS,
  POSITION_GROUP,
  RARITIES,
  RARITY_INFO,
  TRAITS,
  TRAIT_IDS,
  bandedOvr,
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

  it('takes the database and moves OVR into its rarity band; the stats and SIM attributes move with it (decision 121)', () => {
    const simById = new Map(sim.records.map((r) => [r.player_id, r.attributes]));
    const c = (v: number) => Math.max(1, Math.min(99, v));
    for (const r of raw.players) {
      const p = catalog.find((x) => x.id === r.id)!;
      const d = p.ovr - r.overall;
      expect(p.name).toBe(r.name);
      expect(p.ovr).toBe(bandedOvr(p.rarity, r.overall));
      expect(p.stats).toEqual({ pac: c(r.display_stats.PAC + d), sho: c(r.display_stats.SHO + d), pas: c(r.display_stats.PAS + d), dri: c(r.display_stats.DRI + d), def: c(r.display_stats.DEF + d), phy: c(r.display_stats.PHY + d) });
      expect(p.positions).toEqual(r.positions);
      expect(p.attributes.sprintSpeed).toBe(c(simById.get(r.id)!.sprint_speed + d));
      expect(p.attributes.gkReflexes).toBe(c(simById.get(r.id)!.goalkeeper_reflexes + d));
      expect(p.cardAsset).toBe(r.card_asset);
    }
  });

  it('no card starts above a card of a higher rarity, and the order inside a rarity is kept', () => {
    for (let i = 0; i + 1 < RARITIES.length; i++) {
      const lower = Math.max(...catalog.filter((p) => p.rarity === RARITIES[i]).map((p) => p.ovr));
      const higher = Math.min(...catalog.filter((p) => p.rarity === RARITIES[i + 1]).map((p) => p.ovr));
      expect(lower).toBeLessThan(higher);
    }
    for (const r of raw.players)
      for (const s of raw.players) {
        if (r.rarity !== s.rarity || r.overall >= s.overall) continue;
        const a = catalog.find((x) => x.id === r.id)!.ovr;
        const b = catalog.find((x) => x.id === s.id)!.ovr;
        expect(a).toBeLessThanOrEqual(b);
      }
  });

  it('special abilities: ICON 2 (one ICON-only first), EPIC / LEGENDARY 1, COMMON / RARE none (decisions 118-120)', () => {
    for (const p of catalog) {
      expect(p.traits).toHaveLength(ABILITY_COUNT[p.rarity]);
      expect(new Set(p.traits).size).toBe(p.traits.length);
      const iconOnly = p.traits.filter((t) => TRAITS[t].iconOnly);
      expect(iconOnly).toHaveLength(p.rarity === 'icon' ? 1 : 0);
      if (p.rarity === 'icon') expect(TRAITS[p.traits[0]].iconOnly).toBe(true);
    }
    expect(Object.keys(CARD_ABILITIES)).toHaveLength(catalog.filter((p) => ABILITY_COUNT[p.rarity] > 0).length);
    // every ability is used, and the abilities fit the position
    const used = new Set(catalog.flatMap((p) => p.traits));
    for (const t of TRAIT_IDS) expect(used.has(t)).toBe(true);
    const group = (pos: string) => POSITION_GROUP[pos as keyof typeof POSITION_GROUP];
    for (const p of catalog) {
      const g = group(p.primaryPosition);
      for (const t of p.traits) {
        if (t === 'sweeper_keeper' || t === 'shot_stopper') expect(g).toBe('GK');
        if (t === 'iron_wall') expect(p.primaryPosition).toBe('CB');
        if (t === 'fox_in_box') expect(g).toBe('FW');
        if (t === 'overlap') expect(['LB', 'RB', 'LWB', 'RWB']).toContain(p.primaryPosition);
        if (g === 'GK') expect(['sweeper_keeper', 'shot_stopper']).toContain(t);
      }
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
