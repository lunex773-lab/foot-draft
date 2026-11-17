import { DRAFT_MATCH_CONFIG, RANKED_CONFIG, tierOf, type RoomSettings } from '@fd/shared';
import { Hono } from 'hono';
import { track } from '../lib/analytics';
import { requireUser } from '../lib/auth';
import { randomId, signTicket, verifyTicket } from '../lib/crypto';
import { ApiError } from '../lib/http';
import { callDraftMatch, draftMatchStub, randomRoomCode } from '../lib/room';
import { ensureCurrentSeason, leaderboard, positionOf, ratingOf, seasonView } from '../lib/seasons';
import type { AppEnv, AuthUser, Env } from '../env';

/**
 * DRAFT MATCH (official spec v2.0, decisions 75-85): matchmaking only (no
 * private rooms, no CPU), the room itself is a DraftMatchDO.
 */
export const draftMatchRoutes = new Hono<AppEnv>();

draftMatchRoutes.use('*', async (c, next) => {
  // the websocket endpoint authenticates with a ticket instead of a bearer token
  if (c.req.path.endsWith('/ws')) return next();
  return requireUser(c, next);
});

const OPEN = "('WAITING', 'MATCHING')";
const ACTIVE = "('WAITING', 'MATCHING', 'FORMATION_SELECTION', 'POOL_GENERATION', 'CHINCHIRO', 'DRAFT_ORDER', 'PLAYER_DRAFT', 'TEAM_CONFIRMATION', 'SIMULATION', 'RESULT')";

/** test-only settings (non-production): timings and a tag so that tests are matched only with each other */
function testSettings(env: Env, body: unknown): { allow: boolean; settings: Record<string, unknown>; tag: string | null } {
  const allow = env.ALLOW_TEST_TIMINGS === 'true' && env.ENVIRONMENT !== 'production';
  const s = (body as { settings?: Record<string, unknown> } | null)?.settings ?? {};
  const tag = allow && typeof s.queueTag === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(s.queueTag) ? s.queueTag : null;
  return { allow, settings: allow ? s : {}, tag };
}

async function createDraftRoom(env: Env, user: AuthUser, settings: Record<string, unknown>, allowTest: boolean, tag: string | null) {
  const id = randomId();
  const now = Date.now();
  const seed = randomId(16);
  // the room is listed in rooms too (history, matches, admin) with mode 'draft_match'
  const roomSettings: RoomSettings & { queueTag?: string } = { pickSeconds: DRAFT_MATCH_CONFIG.pickSeconds, fillWithCpu: false, ...(tag ? { queueTag: tag } : {}) };
  let code = '';
  for (let i = 0; i < 5 && !code; i++) {
    const candidate = randomRoomCode();
    const r = await env.DB.prepare(
      "INSERT INTO rooms (id, code, mode, status, host_user_id, settings_json, member_count, environment, created_at) VALUES (?,?,'draft_match','lobby',NULL,?,0,?,?) ON CONFLICT(code) DO NOTHING",
    )
      .bind(id, candidate, JSON.stringify(roomSettings), env.ENVIRONMENT, now)
      .run();
    if (r.meta.changes === 1) code = candidate;
  }
  if (!code) throw new ApiError('INTERNAL', 'could not allocate a room');
  await env.DB.prepare("INSERT INTO draft_rooms (id, status, players, seed, pick_seconds, environment, history_json, created_at) VALUES (?, 'WAITING', 0, ?, ?, ?, ?, ?)")
    .bind(id, seed, DRAFT_MATCH_CONFIG.pickSeconds, env.ENVIRONMENT, JSON.stringify([{ status: 'WAITING', at: now }]), now)
    .run();
  await callDraftMatch(env, id, '/init', { roomId: id, seed, environment: env.ENVIRONMENT, allowTestTimings: allowTest, settings });
  const joined = await callDraftMatch<{ seat: number }>(env, id, '/join', { userId: user.id, displayName: user.displayName });
  await track(env, { name: 'room_created', userId: user.id, properties: { roomId: id, mode: 'draft_match' } });
  return { roomId: id, seat: joined.seat };
}

/** DRAFT MATCH matchmaking: the player's own unfinished room, an open room, or a new one */
draftMatchRoutes.post('/queue', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const { allow, settings, tag } = testSettings(c.env, body);
  const mine = await c.env.DB.prepare(`SELECT p.room_id FROM draft_participants p JOIN draft_rooms d ON d.id = p.room_id WHERE p.user_id = ? AND d.status IN ${ACTIVE} AND p.left_at IS NULL ORDER BY p.joined_at DESC LIMIT 1`)
    .bind(user.id)
    .first<{ room_id: string }>();
  if (mine) return c.json({ roomId: mine.room_id, rejoined: true });
  await track(c.env, { name: 'mode_selected', userId: user.id, properties: { mode: 'draft_match' } });
  const open = await c.env.DB.prepare(
    `SELECT d.id FROM draft_rooms d JOIN rooms r ON r.id = d.id
      WHERE d.status IN ${OPEN} AND d.players < ? AND d.created_at > ? AND d.environment = ?
        AND json_extract(r.settings_json, '$.queueTag') IS ?
      ORDER BY d.created_at ASC LIMIT 5`,
  )
    .bind(DRAFT_MATCH_CONFIG.maxPlayers, Date.now() - 10 * 60_000, c.env.ENVIRONMENT, tag)
    .all<{ id: string }>();
  for (const r of open.results) {
    try {
      const joined = await callDraftMatch<{ seat: number }>(c.env, r.id, '/join', { userId: user.id, displayName: user.displayName });
      return c.json({ roomId: r.id, seat: joined.seat });
    } catch {
      // full or already started -> next
    }
  }
  return c.json(await createDraftRoom(c.env, user, settings, allow, tag), 201);
});

/** the current season's DRAFT MATCH ranking (decision 77) */
draftMatchRoutes.get('/ranking', async (c) => {
  const user = c.get('user');
  const season = await ensureCurrentSeason(c.env);
  const id = /^\d{4}-\d{2}$/.test(c.req.query('season') ?? '') ? c.req.query('season')! : season.id;
  return c.json({
    season: seasonView(id),
    items: await leaderboard(c.env, id, RANKED_CONFIG.leaderboardSize, 'draft_rankings'),
    me: await positionOf(c.env, id, user.id, 'draft_rankings'),
  });
});

/** the player's DRAFT MATCH rating this season */
draftMatchRoutes.get('/me', async (c) => {
  const user = c.get('user');
  const season = await ensureCurrentSeason(c.env);
  const r = await ratingOf(c.env, season.id, user.id, 'draft_rankings');
  const pos = await positionOf(c.env, season.id, user.id, 'draft_rankings');
  const recent = await c.env.DB.prepare(
    `SELECT p.room_id, p.final_rank, p.rating_delta, d.players, d.completed_at FROM draft_participants p JOIN draft_rooms d ON d.id = p.room_id
      WHERE p.user_id = ? AND d.status = 'COMPLETED' ORDER BY d.completed_at DESC LIMIT 10`,
  )
    .bind(user.id)
    .all();
  const active = await c.env.DB.prepare(`SELECT p.room_id FROM draft_participants p JOIN draft_rooms d ON d.id = p.room_id WHERE p.user_id = ? AND d.status IN ${ACTIVE} AND p.left_at IS NULL LIMIT 1`)
    .bind(user.id)
    .first<{ room_id: string }>();
  return c.json({ season: seasonView(season.id), rating: r.rating, tier: tierOf(r.rating).id, games: r.games, wins: r.wins, peak: r.peak, position: pos.position, players: pos.players, recent: recent.results, activeRoomId: active?.room_id ?? null });
});

draftMatchRoutes.get('/:id', async (c) => {
  const data = await callDraftMatch<{ state: unknown }>(c.env, c.req.param('id'), '/state', undefined, { userId: c.get('user').id });
  return c.json(data.state);
});

draftMatchRoutes.post('/:id/leave', async (c) => {
  return c.json(await callDraftMatch(c.env, c.req.param('id'), '/leave', { userId: c.get('user').id }));
});

/** actions over HTTP too (the game uses the WebSocket; tests use both) */
draftMatchRoutes.post('/:id/action', async (c) => {
  const body = await c.req.json().catch(() => null);
  return c.json(await callDraftMatch(c.env, c.req.param('id'), '/action', { userId: c.get('user').id, message: body }));
});

draftMatchRoutes.post('/:id/ticket', async (c) => {
  const roomId = c.req.param('id');
  const user = c.get('user');
  const member = await c.env.DB.prepare('SELECT seat FROM draft_participants WHERE room_id = ? AND user_id = ?').bind(roomId, user.id).first();
  if (!member) throw new ApiError('FORBIDDEN', 'not a member of this room');
  return c.json({ ticket: await signTicket(c.env.WS_TICKET_SECRET, { u: user.id, r: roomId, e: Date.now() + 60_000 }) });
});

draftMatchRoutes.get('/:id/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') throw new ApiError('BAD_REQUEST', 'expected websocket upgrade', 426);
  const roomId = c.req.param('id');
  const t = await verifyTicket(c.env.WS_TICKET_SECRET, c.req.query('ticket') ?? '');
  if (!t || t.r !== roomId) throw new ApiError('UNAUTHORIZED', 'invalid ticket');
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-User-Id', t.u);
  return draftMatchStub(c.env, roomId).fetch(new Request('https://draft-match/ws', { headers }));
});
