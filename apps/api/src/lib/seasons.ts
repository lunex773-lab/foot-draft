import { RANKED_CONFIG, carryOverRating, seasonAt, seasonById, tierOf, type SeasonInfo } from '@fd/shared';
import type { Env } from '../env';
import { grantSeasonRewards } from './rewards';

/**
 * Monthly Ranked seasons (Japan time, decision 27). Seasons are created and
 * finished lazily: whenever ranked data is read or written, finished seasons
 * are closed (final standings recorded in season_results) and the current
 * season row is created.
 */
export async function ensureCurrentSeason(env: Env, now = Date.now()): Promise<SeasonInfo> {
  const cur = seasonAt(now);
  const stale = await env.DB.prepare("SELECT id FROM seasons WHERE status = 'active' AND ends_at <= ?").bind(now).all<{ id: string }>();
  for (const s of stale.results) await finalizeSeason(env, s.id, now);
  await env.DB.prepare("INSERT OR IGNORE INTO seasons (id, name, starts_at, ends_at, status, created_at) VALUES (?,?,?,?,'active',?)")
    .bind(cur.id, cur.nameJa, cur.startsAt, cur.endsAt, now)
    .run();
  return cur;
}

/** records the final standings of a season and pays the season rewards (idempotent) */
export async function finalizeSeason(env: Env, seasonId: string, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO season_results (season_id, user_id, final_rating, final_position, games, wins, created_at)
       SELECT season_id, user_id, rating, RANK() OVER (ORDER BY rating DESC), games, wins, ?
         FROM ranked_ratings WHERE season_id = ? AND games > 0`,
    ).bind(now, seasonId),
    env.DB.prepare("UPDATE seasons SET status = 'finished', finalized_at = ? WHERE id = ? AND status = 'active'").bind(now, seasonId),
  ]);
  // Phase 4: FREE GEMS by final position (decision 40)
  await grantSeasonRewards(env, seasonId, now);
}

/** current rating of a player in a season (a new season starts from the carried-over rating) */
export async function ratingOf(env: Env, seasonId: string, userId: string): Promise<{ rating: number; games: number; wins: number; peak: number; exists: boolean }> {
  const row = await env.DB.prepare('SELECT rating, games, wins, peak_rating FROM ranked_ratings WHERE season_id = ? AND user_id = ?')
    .bind(seasonId, userId)
    .first<{ rating: number; games: number; wins: number; peak_rating: number }>();
  if (row) return { rating: row.rating, games: row.games, wins: row.wins, peak: row.peak_rating, exists: true };
  const prev = await env.DB.prepare('SELECT rating FROM ranked_ratings WHERE user_id = ? AND season_id < ? AND games > 0 ORDER BY season_id DESC LIMIT 1')
    .bind(userId, seasonId)
    .first<{ rating: number }>();
  const start = carryOverRating(prev?.rating);
  return { rating: start, games: 0, wins: 0, peak: start, exists: false };
}

export interface LeaderboardRow {
  position: number;
  userId: string;
  displayName: string;
  rating: number;
  tier: string;
  games: number;
  wins: number;
}

export async function leaderboard(env: Env, seasonId: string, limit: number = RANKED_CONFIG.leaderboardSize): Promise<LeaderboardRow[]> {
  const rows = await env.DB.prepare(
    `SELECT r.user_id, u.display_name, r.rating, r.games, r.wins, RANK() OVER (ORDER BY r.rating DESC) AS position
       FROM ranked_ratings r JOIN users u ON u.id = r.user_id
      WHERE r.season_id = ? AND r.games > 0
      ORDER BY r.rating DESC, r.games DESC, r.updated_at ASC
      LIMIT ?`,
  )
    .bind(seasonId, limit)
    .all<{ user_id: string; display_name: string; rating: number; games: number; wins: number; position: number }>();
  return rows.results.map((r) => ({ position: r.position, userId: r.user_id, displayName: r.display_name, rating: r.rating, tier: tierOf(r.rating).id, games: r.games, wins: r.wins }));
}

/** position of a player in the season leaderboard (null = not ranked yet) */
export async function positionOf(env: Env, seasonId: string, userId: string): Promise<{ position: number | null; players: number }> {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM ranked_ratings WHERE season_id = ?1 AND games > 0) AS players,
            (SELECT 1 + COUNT(*) FROM ranked_ratings o, ranked_ratings me
              WHERE me.season_id = ?1 AND me.user_id = ?2 AND me.games > 0
                AND o.season_id = ?1 AND o.games > 0 AND o.rating > me.rating) AS position,
            (SELECT games FROM ranked_ratings WHERE season_id = ?1 AND user_id = ?2) AS games`,
  )
    .bind(seasonId, userId)
    .first<{ players: number; position: number; games: number | null }>();
  return { position: row?.games ? row.position : null, players: row?.players ?? 0 };
}

export function seasonView(id: string) {
  const s = seasonById(id);
  return { id: s.id, name: s.nameJa, startsAt: s.startsAt, endsAt: s.endsAt };
}
