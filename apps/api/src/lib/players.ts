import type { Player, Position, Rarity, RoleId, TraitId } from '@fd/shared';
import type { Env } from '../env';

/**
 * Player catalog loader. D1 is the source of truth; the result is cached per
 * isolate for a short time because the catalog changes rarely.
 */
let cache: { at: number; players: Player[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

interface CardRow {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  nationality: string;
  league_id: string;
  club_id: string;
  rarity: Rarity;
  primary_position: Position;
  ovr: number;
  role: RoleId;
  pac: number;
  sho: number;
  pas: number;
  dri: number;
  def: number;
  phy: number;
  age: number;
  height_cm: number;
  card_asset: string | null;
}

interface AttrRow {
  player_id: string;
  acceleration: number;
  sprint_speed: number;
  shot_accuracy: number;
  shot_power: number;
  finishing: number;
  short_passing: number;
  long_passing: number;
  vision: number;
  ball_control: number;
  dribbling: number;
  tackling: number;
  interception: number;
  positioning: number;
  stamina: number;
  strength: number;
  jumping: number;
  gk_reflexes: number;
  gk_handling: number;
  gk_positioning: number;
}

export async function loadCatalog(env: Env, opts: { fresh?: boolean } = {}): Promise<Player[]> {
  if (!opts.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.players;
  const [cards, attrs, positions, traits] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM player_cards WHERE is_active = 1 ORDER BY id'),
    env.DB.prepare('SELECT * FROM player_attributes'),
    env.DB.prepare('SELECT player_id, position FROM player_positions ORDER BY player_id, sort_order'),
    env.DB.prepare('SELECT player_id, trait FROM player_traits ORDER BY player_id, slot'),
  ]);
  const attrBy = new Map((attrs.results as unknown as AttrRow[]).map((a) => [a.player_id, a]));
  const posBy = new Map<string, Position[]>();
  for (const r of positions.results as unknown as { player_id: string; position: Position }[]) {
    if (!posBy.has(r.player_id)) posBy.set(r.player_id, []);
    posBy.get(r.player_id)!.push(r.position);
  }
  const traitBy = new Map<string, TraitId[]>();
  for (const r of traits.results as unknown as { player_id: string; trait: TraitId }[]) {
    if (!traitBy.has(r.player_id)) traitBy.set(r.player_id, []);
    traitBy.get(r.player_id)!.push(r.trait);
  }
  const players: Player[] = [];
  for (const c of cards.results as unknown as CardRow[]) {
    const a = attrBy.get(c.id);
    if (!a) continue;
    players.push({
      id: c.id,
      name: c.name,
      firstName: c.first_name,
      lastName: c.last_name,
      nationality: c.nationality,
      leagueId: c.league_id,
      clubId: c.club_id,
      rarity: c.rarity,
      primaryPosition: c.primary_position,
      positions: posBy.get(c.id) ?? [c.primary_position],
      ovr: c.ovr,
      role: c.role,
      traits: traitBy.get(c.id) ?? [],
      attributes: {
        acceleration: a.acceleration,
        sprintSpeed: a.sprint_speed,
        shotAccuracy: a.shot_accuracy,
        shotPower: a.shot_power,
        finishing: a.finishing,
        shortPassing: a.short_passing,
        longPassing: a.long_passing,
        vision: a.vision,
        ballControl: a.ball_control,
        dribbling: a.dribbling,
        tackling: a.tackling,
        interception: a.interception,
        positioning: a.positioning,
        stamina: a.stamina,
        strength: a.strength,
        jumping: a.jumping,
        gkReflexes: a.gk_reflexes,
        gkHandling: a.gk_handling,
        gkPositioning: a.gk_positioning,
      },
      stats: { pac: c.pac, sho: c.sho, pas: c.pas, dri: c.dri, def: c.def, phy: c.phy },
      age: c.age,
      heightCm: c.height_cm,
      cardAsset: c.card_asset ?? '',
    });
  }
  cache = { at: Date.now(), players };
  return players;
}
