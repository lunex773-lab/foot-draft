import { GAME_CONFIG, type RoomSettings } from '@fd/shared';
import { Hono } from 'hono';
import { track } from '../lib/analytics';
import { requireUser } from '../lib/auth';
import { randomId, signTicket, verifyTicket } from '../lib/crypto';
import { ApiError, readJson, str } from '../lib/http';
import { callRoom, randomRoomCode, roomStub } from '../lib/room';
import { sanitizeSettings } from '../room/RoomDO';
import type { AppEnv, AuthUser, Env } from '../env';

export const roomRoutes = new Hono<AppEnv>();

async function createRoom(env: Env, user: AuthUser, mode: 'quick' | 'private', settings: Partial<RoomSettings>) {
  const allowTest = env.ALLOW_TEST_TIMINGS === 'true' && env.ENVIRONMENT !== 'production';
  const clean = sanitizeSettings({ pickSeconds: GAME_CONFIG.pickSeconds, fillWithCpu: true, ...settings }, allowTest);
  const id = randomId();
  let code = '';
  for (let i = 0; i < 5; i++) {
    code = randomRoomCode();
    const r = await env.DB.prepare(
      "INSERT INTO rooms (id, code, mode, status, host_user_id, settings_json, member_count, environment, created_at) VALUES (?,?,?,'lobby',?,?,0,?,?) ON CONFLICT(code) DO NOTHING",
    )
      .bind(id, code, mode, user.id, JSON.stringify(clean), env.ENVIRONMENT, Date.now())
      .run();
    if (r.meta.changes === 1) break;
    code = '';
  }
  if (!code) throw new ApiError('INTERNAL', 'could not allocate a room code');
  await callRoom(env, id, '/init', { roomId: id, code, mode, settings: clean, environment: env.ENVIRONMENT, allowTestTimings: allowTest });
  const joined = await callRoom<{ seat: number }>(env, id, '/join', { userId: user.id, displayName: user.displayName });
  await track(env, { name: 'room_created', userId: user.id, properties: { roomId: id, mode } });
  return { roomId: id, code, seat: joined.seat };
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
  const room = await c.env.DB.prepare('SELECT id FROM rooms WHERE code = ?').bind(code).first<{ id: string }>();
  if (!room) throw new ApiError('NOT_FOUND', 'room not found');
  const user = c.get('user');
  const joined = await callRoom<{ seat: number }>(c.env, room.id, '/join', { userId: user.id, displayName: user.displayName });
  return c.json({ roomId: room.id, code, seat: joined.seat });
});

/** Quick Draft matchmaking (spec 2-1): join an open public room or create one. */
roomRoutes.post('/quick', async (c) => {
  const user = c.get('user');
  await track(c.env, { name: 'mode_selected', userId: user.id, properties: { mode: 'quick' } });
  const open = await c.env.DB.prepare(
    "SELECT id, code FROM rooms WHERE mode = 'quick' AND status = 'lobby' AND member_count < 4 AND created_at > ? AND environment = ? ORDER BY created_at ASC LIMIT 5",
  )
    .bind(Date.now() - 10 * 60 * 1000, c.env.ENVIRONMENT)
    .all<{ id: string; code: string }>();
  for (const r of open.results) {
    try {
      const joined = await callRoom<{ seat: number }>(c.env, r.id, '/join', { userId: user.id, displayName: user.displayName });
      return c.json({ roomId: r.id, code: r.code, seat: joined.seat });
    } catch {
      // full or already started -> try next
    }
  }
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
