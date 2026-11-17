import {
  ECONOMY_CONFIG,
  MATCH_CONFIG,
  autoLineup,
  cryptoRandom,
  enhancePlayer,
  pickStarterCards,
  squadLineup,
  validateLineup,
  type Lineup,
  type Player,
} from '@fd/shared';
import type { Env } from '../env';
import { analyticsWhen, pointStmts, runOperation } from './economy';
import { loadCatalog } from './players';

/**
 * MATCH teams (official spec v2.0, decisions 70-73): owned cards with their
 * strengthening level, the first 11 cards and the saved teams.
 */

export interface OwnedCard {
  playerId: string;
  level: number;
  favorite: boolean;
  source: string;
  obtainedAt: number;
}

export async function ownedCards(env: Env, userId: string): Promise<OwnedCard[]> {
  const rows = await env.DB.prepare('SELECT player_id, level, favorite, source, obtained_at FROM user_collections WHERE user_id = ? ORDER BY obtained_at DESC, player_id')
    .bind(userId)
    .all<{ player_id: string; level: number; favorite: number; source: string; obtained_at: number }>();
  return rows.results.map((r) => ({ playerId: r.player_id, level: r.level, favorite: r.favorite === 1, source: r.source, obtainedAt: r.obtained_at }));
}

export interface SquadRow {
  slot: number;
  name: string;
  lineup: Lineup;
  updatedAt: number;
}

export async function squadsOf(env: Env, userId: string): Promise<{ squads: SquadRow[]; active: number | null }> {
  const rows = await env.DB.prepare('SELECT slot, name, lineup_json, updated_at FROM user_squads WHERE user_id = ? ORDER BY slot').bind(userId).all<{
    slot: number;
    name: string;
    lineup_json: string;
    updated_at: number;
  }>();
  const active = await env.DB.prepare('SELECT slot FROM user_squad_active WHERE user_id = ?').bind(userId).first<{ slot: number }>();
  return {
    squads: rows.results.map((r) => ({ slot: r.slot, name: r.name, lineup: JSON.parse(r.lineup_json) as Lineup, updatedAt: r.updated_at })),
    active: active?.slot ?? null,
  };
}

/** test data resets done for the player: each one gives the first 11 cards again */
async function resetGeneration(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM test_resets WHERE user_id = ? AND done_at IS NOT NULL').bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

export interface StarterResult {
  granted: boolean;
  /** the 11 cards (new cards and cards strengthened by them) */
  cards: { playerId: string; newCard: boolean; levelTo: number | null; points: number }[];
}

/**
 * The first 11 cards (decision 72): random COMMON cards GK1 / DF4 / MF3 / FW3,
 * once per player, also for players who had cards before. A card that is
 * already owned is strengthened (+1, up to +5; at +5 it becomes Standard
 * points like a gacha duplicate). Team 1 is made from the owned cards.
 * Runs as an economy operation, so it is serialized with gacha draws.
 */
export async function ensureStarter(env: Env, userId: string): Promise<StarterResult & { replayed?: boolean }> {
  const requestId = `starter-squad-${await resetGeneration(env, userId)}`;
  return runOperation<StarterResult>(env, userId, requestId, 'starter', async ({ opId, now }) => {
    const catalog = await loadCatalog(env);
    const commons = catalog.filter((p) => p.rarity === 'common');
    const ids = pickStarterCards(commons, cryptoRandom());
    const owned = new Map((await ownedCards(env, userId)).map((c) => [c.playerId, c.level]));
    const cards: StarterResult['cards'] = ids.map((id) => {
      const before = owned.get(id);
      if (before === undefined) return { playerId: id, newCard: true, levelTo: null, points: 0 };
      if (before < MATCH_CONFIG.maxLevel) return { playerId: id, newCard: false, levelTo: before + 1, points: 0 };
      return { playerId: id, newCard: false, levelTo: null, points: ECONOMY_CONFIG.duplicatePoints.common };
    });
    const stmts: D1PreparedStatement[] = [];
    const fresh = cards.filter((c) => c.newCard).map((c) => c.playerId);
    if (fresh.length) {
      stmts.push(
        env.DB.prepare("INSERT INTO user_collections (user_id, player_id, source, source_ref, obtained_at) SELECT ?1, j.value, 'starter', 'starter-squad', ?2 FROM json_each(?3) j").bind(
          userId,
          now,
          JSON.stringify(fresh),
        ),
      );
    }
    for (const c of cards.filter((x) => x.levelTo !== null)) {
      stmts.push(env.DB.prepare('UPDATE user_collections SET level = ? WHERE user_id = ? AND player_id = ?').bind(c.levelTo, userId, c.playerId));
    }
    const points = cards.reduce((s, c) => s + c.points, 0);
    if (points > 0) stmts.push(...pointStmts(env, { userId, pointType: 'standard', amount: points, reason: 'duplicate', refType: 'starter', refId: requestId, opId, now }));

    // team 1 from the owned cards (only the 11 starters for a new player)
    const byId = new Map(catalog.map((p) => [p.id, p]));
    const levels = new Map(owned);
    for (const c of cards) levels.set(c.playerId, c.levelTo ?? levels.get(c.playerId) ?? 0);
    const all = [...levels.entries()].filter(([id]) => byId.has(id)).map(([id, lv]) => enhancePlayer(byId.get(id)!, lv));
    const lineup = all.length === ids.length ? squadLineup(all, MATCH_CONFIG.starterFormation) : bestSquad(all);
    stmts.push(
      env.DB.prepare('INSERT OR IGNORE INTO user_squads (user_id, slot, name, lineup_json, updated_at) VALUES (?, 1, ?, ?, ?)').bind(userId, 'チーム1', JSON.stringify(lineup), now),
      env.DB.prepare('INSERT OR IGNORE INTO user_squad_active (user_id, slot, updated_at) VALUES (?, 1, ?)').bind(userId, now),
      analyticsWhen(env, 'starter_granted', userId, { cards: ids.length, newCards: fresh.length, strengthened: cards.filter((c) => c.levelTo !== null).length, points }, now),
    );
    return { statements: stmts, response: { granted: true, cards } };
  });
}

/** best team of 11 + up to 3 substitutes (highest OVR) from the given strengthened cards: おまかせ編成 */
export function bestSquad(cards: readonly Player[], formation?: Parameters<typeof autoLineup>[1]): Lineup {
  return autoLineup(cards, formation);
}

export interface MatchTeam {
  lineup: Lineup;
  /** player id -> level of the cards in the lineup */
  levels: Record<string, number>;
}

/**
 * The team a player brings to MATCH: the active saved team. When it is not
 * valid any more (cards removed by a test reset), the best team of the owned
 * cards is used instead.
 */
export async function loadMatchTeam(env: Env, userId: string, catalog: readonly Player[]): Promise<MatchTeam> {
  const cards = await ownedCards(env, userId);
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const usable = cards.filter((c) => byId.has(c.playerId));
  const levelOf = new Map(usable.map((c) => [c.playerId, c.level]));
  const ids = usable.map((c) => c.playerId);
  const { squads, active } = await squadsOf(env, userId);
  const chosen = squads.find((s) => s.slot === active) ?? squads[0];
  let lineup: Lineup | null = chosen && !validateLineup(chosen.lineup, ids) ? chosen.lineup : null;
  if (!lineup) {
    if (usable.length < 11) throw new Error('not enough cards for a team');
    lineup = bestSquad(usable.map((c) => enhancePlayer(byId.get(c.playerId)!, c.level)));
  }
  const levels: Record<string, number> = {};
  for (const id of [...lineup.starters, ...lineup.bench]) levels[id] = levelOf.get(id) ?? 0;
  return { lineup, levels };
}
