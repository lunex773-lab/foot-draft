import { analyzePool, dailyChallenge, describeFilter, jstDateKey, jstDayRange } from '@fd/shared';
import { Hono } from 'hono';
import { track } from '../lib/analytics';
import { requireUser } from '../lib/auth';
import { randomId } from '../lib/crypto';
import { ApiError, readJson } from '../lib/http';
import { loadCatalog } from '../lib/players';
import type { AppEnv, Env } from '../env';
import { createRoom } from './rooms';

/**
 * Solo Challenge (spec 2-6, decision 29): one daily challenge (Japan date),
 * you + 3 CPU teams. Any number of attempts; the result of every attempt is
 * recorded (rewards come with the currencies in Phase 4).
 */
export const soloRoutes = new Hono<AppEnv>();
soloRoutes.use('*', requireUser);

async function todayChallenge(env: Env, now = Date.now()) {
  const challenge = dailyChallenge(jstDateKey(now));
  await env.DB.prepare('INSERT OR IGNORE INTO solo_challenges (id, date_key, definition_json, created_at) VALUES (?,?,?,?)')
    .bind(challenge.id, challenge.dateKey, JSON.stringify(challenge), now)
    .run();
  return challenge;
}

soloRoutes.get('/today', async (c) => {
  const user = c.get('user');
  const challenge = await todayChallenge(c.env);
  const attempts = await c.env.DB.prepare(
    'SELECT id, room_id, status, result_json, created_at, finished_at FROM solo_attempts WHERE challenge_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 20',
  )
    .bind(challenge.id, user.id)
    .all<{ id: string; room_id: string; status: string; result_json: string | null; created_at: number; finished_at: number | null }>();
  const catalog = await loadCatalog(c.env);
  const items = attempts.results.map((a) => ({ ...a, result: a.result_json ? JSON.parse(a.result_json) : null, result_json: undefined }));
  return c.json({
    challenge,
    poolConditions: describeFilter(challenge.pool.filter),
    pool: analyzePool(catalog, challenge.pool.filter),
    endsAt: jstDayRange(challenge.dateKey).endsAt,
    cleared: items.some((a) => a.status === 'cleared'),
    attempts: items,
  });
});

/** Start today's challenge (a new room with 3 CPU teams; the draft starts immediately). */
soloRoutes.post('/start', async (c) => {
  const user = c.get('user');
  const body = await readJson<{ settings?: Record<string, unknown> }>(c).catch(() => ({}) as { settings?: Record<string, unknown> });
  const playing = await c.env.DB.prepare(
    `SELECT a.room_id FROM solo_attempts a JOIN rooms r ON r.id = a.room_id
      WHERE a.user_id = ? AND a.status = 'playing' AND r.status IN ('lobby','drafting','lineup','playing') LIMIT 1`,
  )
    .bind(user.id)
    .first<{ room_id: string }>();
  if (playing) throw new ApiError('CONFLICT', 'finish your current challenge first');
  const challenge = await todayChallenge(c.env);
  await track(c.env, { name: 'mode_selected', userId: user.id, properties: { mode: 'solo', challengeId: challenge.id } });
  const room = await createRoom(c.env, user, 'solo', (body.settings ?? {}) as never, { variant: { kind: 'solo', challenge }, challengeId: challenge.id });
  await c.env.DB.prepare("INSERT INTO solo_attempts (id, challenge_id, user_id, room_id, status, created_at) VALUES (?,?,?,?,'playing',?)")
    .bind(randomId(), challenge.id, user.id, room.roomId, Date.now())
    .run();
  return c.json({ ...room, challengeId: challenge.id }, 201);
});

/** Results of the last 14 days. */
soloRoutes.get('/history', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT sc.id AS challenge_id, sc.date_key, sc.definition_json,
            COUNT(a.id) AS attempts, SUM(CASE WHEN a.status = 'cleared' THEN 1 ELSE 0 END) AS cleared
       FROM solo_attempts a JOIN solo_challenges sc ON sc.id = a.challenge_id
      WHERE a.user_id = ?
      GROUP BY sc.id ORDER BY sc.date_key DESC LIMIT 14`,
  )
    .bind(user.id)
    .all<{ challenge_id: string; date_key: string; definition_json: string; attempts: number; cleared: number }>();
  return c.json({
    items: rows.results.map((r) => {
      const d = JSON.parse(r.definition_json) as { titleJa: string; difficulty: number };
      return { challengeId: r.challenge_id, dateKey: r.date_key, title: d.titleJa, difficulty: d.difficulty, attempts: r.attempts, cleared: (r.cleared ?? 0) > 0 };
    }),
  });
});
