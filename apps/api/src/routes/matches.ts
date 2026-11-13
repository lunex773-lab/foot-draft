import { Hono } from 'hono';
import { requireUser } from '../lib/auth';
import { ApiError } from '../lib/http';
import type { AppEnv } from '../env';

export const matchRoutes = new Hono<AppEnv>();
matchRoutes.use('*', requireUser);

/** Matches of the current user whose playback has finished. */
matchRoutes.get('/history', async (c) => {
  const u = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT m.id, m.room_id, m.matchday, m.home_seat, m.away_seat, m.home_user_id, m.away_user_id, m.completed_at,
            r.home_goals, r.away_goals, ht.team_name AS home_name, at.team_name AS away_name
       FROM matches m
       JOIN match_results r ON r.match_id = m.id
       JOIN match_teams ht ON ht.match_id = m.id AND ht.side = 'home'
       JOIN match_teams at ON at.match_id = m.id AND at.side = 'away'
      WHERE (m.home_user_id = ? OR m.away_user_id = ?) AND m.status = 'completed'
      ORDER BY m.completed_at DESC LIMIT 100`,
  )
    .bind(u.id, u.id)
    .all();
  return c.json({ items: rows.results });
});

async function loadMatch(c: { env: AppEnv['Bindings']; get: (k: 'user') => { id: string } }, id: string) {
  const m = await c.env.DB.prepare('SELECT * FROM matches WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!m) throw new ApiError('NOT_FOUND', 'match not found');
  if (m.status !== 'completed') {
    // during playback only the room members may see it
    const member = await c.env.DB.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').bind(m.room_id, c.get('user').id).first();
    if (!member) throw new ApiError('FORBIDDEN', 'match is still being played');
  }
  return m;
}

matchRoutes.get('/:id', async (c) => {
  const m = await loadMatch(c, c.req.param('id'));
  const [teams, events, stats, result] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM match_teams WHERE match_id = ?').bind(m.id),
    c.env.DB.prepare('SELECT * FROM match_events WHERE match_id = ?').bind(m.id),
    c.env.DB.prepare('SELECT * FROM match_statistics WHERE match_id = ?').bind(m.id),
    c.env.DB.prepare('SELECT * FROM match_results WHERE match_id = ?').bind(m.id),
  ]);
  const t = teams.results as { side: string; seat: number; user_id: string | null; team_name: string; lineup_json: string; players_json: string; chemistry: number }[];
  const st = stats.results as { side: string; stats_json: string; players_json: string; notes_json: string }[];
  const ev = events.results[0] as { events_json: string; track_json: string } | undefined;
  const side = (s: 'home' | 'away') => {
    const team = t.find((x) => x.side === s)!;
    const stat = st.find((x) => x.side === s)!;
    return {
      seat: team.seat,
      userId: team.user_id,
      name: team.team_name,
      lineup: JSON.parse(team.lineup_json),
      players: JSON.parse(team.players_json),
      chemistry: team.chemistry,
      stats: JSON.parse(stat.stats_json),
      playerStats: JSON.parse(stat.players_json),
      notes: JSON.parse(stat.notes_json),
    };
  };
  return c.json({
    match: m,
    result: result.results[0],
    home: side('home'),
    away: side('away'),
    events: ev ? JSON.parse(ev.events_json) : [],
    track: ev ? JSON.parse(ev.track_json) : [],
  });
});

matchRoutes.get('/:id/result', async (c) => {
  const m = await loadMatch(c, c.req.param('id'));
  const r = await c.env.DB.prepare('SELECT * FROM match_results WHERE match_id = ?').bind(m.id).first();
  return c.json({ matchId: m.id, roomId: m.room_id, matchday: m.matchday, seed: m.seed, simVersion: m.sim_version, ...r });
});
