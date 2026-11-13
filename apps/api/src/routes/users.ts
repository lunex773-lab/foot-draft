import { Hono } from 'hono';
import { requireUser } from '../lib/auth';
import { readJson, str } from '../lib/http';
import type { AppEnv } from '../env';

export const userRoutes = new Hono<AppEnv>();
userRoutes.use('*', requireUser);

userRoutes.get('/me', async (c) => {
  const u = c.get('user');
  const stats = await c.env.DB.prepare(
    `SELECT COUNT(*) AS played,
            SUM(CASE WHEN final_rank = 1 THEN 1 ELSE 0 END) AS wins
       FROM room_members rm JOIN rooms r ON r.id = rm.room_id
      WHERE rm.user_id = ? AND r.status = 'finished'`,
  )
    .bind(u.id)
    .first<{ played: number; wins: number | null }>();
  return c.json({ user: { id: u.id, username: u.username, displayName: u.displayName }, stats: { leaguesPlayed: stats?.played ?? 0, leaguesWon: stats?.wins ?? 0 } });
});

userRoutes.patch('/me', async (c) => {
  const body = await readJson(c);
  const displayName = str(body.displayName, 'displayName', { min: 1, max: 24 });
  const u = c.get('user');
  await c.env.DB.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').bind(displayName, Date.now(), u.id).run();
  return c.json({ user: { id: u.id, username: u.username, displayName } });
});

/** League history of the current user. */
userRoutes.get('/me/history', async (c) => {
  const u = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT r.id AS room_id, r.code, r.mode, r.status, r.created_at, r.finished_at, rm.seat, rm.final_rank, rm.points, rm.goals_for, rm.goals_against
       FROM room_members rm JOIN rooms r ON r.id = rm.room_id
      WHERE rm.user_id = ? AND r.status IN ('finished','drafting','lineup','playing')
      ORDER BY r.created_at DESC LIMIT 50`,
  )
    .bind(u.id)
    .all();
  return c.json({ items: rows.results });
});
