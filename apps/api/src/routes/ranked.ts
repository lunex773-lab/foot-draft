import { RANKED_CONFIG, tierOf } from '@fd/shared';
import { Hono } from 'hono';
import { track } from '../lib/analytics';
import { requireUser } from '../lib/auth';
import { readJson } from '../lib/http';
import { ensureCurrentSeason, leaderboard, positionOf, ratingOf, seasonView } from '../lib/seasons';
import type { AppEnv } from '../env';
import { createRoom, joinOpenRoom } from './rooms';

/**
 * Ranked (spec 2-2, Phase 3). Matchmaking into 4-player ranked rooms: a room
 * starts when 4 humans are in, or after 60 s with CPU in the empty seats
 * (decision 26). Ratings change only between humans (RoomDO.applyRanked).
 */
export const rankedRoutes = new Hono<AppEnv>();
rankedRoutes.use('*', requireUser);

/** Join the ranked queue (or get back to the ranked room you are in). */
rankedRoutes.post('/queue', async (c) => {
  const user = c.get('user');
  const body = await readJson<{ settings?: Record<string, unknown> }>(c).catch(() => ({}) as { settings?: Record<string, unknown> });
  await ensureCurrentSeason(c.env);
  const active = await c.env.DB.prepare(
    `SELECT r.id, r.code, rm.seat FROM room_members rm JOIN rooms r ON r.id = rm.room_id
      WHERE rm.user_id = ? AND r.mode = 'ranked' AND r.status IN ('lobby','drafting','lineup','playing') AND r.environment = ?
      ORDER BY r.created_at DESC LIMIT 1`,
  )
    .bind(user.id, c.env.ENVIRONMENT)
    .first<{ id: string; code: string; seat: number }>();
  // one ranked league at a time per player (keeps rating updates in order)
  if (active) return c.json({ roomId: active.id, code: active.code, seat: active.seat, rejoined: true });
  await track(c.env, { name: 'mode_selected', userId: user.id, properties: { mode: 'ranked' } });
  const joined = await joinOpenRoom(c.env, user, "mode = 'ranked'", []);
  if (joined) return c.json(joined);
  return c.json(await createRoom(c.env, user, 'ranked', (body.settings ?? {}) as never, { variant: { kind: 'ranked' } }), 201);
});

/** My rating, tier and position in the current season. */
rankedRoutes.get('/me', async (c) => {
  const user = c.get('user');
  const season = await ensureCurrentSeason(c.env);
  const r = await ratingOf(c.env, season.id, user.id);
  const pos = await positionOf(c.env, season.id, user.id);
  const recent = await c.env.DB.prepare(
    `SELECT room_id, season_id, final_rank, humans, rated, rating_before, rating_after, delta, created_at
       FROM rating_changes WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(user.id)
    .all();
  const tier = tierOf(r.rating);
  return c.json({
    season: seasonView(season.id),
    rating: r.rating,
    peak: r.peak,
    games: r.games,
    wins: r.wins,
    tier: tier.id,
    position: pos.position,
    players: pos.players,
    queueSeconds: RANKED_CONFIG.queueSeconds,
    recent: recent.results,
  });
});

/** Season leaderboard (top 100). ?season=YYYY-MM (default: current) */
rankedRoutes.get('/leaderboard', async (c) => {
  const current = await ensureCurrentSeason(c.env);
  const seasonId = /^\d{4}-\d{2}$/.test(c.req.query('season') ?? '') ? c.req.query('season')! : current.id;
  const user = c.get('user');
  return c.json({ season: seasonView(seasonId), items: await leaderboard(c.env, seasonId), me: await positionOf(c.env, seasonId, user.id) });
});

/** Seasons (newest first) with my final result. */
rankedRoutes.get('/seasons', async (c) => {
  await ensureCurrentSeason(c.env);
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.starts_at, s.ends_at, s.status, sr.final_rating, sr.final_position, sr.games
       FROM seasons s LEFT JOIN season_results sr ON sr.season_id = s.id AND sr.user_id = ?
      ORDER BY s.id DESC LIMIT 24`,
  )
    .bind(user.id)
    .all();
  return c.json({ items: rows.results });
});
