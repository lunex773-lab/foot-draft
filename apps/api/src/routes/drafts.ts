import { Hono } from 'hono';
import { requireUser } from '../lib/auth';
import { ApiError, readJson, str } from '../lib/http';
import { callRoom } from '../lib/room';
import type { AppEnv, Env } from '../env';

export const draftRoutes = new Hono<AppEnv>();
draftRoutes.use('*', requireUser);

async function roomOfDraft(env: Env, draftId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT room_id FROM drafts WHERE id = ?').bind(draftId).first<{ room_id: string }>();
  if (!row) throw new ApiError('NOT_FOUND', 'draft not found');
  return row.room_id;
}

/** HTTP alternative to the WebSocket pick message (spec 18-2). */
draftRoutes.post('/:id/pick', async (c) => {
  const body = await readJson(c);
  const playerId = str(body.playerId, 'playerId', { max: 20 });
  const roomId = await roomOfDraft(c.env, c.req.param('id'));
  await callRoom(c.env, roomId, '/pick', { userId: c.get('user').id, playerId });
  return c.json({ ok: true });
});

draftRoutes.get('/:id/state', async (c) => {
  const roomId = await roomOfDraft(c.env, c.req.param('id'));
  const data = await callRoom<{ state: { draft: unknown; you: number | null } }>(c.env, roomId, '/state', undefined, { userId: c.get('user').id });
  if (data.state.you === null) throw new ApiError('FORBIDDEN', 'not a member of this room');
  return c.json(data.state.draft);
});
