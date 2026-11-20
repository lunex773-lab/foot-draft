import { CLUB_BY_ID, LEAGUE_BY_NAME } from '../data/clubs';
import { NATION_BY_CODE } from '../data/nations';
import { POSITIONS } from '../data/positions';
import { TRAIT_BY_NAME } from '../data/traits';
import { balanceCard } from './balance';
import type { InternalAttributes, Player, Position, Rarity } from '../types';
import { deriveRole } from './roles';

/** Raw format of "FOOTBALL DRAFT 300 Player Database v1" (players.json). */
export interface RawPlayerDb {
  schema_version: string;
  player_count: number;
  players: {
    id: string;
    name: string;
    nationality_code: string;
    nationality: string;
    club_id: string;
    club_name: string;
    league_name: string;
    primary_position: string;
    positions: string[];
    rarity: string;
    overall: number;
    display_stats: { PAC: number; SHO: number; PAS: number; DRI: number; DEF: number; PHY: number };
    traits: string[];
    height_cm: number;
    age: number;
    card_template: string;
    card_asset: string;
  }[];
}

/** simulation_attributes.json */
export interface RawSimDb {
  schema_version: string;
  records: { player_id: string; attributes: Record<string, number> }[];
}

const ATTR_MAP: Record<string, keyof InternalAttributes> = {
  acceleration: 'acceleration',
  sprint_speed: 'sprintSpeed',
  shot_accuracy: 'shotAccuracy',
  shot_power: 'shotPower',
  finishing: 'finishing',
  short_passing: 'shortPassing',
  long_passing: 'longPassing',
  vision: 'vision',
  ball_control: 'ballControl',
  dribbling: 'dribbling',
  tackling: 'tackling',
  interception: 'interception',
  positioning: 'positioning',
  stamina: 'stamina',
  strength: 'strength',
  jumping: 'jumping',
  goalkeeper_reflexes: 'gkReflexes',
  goalkeeper_handling: 'gkHandling',
  goalkeeper_positioning: 'gkPositioning',
};

const RARITY_MAP: Record<string, Rarity> = { Common: 'common', Rare: 'rare', Epic: 'epic', Legendary: 'legendary', Icon: 'icon' };

/**
 * Converts the player database into game players. Positions are taken
 * as-is; OVR, stats and special abilities then get the card balance
 * (balance.ts: OVR bands by rarity, abilities by rarity). The role is
 * derived from the database's own attributes. Throws on any inconsistency.
 */
export function convertPlayerDatabase(db: RawPlayerDb, sim: RawSimDb): Player[] {
  const simById = new Map(sim.records.map((r) => [r.player_id, r.attributes]));
  const errors: string[] = [];
  const players: Player[] = [];
  for (const r of db.players) {
    const fail = (m: string) => errors.push(`${r.id}: ${m}`);
    const rarity = RARITY_MAP[r.rarity];
    if (!rarity) fail(`unknown rarity ${r.rarity}`);
    const league = LEAGUE_BY_NAME[r.league_name];
    const club = CLUB_BY_ID[r.club_id];
    if (!league) fail(`unknown league ${r.league_name}`);
    if (!club || club.name !== r.club_name || club.leagueId !== league?.id) fail(`club mismatch ${r.club_id} ${r.club_name}`);
    if (!NATION_BY_CODE[r.nationality_code]) fail(`unknown nation ${r.nationality_code}`);
    const positions = r.positions as Position[];
    if (!positions.every((p) => POSITIONS.includes(p))) fail(`unknown position in ${positions.join(',')}`);
    if (positions[0] !== r.primary_position) fail('primary position must be listed first');
    const traits = r.traits.map((t) => TRAIT_BY_NAME[t]);
    if (traits.some((t) => !t)) fail(`unknown trait in ${r.traits.join(',')}`);
    const raw = simById.get(r.id);
    if (!raw) {
      fail('missing simulation attributes');
      continue;
    }
    const attributes = {} as InternalAttributes;
    for (const [k, v] of Object.entries(ATTR_MAP)) {
      const val = raw[k];
      if (typeof val !== 'number' || val < 1 || val > 99) fail(`attribute ${k}=${val}`);
      attributes[v] = val;
    }
    const s = r.display_stats;
    const stats = { pac: s.PAC, sho: s.SHO, pas: s.PAS, dri: s.DRI, def: s.DEF, phy: s.PHY };
    if (Object.values(stats).some((v) => typeof v !== 'number' || v < 1 || v > 99)) fail('display stat out of range');
    const space = r.name.indexOf(' ');
    players.push({
      id: r.id,
      name: r.name,
      firstName: space > 0 ? r.name.slice(0, space) : r.name,
      lastName: space > 0 ? r.name.slice(space + 1) : r.name,
      nationality: r.nationality_code,
      leagueId: league?.id ?? '',
      clubId: r.club_id,
      rarity,
      primaryPosition: positions[0],
      positions,
      ovr: r.overall,
      role: deriveRole(positions[0], attributes),
      traits,
      attributes,
      stats,
      age: r.age,
      heightCm: r.height_cm,
      cardAsset: r.card_asset,
    });
  }
  if (new Set(players.map((p) => p.id)).size !== players.length) errors.push('duplicate ids');
  if (errors.length) throw new Error(`player database is invalid:\n${errors.slice(0, 20).join('\n')}`);
  return players.map(balanceCard);
}
