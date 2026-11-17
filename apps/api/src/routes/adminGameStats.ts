import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { timerComparison } from '../lib/betaReport';
import { ApiError } from '../lib/http';
import { addDays, dayStart, filterOf, periodOf } from '../lib/metrics';
import type { AppEnv, Env } from '../env';

/**
 * Match and draft statistics for the SIM balance (spec 12-2 Matches and Draft
 * Analytics, 6-7; Phase 7). Aggregated only: no player of the game is
 * identified (the players listed are cards).
 */
export const adminGameStatRoutes = new Hono<AppEnv>();

const MODES = ['quick', 'ranked', 'private', 'solo', 'event', 'collection'] as const;
const pct = (a: number, b: number) => (b > 0 ? a / b : null);

interface Scope {
  fromMs: number;
  toMs: number;
  /** SQL on rooms (alias r) */
  sql: string;
  binds: unknown[];
}

function scopeOf(env: Env, q: Record<string, string | undefined>): Scope & { period: ReturnType<typeof periodOf>; mode: string | null; humansOnly: boolean } {
  const period = periodOf(q);
  const mode = q.mode || null;
  if (mode && !(MODES as readonly string[]).includes(mode)) throw new ApiError('BAD_REQUEST', 'unknown mode');
  const humansOnly = q.humans === '1';
  const parts = ['r.environment = ?'];
  const binds: unknown[] = [env.ENVIRONMENT];
  if (mode) {
    parts.push('r.mode = ?');
    binds.push(mode);
  }
  return { period, mode, humansOnly, fromMs: dayStart(period.from), toMs: dayStart(addDays(period.to, 1)), sql: parts.join(' AND '), binds };
}

// ---------------------------------------------------------------- matches

adminGameStatRoutes.get('/matches', requirePermission('analytics.read'), async (c) => {
  const s = scopeOf(c.env, c.req.query());
  // matches of the period (one row per match), with the average OVR of each side's starters
  const human = s.humansOnly ? ' AND (m.home_user_id IS NOT NULL OR m.away_user_id IS NOT NULL)' : '';
  const base = `FROM matches m JOIN match_results res ON res.match_id = m.id JOIN rooms r ON r.id = m.room_id
                WHERE m.created_at >= ? AND m.created_at < ? AND ${s.sql}${human}`;
  const binds = [s.fromMs, s.toMs, ...s.binds];
  const sum = await c.env.DB.prepare(
    `SELECT COUNT(*) AS matches, AVG(res.home_goals + res.away_goals) AS goals, AVG(res.home_goals = res.away_goals) AS draws,
            AVG(ABS(res.home_goals - res.away_goals)) AS margin, AVG(res.home_goals + res.away_goals = 0) AS goalless,
            AVG(res.home_goals > res.away_goals) AS homeWins, MAX(res.home_goals + res.away_goals) AS maxGoals ${base}`,
  )
    .bind(...binds)
    .first<Record<string, number | null>>();
  const totals = await c.env.DB.prepare(`SELECT MIN(res.home_goals + res.away_goals, 7) AS goals, COUNT(*) AS n ${base} GROUP BY 1 ORDER BY 1`).bind(...binds).all<{ goals: number; n: number }>();
  const margins = await c.env.DB.prepare(`SELECT MIN(ABS(res.home_goals - res.away_goals), 5) AS margin, COUNT(*) AS n ${base} GROUP BY 1 ORDER BY 1`).bind(...binds).all<{ margin: number; n: number }>();
  // per team and match: statistics, formation, tactics, chemistry, result
  const teamBase = `FROM match_teams t JOIN matches m ON m.id = t.match_id JOIN match_results res ON res.match_id = m.id JOIN rooms r ON r.id = m.room_id
                    JOIN match_statistics st ON st.match_id = t.match_id AND st.side = t.side
                    WHERE m.created_at >= ? AND m.created_at < ? AND ${s.sql}${human}`;
  const gf = "CASE WHEN t.side = 'home' THEN res.home_goals ELSE res.away_goals END";
  const ga = "CASE WHEN t.side = 'home' THEN res.away_goals ELSE res.home_goals END";
  const stats = await c.env.DB.prepare(
    `SELECT AVG(json_extract(st.stats_json, '$.shots')) AS shots, AVG(json_extract(st.stats_json, '$.shotsOnTarget')) AS shotsOnTarget,
            AVG(json_extract(st.stats_json, '$.xg')) AS xg, AVG(${gf}) AS goals,
            AVG(CAST(json_extract(st.stats_json, '$.passesCompleted') AS REAL) / NULLIF(json_extract(st.stats_json, '$.passes'), 0)) AS passAccuracy,
            AVG(ABS(json_extract(st.stats_json, '$.possession') - 50)) AS possessionSpread,
            AVG(json_extract(st.stats_json, '$.corners')) AS corners, AVG(json_extract(st.stats_json, '$.fouls')) AS fouls,
            AVG(json_extract(st.stats_json, '$.yellow')) AS yellow, AVG(json_extract(st.stats_json, '$.red')) AS red,
            AVG(json_extract(st.stats_json, '$.saves')) AS saves ${teamBase}`,
  )
    .bind(...binds)
    .first<Record<string, number | null>>();
  const by = async (expr: string) =>
    (
      await c.env.DB.prepare(
        `SELECT ${expr} AS key, COUNT(*) AS games, SUM(${gf} > ${ga}) AS wins, SUM(${gf} = ${ga}) AS draws, SUM(${gf} < ${ga}) AS losses,
                AVG(${gf}) AS goalsFor, AVG(${ga}) AS goalsAgainst, AVG(json_extract(st.stats_json, '$.xg')) AS xg
           ${teamBase} GROUP BY key ORDER BY games DESC`,
      )
        .bind(...binds)
        .all<{ key: string | number | null; games: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; xg: number }>()
    ).results.map((r) => ({ ...r, winRate: pct(r.wins, r.games), points: r.games ? (r.wins * 3 + r.draws) / r.games : null }));
  // the starters' average OVR of both sides: does the stronger team win too often (or too rarely)?
  const strength = `(SELECT AVG(json_extract(pj.value, '$.ovr')) FROM json_each(t.players_json) pj
                      WHERE json_extract(pj.value, '$.id') IN (SELECT value FROM json_each(t.lineup_json, '$.starters')))`;
  const gap = await c.env.DB.prepare(
    `SELECT CASE WHEN diff < 1 THEN '0-1' WHEN diff < 3 THEN '1-3' WHEN diff < 5 THEN '3-5' ELSE '5+' END AS gap,
            COUNT(*) AS matches, SUM(stronger_won) AS strongerWon, SUM(draw) AS draws
       FROM (SELECT ABS(h.ovr - a.ovr) AS diff,
                    CASE WHEN h.ovr >= a.ovr THEN res.home_goals > res.away_goals ELSE res.away_goals > res.home_goals END AS stronger_won,
                    res.home_goals = res.away_goals AS draw
               FROM matches m JOIN match_results res ON res.match_id = m.id JOIN rooms r ON r.id = m.room_id
               JOIN (SELECT t.match_id, ${strength} AS ovr FROM match_teams t WHERE t.side = 'home') h ON h.match_id = m.id
               JOIN (SELECT t.match_id, ${strength} AS ovr FROM match_teams t WHERE t.side = 'away') a ON a.match_id = m.id
              WHERE m.created_at >= ? AND m.created_at < ? AND ${s.sql}${human})
      GROUP BY gap ORDER BY MIN(diff)`,
  )
    .bind(...binds)
    .all<{ gap: string; matches: number; strongerWon: number; draws: number }>();
  // goals per 15-minute period (spec 6-1)
  const minutes = await c.env.DB.prepare(
    `SELECT MIN(CAST(json_extract(j.value, '$.minute') / 15 AS INTEGER), 5) AS period, COUNT(*) AS goals
       FROM match_events e JOIN matches m ON m.id = e.match_id JOIN rooms r ON r.id = m.room_id, json_each(e.events_json) j
      WHERE json_extract(j.value, '$.type') = 'goal' AND m.created_at >= ? AND m.created_at < ? AND ${s.sql}${human}
      GROUP BY period ORDER BY period`,
  )
    .bind(...binds)
    .all<{ period: number; goals: number }>();
  // special abilities (spec 4-4): appearances, goals per 90 and rating of the players with each trait
  const traits = await c.env.DB.prepare(
    `SELECT COALESCE(pt.trait, '(なし)') AS trait, COUNT(*) AS apps, SUM(json_extract(j.value, '$.minutes')) AS minutes,
            SUM(json_extract(j.value, '$.goals')) AS goals, SUM(json_extract(j.value, '$.assists')) AS assists, AVG(json_extract(j.value, '$.rating')) AS rating
       FROM match_statistics st JOIN matches m ON m.id = st.match_id JOIN rooms r ON r.id = m.room_id, json_each(st.players_json) j
       LEFT JOIN player_traits pt ON pt.player_id = json_extract(j.value, '$.playerId')
      WHERE json_extract(j.value, '$.minutes') > 0 AND m.created_at >= ? AND m.created_at < ? AND ${s.sql}${human}
      GROUP BY 1 ORDER BY apps DESC`,
  )
    .bind(...binds)
    .all<{ trait: string; apps: number; minutes: number; goals: number; assists: number; rating: number }>();
  const daily = await c.env.DB.prepare(
    `SELECT date((m.created_at + 32400000) / 1000, 'unixepoch') AS day, COUNT(*) AS matches, AVG(res.home_goals + res.away_goals) AS goals ${base} GROUP BY day ORDER BY day`,
  )
    .bind(...binds)
    .all<{ day: string; matches: number; goals: number }>();
  return c.json({
    period: s.period,
    mode: s.mode,
    humansOnly: s.humansOnly,
    summary: sum,
    teamAverages: stats,
    goalsDistribution: totals.results,
    marginDistribution: margins.results,
    byFormation: await by("json_extract(t.lineup_json, '$.formation')"),
    byOffense: await by("json_extract(t.lineup_json, '$.tactics.offense')"),
    byDefense: await by("json_extract(t.lineup_json, '$.tactics.defense')"),
    byChemistry: await by("CASE WHEN t.chemistry < 60 THEN '〜59' WHEN t.chemistry < 70 THEN '60〜69' WHEN t.chemistry < 80 THEN '70〜79' WHEN t.chemistry < 90 THEN '80〜89' ELSE '90〜' END"),
    strengthGap: gap.results.map((g) => ({ ...g, strongerWinRate: pct(g.strongerWon, g.matches) })),
    goalMinutes: minutes.results,
    traits: traits.results.map((t) => ({ ...t, goalsPer90: t.minutes ? (t.goals * 90) / t.minutes : null })),
    daily: daily.results,
  });
});

// ---------------------------------------------------------------- drafts

adminGameStatRoutes.get('/drafts', requirePermission('analytics.read'), async (c) => {
  const q = c.req.query();
  const s = scopeOf(c.env, q);
  const base = 'FROM legacy_drafts d JOIN rooms r ON r.id = d.room_id WHERE d.started_at >= ? AND d.started_at < ? AND ' + s.sql;
  const binds = [s.fromMs, s.toMs, ...s.binds];
  const sum = await c.env.DB.prepare(`SELECT COUNT(*) AS drafts, SUM(d.status = 'completed') AS completed ${base}`).bind(...binds).first<{ drafts: number; completed: number | null }>();
  const pickBase = `FROM legacy_draft_picks p JOIN legacy_drafts d ON d.id = p.draft_id JOIN rooms r ON r.id = d.room_id JOIN player_cards pc ON pc.id = p.player_id
                    WHERE d.started_at >= ? AND d.started_at < ? AND ${s.sql}`;
  const picks = await c.env.DB.prepare(
    `SELECT COUNT(*) AS picks, SUM(p.user_id IS NOT NULL) AS human, SUM(p.user_id IS NOT NULL AND p.is_auto = 1) AS humanAuto ${pickBase}`,
  )
    .bind(...binds)
    .first<{ picks: number; human: number | null; humanAuto: number | null }>();
  // round = 1..14 (4 picks per round)
  const rounds = await c.env.DB.prepare(
    `SELECT (p.pick_no - 1) / 4 + 1 AS round, COUNT(*) AS picks, AVG(pc.ovr) AS ovr,
            AVG(CASE WHEN p.user_id IS NOT NULL THEN pc.ovr END) AS humanOvr, AVG(CASE WHEN p.user_id IS NULL THEN pc.ovr END) AS cpuOvr,
            SUM(pc.primary_position = 'GK') AS gk,
            SUM(pc.primary_position IN ('CB', 'LB', 'RB', 'LWB', 'RWB')) AS df,
            SUM(pc.primary_position IN ('CDM', 'CM', 'CAM', 'LM', 'RM')) AS mf,
            SUM(pc.primary_position IN ('LW', 'RW', 'ST', 'CF')) AS fw,
            SUM(pc.rarity = 'common') AS common, SUM(pc.rarity = 'rare') AS rare, SUM(pc.rarity = 'epic') AS epic,
            SUM(pc.rarity = 'legendary') AS legendary, SUM(pc.rarity = 'icon') AS icon
       ${pickBase} GROUP BY round ORDER BY round`,
  )
    .bind(...binds)
    .all<Record<string, number>>();
  // how often a card is picked when it is in the pool, and how early (average pick number)
  const offered = await c.env.DB.prepare(
    `SELECT j.value AS id, COUNT(*) AS offered FROM legacy_drafts d JOIN rooms r ON r.id = d.room_id, json_each(d.pool_json) j
      WHERE d.started_at >= ? AND d.started_at < ? AND d.status = 'completed' AND ${s.sql} GROUP BY j.value`,
  )
    .bind(...binds)
    .all<{ id: string; offered: number }>();
  const picked = await c.env.DB.prepare(
    `SELECT p.player_id AS id, pc.name, pc.rarity, pc.primary_position AS position, pc.ovr, COUNT(*) AS picked, AVG(p.pick_no) AS avgPick
       ${pickBase} AND d.status = 'completed' GROUP BY p.player_id`,
  )
    .bind(...binds)
    .all<{ id: string; name: string; rarity: string; position: string; ovr: number; picked: number; avgPick: number }>();
  const off = new Map(offered.results.map((o) => [o.id, o.offered]));
  const cards = picked.results.map((p) => ({ ...p, offered: off.get(p.id) ?? 0, pickRate: pct(p.picked, off.get(p.id) ?? 0) }));
  const earliest = [...cards].filter((x) => x.picked >= 3).sort((a, b) => a.avgPick - b.avgPick).slice(0, 15);
  // cards that were offered often but rarely (or never) picked
  const names = await c.env.DB.prepare('SELECT id, name, rarity, primary_position AS position, ovr FROM player_cards WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(offered.results.filter((o) => o.offered >= 5).map((o) => o.id)))
    .all<{ id: string; name: string; rarity: string; position: string; ovr: number }>();
  const pickedById = new Map(cards.map((x) => [x.id, x]));
  const ignored = names.results
    .map((n) => ({ ...n, offered: off.get(n.id) ?? 0, picked: pickedById.get(n.id)?.picked ?? 0 }))
    .map((n) => ({ ...n, pickRate: pct(n.picked, n.offered) }))
    .sort((a, b) => (a.pickRate ?? 0) - (b.pickRate ?? 0) || b.offered - a.offered)
    .slice(0, 15);
  // final ranks of people and CPUs in finished leagues
  const ranks = await c.env.DB.prepare(
    `SELECT mb.is_cpu AS cpu, COUNT(*) AS seats, AVG(mb.final_rank) AS avgRank, SUM(mb.final_rank = 1) AS firsts
       FROM room_members mb JOIN rooms r ON r.id = mb.room_id
      WHERE mb.final_rank IS NOT NULL AND r.finished_at >= ? AND r.finished_at < ? AND ${s.sql} GROUP BY mb.is_cpu`,
  )
    .bind(...binds)
    .all<{ cpu: number; seats: number; avgRank: number; firsts: number }>();
  return c.json({
    period: s.period,
    mode: s.mode,
    summary: {
      drafts: sum?.drafts ?? 0,
      completed: sum?.completed ?? 0,
      completionRate: pct(sum?.completed ?? 0, sum?.drafts ?? 0),
      picks: picks?.picks ?? 0,
      humanPicks: picks?.human ?? 0,
      humanAutoPicks: picks?.humanAuto ?? 0,
      humanAutoRate: pct(picks?.humanAuto ?? 0, picks?.human ?? 0),
    },
    rounds: rounds.results,
    earliest,
    ignored,
    ranks: ranks.results.map((r) => ({ who: r.cpu ? 'cpu' : 'human', seats: r.seats, avgRank: r.avgRank, firstRate: pct(r.firsts, r.seats) })),
    timer: await timerComparison(c.env, s.fromMs, s.toMs, filterOf(q)),
  });
});

// ---------------------------------------------------------------- DRAFT MATCH

/**
 * DRAFT MATCH (official spec v2.0): rooms by state, people per room, チンチロ hands,
 * automatic picks and the refused operations of the audit log (spec 10).
 */
adminGameStatRoutes.get('/draft-match', requirePermission('analytics.read'), async (c) => {
  const period = periodOf(c.req.query());
  const from = dayStart(period.from);
  const to = dayStart(addDays(period.to, 1));
  const env = c.env.ENVIRONMENT;
  const [states, sizes, hands, picks, reasons, recent] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT status, COUNT(*) AS n FROM draft_rooms WHERE created_at >= ? AND created_at < ? AND environment = ? GROUP BY status').bind(from, to, env),
    c.env.DB.prepare("SELECT players, COUNT(*) AS n FROM draft_rooms WHERE created_at >= ? AND created_at < ? AND environment = ? AND status = 'COMPLETED' GROUP BY players ORDER BY players").bind(from, to, env),
    c.env.DB.prepare(
      'SELECT h.hand, COUNT(*) AS n, SUM(h.is_auto) AS auto FROM draft_dice_results h JOIN draft_rooms d ON d.id = h.room_id WHERE h.created_at >= ? AND h.created_at < ? AND d.environment = ? GROUP BY h.hand',
    ).bind(from, to, env),
    c.env.DB.prepare('SELECT COUNT(*) AS n, SUM(p.is_auto) AS auto FROM draft_picks p JOIN draft_rooms d ON d.id = p.room_id WHERE p.picked_at >= ? AND p.picked_at < ? AND d.environment = ?').bind(from, to, env),
    c.env.DB.prepare('SELECT a.action, a.reason, COUNT(*) AS n FROM draft_audit_logs a JOIN draft_rooms d ON d.id = a.room_id WHERE a.created_at >= ? AND a.created_at < ? AND d.environment = ? GROUP BY a.action, a.reason ORDER BY n DESC LIMIT 30').bind(from, to, env),
    c.env.DB.prepare(
      'SELECT a.created_at, a.room_id, a.status, a.action, a.reason, a.user_id FROM draft_audit_logs a JOIN draft_rooms d ON d.id = a.room_id WHERE a.created_at >= ? AND a.created_at < ? AND d.environment = ? ORDER BY a.created_at DESC LIMIT 50',
    ).bind(from, to, env),
  ]);
  const p = (picks.results[0] ?? {}) as { n?: number; auto?: number };
  return c.json({
    period,
    states: states.results,
    sizes: sizes.results,
    hands: hands.results,
    picks: { total: p.n ?? 0, auto: p.auto ?? 0, autoRate: pct(p.auto ?? 0, p.n ?? 0) },
    audit: { byReason: reasons.results, recent: recent.results },
  });
});
