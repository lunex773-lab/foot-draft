import { analyzePool, describeFilter, sanitizeFilter, type PoolFilter } from '@fd/shared';
import { Hono } from 'hono';
import { track } from '../lib/analytics';
import { requireUser } from '../lib/auth';
import { ApiError, readJson } from '../lib/http';
import { loadCatalog } from '../lib/players';
import type { AppEnv, Env } from '../env';
import { createRoom, joinOpenRoom } from './rooms';

/**
 * Special Events (spec 2-5, decision 28). Events are created and published in
 * the admin site. A published event can be played between its start and end:
 * 4-player rooms like Quick Draft (CPU fill), with the event's draft pool.
 */
export const eventRoutes = new Hono<AppEnv>();
eventRoutes.use('*', requireUser);

export interface EventRow {
  id: string;
  name: string;
  description: string;
  starts_at: number;
  ends_at: number;
  status: 'draft' | 'published' | 'archived';
  rules_json: string;
  created_at: number;
  updated_at: number;
  published_at: number | null;
  archived_at: number | null;
}

export function eventFilter(row: EventRow): PoolFilter {
  try {
    return sanitizeFilter((JSON.parse(row.rules_json) as { pool?: unknown }).pool);
  } catch {
    return {};
  }
}

export async function eventView(env: Env, row: EventRow, now = Date.now()) {
  const filter = eventFilter(row);
  const catalog = await loadCatalog(env);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    open: row.status === 'published' && row.starts_at <= now && now < row.ends_at,
    filter,
    conditions: describeFilter(filter),
    pool: analyzePool(catalog, filter),
  };
}

async function myResults(env: Env, eventId: string, userId: string) {
  return env.DB.prepare(
    `SELECT COUNT(*) AS played, MIN(rm.final_rank) AS best_rank, SUM(CASE WHEN rm.final_rank = 1 THEN 1 ELSE 0 END) AS wins
       FROM room_members rm JOIN rooms r ON r.id = rm.room_id
      WHERE r.event_id = ? AND rm.user_id = ? AND r.status = 'finished'`,
  )
    .bind(eventId, userId)
    .first<{ played: number; best_rank: number | null; wins: number | null }>();
}

/** Published events that are running or upcoming. */
eventRoutes.get('/', async (c) => {
  const now = Date.now();
  const rows = await c.env.DB.prepare("SELECT * FROM events WHERE status = 'published' AND ends_at > ? ORDER BY starts_at ASC LIMIT 20").bind(now).all<EventRow>();
  const user = c.get('user');
  const items = [];
  for (const r of rows.results) {
    const mine = await myResults(c.env, r.id, user.id);
    items.push({ ...(await eventView(c.env, r, now)), my: { played: mine?.played ?? 0, bestRank: mine?.best_rank ?? null, wins: mine?.wins ?? 0 } });
  }
  return c.json({ items });
});

eventRoutes.get('/:id', async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM events WHERE id = ? AND status IN ('published','archived')").bind(c.req.param('id')).first<EventRow>();
  if (!row) throw new ApiError('NOT_FOUND', 'event not found');
  const user = c.get('user');
  const mine = await myResults(c.env, row.id, user.id);
  const recent = await c.env.DB.prepare(
    `SELECT r.id AS room_id, r.status, r.created_at, rm.final_rank, rm.points
       FROM room_members rm JOIN rooms r ON r.id = rm.room_id
      WHERE r.event_id = ? AND rm.user_id = ? ORDER BY r.created_at DESC LIMIT 10`,
  )
    .bind(row.id, user.id)
    .all();
  return c.json({ event: await eventView(c.env, row), my: { played: mine?.played ?? 0, bestRank: mine?.best_rank ?? null, wins: mine?.wins ?? 0 }, recent: recent.results });
});

/** Matchmaking into the event (only while it is open). */
eventRoutes.post('/:id/join', async (c) => {
  const now = Date.now();
  const row = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(c.req.param('id')).first<EventRow>();
  if (!row || row.status === 'draft') throw new ApiError('NOT_FOUND', 'event not found');
  if (row.status !== 'published' || now < row.starts_at || now >= row.ends_at) throw new ApiError('EVENT_CLOSED', 'the event is not open', 409);
  const user = c.get('user');
  const body = await readJson<{ settings?: Record<string, unknown> }>(c).catch(() => ({}) as { settings?: Record<string, unknown> });
  await track(c.env, { name: 'mode_selected', userId: user.id, properties: { mode: 'event', eventId: row.id } });
  const joined = await joinOpenRoom(c.env, user, "mode = 'event' AND event_id = ?", [row.id]);
  if (joined) return c.json(joined);
  const variant = { kind: 'event' as const, eventId: row.id, name: row.name, description: row.description, filter: eventFilter(row), endsAt: row.ends_at };
  // settings are ignored except test timings in non-production environments (createRoom)
  return c.json(await createRoom(c.env, user, 'event', (body.settings ?? {}) as never, { variant, eventId: row.id }), 201);
});
