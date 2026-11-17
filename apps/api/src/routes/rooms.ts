import { GAME_CONFIG, pickSecondsFor, TIMER_EXPERIMENT_MODES, type RoomMode, type RoomSettings, type RoomVariant } from '@fd/shared';
import { Hono } from 'hono';
import { track } from '../lib/analytics';
import { draftTimerSetting } from '../lib/settings';
import { requireUser } from '../lib/auth';
import { randomId, signTicket, verifyTicket } from '../lib/crypto';
import { ApiError, readJson, str } from '../lib/http';
import { callRoom, randomRoomCode, roomStub } from '../lib/room';
import { sanitizeSettings } from '../room/RoomDO';
import { ensureStarter } from '../lib/team';
import type { AppEnv, AuthUser, Env } from '../env';

export const roomRoutes = new Hono<AppEnv>();

export interface CreateRoomOptions {
  variant?: RoomVariant;
  eventId?: string | null;
  challengeId?: string | null;
}

/** Creates a room (D1 row + RoomDO) and seats the creator. */
export async function createRoom(env: Env, user: AuthUser, mode: RoomMode, settings: Partial<RoomSettings>, opts: CreateRoomOptions = {}) {
  const allowTest = env.ALLOW_TEST_TIMINGS === 'true' && env.ENVIRONMENT !== 'production';
  // only quick / private rooms take player settings; ranked / solo / event rooms use fixed
  // rules (CPU fill, default pick time) except for test timings in non-production environments
  const custom = mode === 'quick' || mode === 'private';
  const input = custom ? settings : allowTest ? { ...settings, fillWithCpu: true } : {};
  const id = randomId();
  // decision 66: quick / ranked / collection rooms take part in the pick time comparison
  // (a pick time given for tests in non-production environments wins)
  const timed = (TIMER_EXPERIMENT_MODES as readonly string[]).includes(mode) && input.pickSeconds === undefined;
  const pickSeconds = timed ? pickSecondsFor(id, await draftTimerSetting(env)) : GAME_CONFIG.pickSeconds;
  const clean = sanitizeSettings({ pickSeconds, fillWithCpu: true, ...input }, allowTest);
  // a MATCH room for friends is never offered by matchmaking
  if (opts.variant?.kind === 'match' && opts.variant.private) clean.privateRoom = true;
  let code = '';
  for (let i = 0; i < 5; i++) {
    code = randomRoomCode();
    const r = await env.DB.prepare(
      "INSERT INTO rooms (id, code, mode, status, host_user_id, settings_json, member_count, environment, created_at, event_id, challenge_id) VALUES (?,?,?,'lobby',?,?,0,?,?,?,?) ON CONFLICT(code) DO NOTHING",
    )
      .bind(id, code, mode, user.id, JSON.stringify(clean), env.ENVIRONMENT, Date.now(), opts.eventId ?? null, opts.challengeId ?? null)
      .run();
    if (r.meta.changes === 1) break;
    code = '';
  }
  if (!code) throw new ApiError('INTERNAL', 'could not allocate a room code');
  await callRoom(env, id, '/init', { roomId: id, code, mode, settings: clean, environment: env.ENVIRONMENT, allowTestTimings: allowTest, variant: opts.variant ?? { kind: 'standard' } });
  const joined = await callRoom<{ seat: number }>(env, id, '/join', { userId: user.id, displayName: user.displayName });
  await track(env, { name: 'room_created', userId: user.id, properties: { roomId: id, mode, pickSeconds: clean.pickSeconds, eventId: opts.eventId ?? undefined, challengeId: opts.challengeId ?? undefined } });
  return { roomId: id, code, seat: joined.seat };
}

/**
 * Matchmaking: joins the oldest open room matching the query (lobby, not full,
 * created in the last 10 minutes) or returns null.
 */
export async function joinOpenRoom(env: Env, user: AuthUser, where: string, binds: unknown[]): Promise<{ roomId: string; code: string; seat: number } | null> {
  const open = await env.DB.prepare(
    `SELECT id, code FROM rooms WHERE ${where} AND status = 'lobby' AND member_count < 4 AND created_at > ? AND environment = ? ORDER BY created_at ASC LIMIT 5`,
  )
    .bind(...binds, Date.now() - 10 * 60 * 1000, env.ENVIRONMENT)
    .all<{ id: string; code: string }>();
  for (const r of open.results) {
    try {
      const joined = await callRoom<{ seat: number }>(env, r.id, '/join', { userId: user.id, displayName: user.displayName });
      return { roomId: r.id, code: r.code, seat: joined.seat };
    } catch {
      // full or already started -> try next
    }
  }
  return null;
}

roomRoutes.use('*', async (c, next) => {
  // the websocket endpoint authenticates with a ticket instead of a bearer token
  if (c.req.path.endsWith('/ws')) return next();
  return requireUser(c, next);
});

/** Create a private room (spec 2-3). */
roomRoutes.post('/', async (c) => {
  const body = await readJson<{ settings?: Partial<RoomSettings> }>(c);
  const user = c.get('user');
  await track(c.env, { name: 'mode_selected', userId: user.id, properties: { mode: 'private' } });
  return c.json(await createRoom(c.env, user, 'private', body.settings ?? {}), 201);
});

/** Join by invite code. */
roomRoutes.post('/join', async (c) => {
  const body = await readJson(c);
  const code = str(body.code, 'code', { min: 6, max: 6 }).toUpperCase();
  const room = await c.env.DB.prepare('SELECT id, mode FROM rooms WHERE code = ?').bind(code).first<{ id: string; mode: RoomMode }>();
  if (!room) throw new ApiError('NOT_FOUND', 'room not found');
  // ranked / solo / event rooms are only joined through their own matchmaking
  if (room.mode !== 'quick' && room.mode !== 'private' && room.mode !== 'match') throw new ApiError('ROOM_NOT_JOINABLE', 'this room cannot be joined with a code');
  // MATCH: the first 11 cards make sure everybody has a team
  if (room.mode === 'match') await ensureStarter(c.env, c.get('user').id);
  const user = c.get('user');
  const joined = await callRoom<{ seat: number }>(c.env, room.id, '/join', { userId: user.id, displayName: user.displayName });
  return c.json({ roomId: room.id, code, seat: joined.seat });
});

/** Quick Draft matchmaking (spec 2-1): join an open public room or create one. */
roomRoutes.post('/quick', async (c) => {
  const user = c.get('user');
  await track(c.env, { name: 'mode_selected', userId: user.id, properties: { mode: 'quick' } });
  const joined = await joinOpenRoom(c.env, user, "mode = 'quick'", []);
  if (joined) return c.json(joined);
  return c.json(await createRoom(c.env, user, 'quick', {}), 201);
});

roomRoutes.get('/:id', async (c) => {
  const data = await callRoom<{ state: unknown }>(c.env, c.req.param('id'), '/state', undefined, { userId: c.get('user').id });
  return c.json(data.state);
});

roomRoutes.post('/:id/start', async (c) => {
  await callRoom(c.env, c.req.param('id'), '/start', { userId: c.get('user').id });
  return c.json({ ok: true });
});

roomRoutes.post('/:id/leave', async (c) => {
  return c.json(await callRoom(c.env, c.req.param('id'), '/leave', { userId: c.get('user').id }));
});

roomRoutes.post('/:id/lineup', async (c) => {
  const body = await readJson(c);
  await callRoom(c.env, c.req.param('id'), '/lineup', { userId: c.get('user').id, lineup: body.lineup, ready: body.ready === true });
  return c.json({ ok: true });
});

/** Short-lived ticket for the WebSocket connection. */
roomRoutes.post('/:id/ticket', async (c) => {
  const roomId = c.req.param('id');
  const user = c.get('user');
  const member = await c.env.DB.prepare('SELECT seat FROM room_members WHERE room_id = ? AND user_id = ?').bind(roomId, user.id).first();
  if (!member) throw new ApiError('FORBIDDEN', 'not a member of this room');
  const ticket = await signTicket(c.env.WS_TICKET_SECRET, { u: user.id, r: roomId, e: Date.now() + 60_000 });
  return c.json({ ticket });
});

roomRoutes.get('/:id/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') throw new ApiError('BAD_REQUEST', 'expected websocket upgrade', 426);
  const roomId = c.req.param('id');
  const t = await verifyTicket(c.env.WS_TICKET_SECRET, c.req.query('ticket') ?? '');
  if (!t || t.r !== roomId) throw new ApiError('UNAUTHORIZED', 'invalid ticket');
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-User-Id', t.u);
  return roomStub(c.env, roomId).fetch(new Request('https://room/ws', { headers }));
});
