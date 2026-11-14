import { jstDateKey, jstDayRange } from '@fd/shared';
import type { Env } from '../env';
import { ApiError } from './http';

/**
 * Player activity and retention (spec 12-3, 12-5, 12-6; docs/08-phase5-plan.md).
 *
 * - Days are Japan dates. A player is "active" on a day when any analytics
 *   event of that player was recorded (failed logins excluded).
 * - Finished days are summarised once into daily_user_metrics (one row per
 *   player and day) and marked in metrics_days; today's rows are recomputed
 *   on every read.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SESSION_MS = 3 * 60 * 60 * 1000;

export function addDays(dayKey: string, n: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** validated [from, to] period (Japan dates, inclusive); default: the last 14 days */
export function periodOf(q: { from?: string; to?: string }, now = Date.now()): { from: string; to: string; days: number } {
  const today = jstDateKey(now);
  const to = q.to && DAY.test(q.to) ? q.to : today;
  const from = q.from && DAY.test(q.from) ? q.from : addDays(to, -13);
  const days = daysBetween(from, to) + 1;
  if (days < 1 || days > 366) throw new ApiError('BAD_REQUEST', 'the period must be 1-366 days');
  return { from, to, days };
}

/** statements that (re)build the rows of one day */
function dayStatements(env: Env, dayKey: string): D1PreparedStatement[] {
  const { startsAt, endsAt } = jstDayRange(dayKey);
  return [
    env.DB.prepare('DELETE FROM daily_user_metrics WHERE day_key = ?').bind(dayKey),
    env.DB.prepare(
      `INSERT INTO daily_user_metrics (day_key, user_id, platform, app_version, events, sessions, playtime_ms, drafts_started, drafts_completed, matches_started, matches_completed, picks)
       SELECT ?1, user_id, MAX(platform), MAX(app_version), COUNT(*),
              SUM(event_name = 'session_started'),
              MIN(SUM(CASE WHEN event_name = 'session_ended' THEN MIN(COALESCE(json_extract(properties_json, '$.durationMs'), 0), ?5) ELSE 0 END), 86400000),
              SUM(event_name = 'draft_started'), SUM(event_name = 'draft_completed'),
              SUM(event_name = 'match_started'), SUM(event_name = 'match_completed'),
              SUM(event_name IN ('draft_pick_completed', 'draft_timeout'))
         FROM analytics_events
        WHERE environment = ?2 AND user_id IS NOT NULL AND event_name <> 'login_failed' AND timestamp >= ?3 AND timestamp < ?4
        GROUP BY user_id`,
    ).bind(dayKey, env.ENVIRONMENT, startsAt, endsAt, MAX_SESSION_MS),
    // modes played that day (every human joins a room, whatever the mode)
    env.DB.prepare(
      `UPDATE daily_user_metrics SET modes_json = (
         SELECT json_group_object(mode, n) FROM (
           SELECT json_extract(properties_json, '$.mode') AS mode, COUNT(*) AS n FROM analytics_events
            WHERE environment = ?2 AND user_id = daily_user_metrics.user_id AND event_name = 'room_joined' AND timestamp >= ?3 AND timestamp < ?4
            GROUP BY mode))
        WHERE day_key = ?1`,
    ).bind(dayKey, env.ENVIRONMENT, startsAt, endsAt),
  ];
}

/**
 * Summarises the finished days that are not summarised yet (oldest first, at
 * most `maxDays` per call) and rebuilds today's rows.
 */
export async function refreshDailyMetrics(env: Env, now = Date.now(), maxDays = 14): Promise<void> {
  const today = jstDateKey(now);
  const last = await env.DB.prepare('SELECT MAX(day_key) AS d FROM metrics_days').first<{ d: string | null }>();
  let start: string;
  if (last?.d) start = addDays(last.d, 1);
  else {
    const first = await env.DB.prepare('SELECT MIN(timestamp) AS t FROM analytics_events WHERE environment = ?').bind(env.ENVIRONMENT).first<{ t: number | null }>();
    start = first?.t ? jstDateKey(first.t) : today;
  }
  const stmts: D1PreparedStatement[] = [];
  for (let d = start, i = 0; d < today && i < maxDays; d = addDays(d, 1), i++) {
    stmts.push(
      ...dayStatements(env, d),
      env.DB.prepare(
        `INSERT OR REPLACE INTO metrics_days (day_key, active_users, events, computed_at)
         SELECT ?, COUNT(*), COALESCE(SUM(events), 0), ? FROM daily_user_metrics WHERE day_key = ?`,
      ).bind(d, now, d),
    );
  }
  stmts.push(...dayStatements(env, today));
  for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
}

// ---------------------------------------------------------------- filters

export interface ActivityFilter {
  platform?: string;
  appVersion?: string;
  tag?: string;
}

export const USER_TAGS = ['founder', 'beta_tester', 'friend_tester', 'developer', 'normal'] as const;

export function filterOf(q: Record<string, string | undefined>): ActivityFilter {
  const f: ActivityFilter = {};
  if (q.platform) f.platform = q.platform.slice(0, 20);
  if (q.version) f.appVersion = q.version.slice(0, 20);
  if (q.tag) {
    if (!(USER_TAGS as readonly string[]).includes(q.tag)) throw new ApiError('BAD_REQUEST', 'unknown tag');
    f.tag = q.tag;
  }
  return f;
}

/** SQL condition on daily_user_metrics (alias m) */
export function metricsWhere(f: ActivityFilter): { sql: string; binds: unknown[] } {
  const parts: string[] = [];
  const binds: unknown[] = [];
  if (f.platform) {
    parts.push('m.platform = ?');
    binds.push(f.platform);
  }
  if (f.appVersion) {
    parts.push('m.app_version = ?');
    binds.push(f.appVersion);
  }
  if (f.tag) {
    parts.push('m.user_id IN (SELECT user_id FROM user_tags WHERE tag = ?)');
    binds.push(f.tag);
  }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', binds };
}

/** SQL condition on users (alias u) for the tag filter */
export function usersWhere(f: ActivityFilter): { sql: string; binds: unknown[] } {
  return f.tag ? { sql: ' AND u.id IN (SELECT user_id FROM user_tags WHERE tag = ?)', binds: [f.tag] } : { sql: '', binds: [] };
}

/** start (ms) of a Japan day */
export const dayStart = (dayKey: string) => jstDayRange(dayKey).startsAt;

// ---------------------------------------------------------------- queries

export interface DayRow {
  day: string;
  active: number;
  sessions: number;
  playtimeMs: number;
  matches: number;
  newUsers: number;
}

/** per-day activity and registrations in [from, to] */
export async function dailySeries(env: Env, from: string, to: string, f: ActivityFilter): Promise<DayRow[]> {
  const w = metricsWhere(f);
  const act = await env.DB.prepare(
    `SELECT m.day_key AS day, COUNT(*) AS active, SUM(m.sessions) AS sessions, SUM(m.playtime_ms) AS playtime, SUM(m.matches_completed) AS matches
       FROM daily_user_metrics m WHERE m.day_key BETWEEN ? AND ?${w.sql} GROUP BY m.day_key`,
  )
    .bind(from, to, ...w.binds)
    .all<{ day: string; active: number; sessions: number; playtime: number; matches: number }>();
  const uw = usersWhere(f);
  const reg = await env.DB.prepare(
    `SELECT date((u.created_at + 32400000) / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM users u
      WHERE u.created_at >= ? AND u.created_at < ?${uw.sql} GROUP BY day`,
  )
    .bind(dayStart(from), dayStart(addDays(to, 1)), ...uw.binds)
    .all<{ day: string; n: number }>();
  const a = new Map(act.results.map((r) => [r.day, r]));
  const r = new Map(reg.results.map((x) => [x.day, x.n]));
  const out: DayRow[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const x = a.get(d);
    out.push({ day: d, active: x?.active ?? 0, sessions: x?.sessions ?? 0, playtimeMs: x?.playtime ?? 0, matches: x?.matches ?? 0, newUsers: r.get(d) ?? 0 });
  }
  return out;
}

/** distinct active players in [from, to] */
export async function activeUsers(env: Env, from: string, to: string, f: ActivityFilter = {}): Promise<number> {
  const w = metricsWhere(f);
  const row = await env.DB.prepare(`SELECT COUNT(DISTINCT m.user_id) AS n FROM daily_user_metrics m WHERE m.day_key BETWEEN ? AND ?${w.sql}`)
    .bind(from, to, ...w.binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export const RETENTION_DAYS = [1, 3, 7, 14, 30] as const;

export interface CohortRow {
  day: string;
  size: number;
  /** n -> share (0-1) or null while day+n has not finished */
  rates: Record<number, number | null>;
  counts: Record<number, number | null>;
}

/**
 * Registration cohorts (spec 12-6): Dn = share of the players registered on a
 * Japan day who were active n days later. Only finished days are counted.
 */
export async function retentionCohorts(env: Env, from: string, to: string, f: ActivityFilter, now = Date.now()): Promise<CohortRow[]> {
  const uw = usersWhere(f);
  const cols = RETENTION_DAYS.map((n) => `SUM(EXISTS (SELECT 1 FROM daily_user_metrics m WHERE m.user_id = c.id AND m.day_key = date(c.day, '+${n} day'))) AS d${n}`).join(', ');
  const rows = await env.DB.prepare(
    `SELECT c.day, COUNT(*) AS size, ${cols}
       FROM (SELECT u.id, date((u.created_at + 32400000) / 1000, 'unixepoch') AS day FROM users u WHERE u.created_at >= ? AND u.created_at < ?${uw.sql}) c
      GROUP BY c.day ORDER BY c.day DESC`,
  )
    .bind(dayStart(from), dayStart(addDays(to, 1)), ...uw.binds)
    .all<Record<string, number | string>>();
  const today = jstDateKey(now);
  return rows.results.map((r) => {
    const day = String(r.day);
    const size = Number(r.size);
    const rates: Record<number, number | null> = {};
    const counts: Record<number, number | null> = {};
    for (const n of RETENTION_DAYS) {
      const finished = addDays(day, n) < today;
      counts[n] = finished ? Number(r[`d${n}`]) : null;
      rates[n] = finished && size ? Number(r[`d${n}`]) / size : null;
    }
    return { day, size, rates, counts };
  });
}

/** weighted average of Dn over cohorts (only cohorts where Dn is known) */
export function averageRetention(cohorts: CohortRow[]): Record<number, number | null> {
  const out: Record<number, number | null> = {};
  for (const n of RETENTION_DAYS) {
    let size = 0;
    let back = 0;
    for (const c of cohorts) {
      if (c.counts[n] === null) continue;
      size += c.size;
      back += c.counts[n]!;
    }
    out[n] = size ? back / size : null;
  }
  return out;
}
