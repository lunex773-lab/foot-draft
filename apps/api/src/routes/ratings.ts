import { jstDateKey } from '@fd/shared';
import { Hono } from 'hono';
import { track } from '../lib/analytics';
import { requireUser } from '../lib/auth';
import { randomId } from '../lib/crypto';
import { ApiError, readJson } from '../lib/http';
import type { AppEnv, Env } from '../env';

/**
 * Optional rating after a league (decision 65): "was the draft fun?" and
 * "was the result fair?" on a 1-5 scale, at most once per Japan day. The mode,
 * pick time, formation and final rank are taken from the server records, not
 * from the game.
 */
export const ratingRoutes = new Hono<AppEnv>();
ratingRoutes.use('*', requireUser);

async function ratedToday(env: Env, userId: string, now: number) {
  return !!(await env.DB.prepare('SELECT 1 FROM league_ratings WHERE user_id = ? AND day_key = ?').bind(userId, jstDateKey(now)).first());
}

/** whether the game should offer the rating today */
ratingRoutes.get('/today', async (c) => c.json({ rated: await ratedToday(c.env, c.get('user').id, Date.now()) }));

ratingRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await readJson<{ roomId?: unknown; draftFun?: unknown; resultFair?: unknown }>(c);
  const score = (v: unknown, name: string) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) throw new ApiError('BAD_REQUEST', `${name} must be 1-5`);
    return v;
  };
  const draftFun = score(body.draftFun, 'draftFun');
  const resultFair = score(body.resultFair, 'resultFair');
  if (typeof body.roomId !== 'string' || body.roomId.length > 64) throw new ApiError('BAD_REQUEST', 'roomId is required');
  const member = await c.env.DB.prepare(
    `SELECT r.mode, r.status, m.seat, m.final_rank,
            (SELECT pick_seconds FROM legacy_drafts WHERE room_id = r.id ORDER BY started_at DESC LIMIT 1) AS pick_seconds
       FROM rooms r JOIN room_members m ON m.room_id = r.id WHERE r.id = ? AND m.user_id = ?`,
  )
    .bind(body.roomId, user.id)
    .first<{ mode: string; status: string; seat: number; final_rank: number | null; pick_seconds: number | null }>();
  if (!member) throw new ApiError('NOT_FOUND', 'league not found');
  if (member.status !== 'finished' || member.final_rank === null) throw new ApiError('CONFLICT', 'the league has not finished');
  const team = await c.env.DB.prepare(
    `SELECT json_extract(t.lineup_json, '$.formation') AS formation FROM match_teams t JOIN matches m ON m.id = t.match_id
      WHERE m.room_id = ? AND t.seat = ? ORDER BY m.matchday DESC LIMIT 1`,
  )
    .bind(body.roomId, member.seat)
    .first<{ formation: string | null }>();
  const now = Date.now();
  const id = randomId();
  const r = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO league_ratings (id, user_id, room_id, day_key, mode, pick_seconds, formation, final_rank, draft_fun, result_fair, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(id, user.id, body.roomId, jstDateKey(now), member.mode, member.pick_seconds, team?.formation ?? null, member.final_rank, draftFun, resultFair, now)
    .run();
  if (r.meta.changes !== 1) throw new ApiError('ALREADY_RATED', 'already rated today', 409);
  await track(c.env, { name: 'league_rated', userId: user.id, properties: { roomId: body.roomId, mode: member.mode, pickSeconds: member.pick_seconds ?? undefined, draftFun, resultFair } });
  return c.json({ ok: true }, 201);
});
