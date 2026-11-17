import { MATCH_CONFIG, validateLineup, type Lineup, type RoomSettings } from '@fd/shared';
import { Hono } from 'hono';
import { track } from '../lib/analytics';
import { requireUser } from '../lib/auth';
import { analyticsWhen, missionCompletedAnalytics, missionProgressStmts, missionsCompletedBy } from '../lib/economy';
import { ApiError, readJson } from '../lib/http';
import { loadCatalog } from '../lib/players';
import { ensureStarter, ownedCards, squadsOf } from '../lib/team';
import type { AppEnv, Env } from '../env';
import { createRoom, joinOpenRoom } from './rooms';

/**
 * The team screen (decision 73): owned cards with their strengthening level
 * and favourite mark, 3 saved teams and the one used in MATCH.
 */
export const teamRoutes = new Hono<AppEnv>();
teamRoutes.use('*', requireUser);

async function teamState(env: Env, userId: string) {
  const catalog = new Set((await loadCatalog(env)).map((p) => p.id));
  const cards = (await ownedCards(env, userId)).filter((c) => catalog.has(c.playerId));
  const { squads, active } = await squadsOf(env, userId);
  return { cards, squads, active, slots: MATCH_CONFIG.squadSlots, maxLevel: MATCH_CONFIG.maxLevel };
}

function slotOf(v: string | undefined): number {
  const slot = Number(v);
  if (!Number.isInteger(slot) || slot < 1 || slot > MATCH_CONFIG.squadSlots) throw new ApiError('BAD_REQUEST', `slot must be 1-${MATCH_CONFIG.squadSlots}`);
  return slot;
}

teamRoutes.get('/', async (c) => {
  const user = c.get('user');
  const starter = await ensureStarter(c.env, user.id);
  // the first visit shows what the first 11 cards were
  return c.json({ ...(await teamState(c.env, user.id)), starter: starter.replayed ? null : starter.cards });
});

/** save a team (11 starters + up to 3 substitutes of owned cards, formation, tactics) */
teamRoutes.put('/squads/:slot', async (c) => {
  const user = c.get('user');
  const slot = slotOf(c.req.param('slot'));
  const body = await readJson<{ name?: unknown; lineup?: unknown }>(c);
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 16) : `チーム${slot}`;
  await ensureStarter(c.env, user.id);
  const owned = (await ownedCards(c.env, user.id)).map((x) => x.playerId);
  const err = validateLineup(body.lineup, owned);
  if (err) throw new ApiError(err, `invalid team: ${err}`);
  const l = body.lineup as Lineup;
  const lineup: Lineup = { formation: l.formation, starters: [...l.starters], bench: [...l.bench], tactics: { ...l.tactics } };
  const now = Date.now();
  const metrics = { squad_saved: 1 };
  const completed = await missionsCompletedBy(c.env, user.id, metrics, now);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO user_squads (user_id, slot, name, lineup_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (user_id, slot) DO UPDATE SET name = ?3, lineup_json = ?4, updated_at = ?5`,
    ).bind(user.id, slot, name, JSON.stringify(lineup), now),
    c.env.DB.prepare('INSERT OR IGNORE INTO user_squad_active (user_id, slot, updated_at) VALUES (?, ?, ?)').bind(user.id, slot, now),
    analyticsWhen(c.env, 'squad_saved', user.id, { slot, formation: lineup.formation }, now),
    ...missionProgressStmts(c.env, user.id, metrics, now),
    ...missionCompletedAnalytics(c.env, user.id, completed, now),
  ]);
  return c.json({ ...(await teamState(c.env, user.id)), missionsCompleted: completed });
});

/** the team used in MATCH */
teamRoutes.post('/active', async (c) => {
  const user = c.get('user');
  const body = await readJson<{ slot?: unknown }>(c);
  const slot = slotOf(String(body.slot));
  const exists = await c.env.DB.prepare('SELECT 1 AS x FROM user_squads WHERE user_id = ? AND slot = ?').bind(user.id, slot).first();
  if (!exists) throw new ApiError('NOT_FOUND', 'this team has not been saved yet');
  const now = Date.now();
  await c.env.DB.prepare('INSERT INTO user_squad_active (user_id, slot, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (user_id) DO UPDATE SET slot = ?2, updated_at = ?3')
    .bind(user.id, slot, now)
    .run();
  return c.json(await teamState(c.env, user.id));
});

/** favourite mark of an owned card */
teamRoutes.post('/favorite', async (c) => {
  const user = c.get('user');
  const body = await readJson<{ playerId?: unknown; favorite?: unknown }>(c);
  if (typeof body.playerId !== 'string') throw new ApiError('BAD_REQUEST', 'playerId is required');
  const r = await c.env.DB.prepare('UPDATE user_collections SET favorite = ? WHERE user_id = ? AND player_id = ?')
    .bind(body.favorite === true ? 1 : 0, user.id, body.playerId)
    .run();
  if (r.meta.changes !== 1) throw new ApiError('NOT_FOUND', 'you do not own this card');
  return c.json({ playerId: body.playerId, favorite: body.favorite === true });
});

// ---------------------------------------------------------------- MATCH rooms

export const matchModeRoutes = new Hono<AppEnv>();
matchModeRoutes.use('*', requireUser);

/** test timings only (honoured outside production, see createRoom) */
async function testSettings(c: { req: { json: () => Promise<unknown> } }): Promise<Partial<RoomSettings>> {
  const body = (await c.req.json().catch(() => ({}))) as { settings?: Partial<RoomSettings> };
  return body?.settings ?? {};
}

/** MATCH matchmaking: join an open MATCH room or create one (the host can start with CPU teams) */
matchModeRoutes.post('/quick', async (c) => {
  const user = c.get('user');
  await ensureStarter(c.env, user.id);
  await track(c.env, { name: 'mode_selected', userId: user.id, properties: { mode: 'match' } });
  const joined = await joinOpenRoom(c.env, user, "mode = 'match' AND json_extract(settings_json, '$.privateRoom') IS NULL", []);
  if (joined) return c.json(joined);
  return c.json(await createRoom(c.env, user, 'match', await testSettings(c), { variant: { kind: 'match', private: false } }), 201);
});

/** a MATCH room for friends (joined with its code) */
matchModeRoutes.post('/private', async (c) => {
  const user = c.get('user');
  await ensureStarter(c.env, user.id);
  await track(c.env, { name: 'mode_selected', userId: user.id, properties: { mode: 'match_private' } });
  return c.json(await createRoom(c.env, user, 'match', await testSettings(c), { variant: { kind: 'match', private: true } }), 201);
});
