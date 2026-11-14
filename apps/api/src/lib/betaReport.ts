import { TIMER_EXPERIMENT_MODES } from '@fd/shared';
import type { Env } from '../env';
import {
  activitySummary,
  addDays,
  averageRetention,
  dayStart,
  metricsWhere,
  retentionCohorts,
  userIdWhere,
  usersWhere,
  type ActivityFilter,
} from './metrics';

/**
 * Beta test report (spec 15-3, decision 63): the figures of a period for the
 * chosen players (tag; Developer accounts left out by default). Every figure
 * comes from stored records; nothing is estimated.
 */

const pct = (a: number, b: number) => (b > 0 ? a / b : null);

/** features counted for "機能別利用率" (share of the active players who used them) */
export const BETA_FEATURES: { key: string; label: string; sql: string }[] = [
  { key: 'quick', label: 'クイックドラフト', sql: "e.event_name = 'mode_selected' AND json_extract(e.properties_json, '$.mode') = 'quick'" },
  { key: 'ranked', label: 'ランク戦', sql: "e.event_name = 'mode_selected' AND json_extract(e.properties_json, '$.mode') = 'ranked'" },
  { key: 'private', label: 'プライベートルーム', sql: "e.event_name = 'mode_selected' AND json_extract(e.properties_json, '$.mode') = 'private'" },
  { key: 'solo', label: 'ソロ課題', sql: "e.event_name = 'mode_selected' AND json_extract(e.properties_json, '$.mode') = 'solo'" },
  { key: 'event', label: 'イベント', sql: "e.event_name = 'mode_selected' AND json_extract(e.properties_json, '$.mode') = 'event'" },
  { key: 'collection', label: 'Collection Draft', sql: "e.event_name = 'mode_selected' AND json_extract(e.properties_json, '$.mode') = 'collection'" },
  { key: 'gacha', label: 'ガシャ', sql: "e.event_name = 'gacha_completed'" },
  { key: 'exchange', label: '交換所', sql: "e.event_name = 'exchange_completed'" },
  { key: 'missions', label: 'ミッションの受け取り', sql: "e.event_name = 'reward_claimed' AND json_extract(e.properties_json, '$.kind') = 'mission'" },
  { key: 'pass', label: 'Season Pass', sql: "(e.event_name = 'pass_purchased' OR (e.event_name = 'reward_claimed' AND json_extract(e.properties_json, '$.kind') = 'season_pass'))" },
  { key: 'shop', label: 'ショップ（購入の開始）', sql: "e.event_name = 'purchase_started'" },
  { key: 'roster', label: 'Collection Draft の登録', sql: "e.event_name = 'collection_player_registered'" },
  { key: 'feedback', label: 'フィードバック', sql: "e.event_name = 'feedback_submitted'" },
];

const TIMED_MODES = `(${TIMER_EXPERIMENT_MODES.map((m) => `'${m}'`).join(', ')})`;

/** pick time comparison (decision 66): per pick time, rooms of quick / ranked / collection */
export async function timerComparison(env: Env, fromMs: number, toMs: number, f: ActivityFilter) {
  const pw = userIdWhere('p.user_id', f);
  const drafts = await env.DB.prepare(
    `SELECT d.pick_seconds AS seconds, COUNT(*) AS drafts, SUM(d.status = 'completed') AS completed
       FROM drafts d JOIN rooms r ON r.id = d.room_id
      WHERE d.started_at >= ? AND d.started_at < ? AND r.environment = ? AND r.mode IN ${TIMED_MODES}
        AND EXISTS (SELECT 1 FROM draft_picks p WHERE p.draft_id = d.id AND p.user_id IS NOT NULL${pw.sql})
      GROUP BY d.pick_seconds`,
  )
    .bind(fromMs, toMs, env.ENVIRONMENT, ...pw.binds)
    .all<{ seconds: number; drafts: number; completed: number }>();
  const picks = await env.DB.prepare(
    `SELECT d.pick_seconds AS seconds, COUNT(*) AS picks, SUM(p.is_auto) AS auto, COUNT(DISTINCT p.draft_id || ':' || p.user_id) AS players
       FROM draft_picks p JOIN drafts d ON d.id = p.draft_id JOIN rooms r ON r.id = d.room_id
      WHERE p.user_id IS NOT NULL AND d.started_at >= ? AND d.started_at < ? AND r.environment = ? AND r.mode IN ${TIMED_MODES}${pw.sql}
      GROUP BY d.pick_seconds`,
  )
    .bind(fromMs, toMs, env.ENVIRONMENT, ...pw.binds)
    .all<{ seconds: number; picks: number; auto: number; players: number }>();
  const ew = userIdWhere('e.user_id', f);
  const events = await env.DB.prepare(
    `SELECT CAST(json_extract(e.properties_json, '$.pickSeconds') AS INTEGER) AS seconds,
            SUM(e.event_name = 'draft_started') AS started, SUM(e.event_name = 'match_abandoned') AS abandoned
       FROM analytics_events e
      WHERE e.environment = ? AND e.timestamp >= ? AND e.timestamp < ? AND e.event_name IN ('draft_started', 'match_abandoned')
        AND json_extract(e.properties_json, '$.mode') IN ${TIMED_MODES}${ew.sql}
      GROUP BY seconds`,
  )
    .bind(env.ENVIRONMENT, fromMs, toMs, ...ew.binds)
    .all<{ seconds: number | null; started: number; abandoned: number }>();
  // time to pick (ms) of the picks made by hand, per pick time of the draft
  const speed = await env.DB.prepare(
    `SELECT d.pick_seconds AS seconds, AVG(json_extract(e.properties_json, '$.ms')) AS ms
       FROM analytics_events e JOIN drafts d ON d.id = json_extract(e.properties_json, '$.draftId') JOIN rooms r ON r.id = d.room_id
      WHERE e.environment = ? AND e.event_name = 'draft_pick_completed' AND e.timestamp >= ? AND e.timestamp < ? AND r.mode IN ${TIMED_MODES}${ew.sql}
      GROUP BY d.pick_seconds`,
  )
    .bind(env.ENVIRONMENT, fromMs, toMs, ...ew.binds)
    .all<{ seconds: number; ms: number | null }>();
  const rw = userIdWhere('l.user_id', f);
  const ratings = await env.DB.prepare(
    `SELECT l.pick_seconds AS seconds, COUNT(*) AS n, AVG(l.draft_fun) AS draftFun, AVG(l.result_fair) AS resultFair
       FROM league_ratings l WHERE l.created_at >= ? AND l.created_at < ? AND l.mode IN ${TIMED_MODES}${rw.sql} GROUP BY l.pick_seconds`,
  )
    .bind(fromMs, toMs, ...rw.binds)
    .all<{ seconds: number | null; n: number; draftFun: number; resultFair: number }>();
  const all = new Set<number>([...drafts.results.map((r) => r.seconds), ...picks.results.map((r) => r.seconds)]);
  return [...all]
    .sort((a, b) => a - b)
    .map((seconds) => {
      const d = drafts.results.find((r) => r.seconds === seconds);
      const p = picks.results.find((r) => r.seconds === seconds);
      const e = events.results.find((r) => r.seconds === seconds);
      const r = ratings.results.find((x) => x.seconds === seconds);
      return {
        seconds,
        drafts: d?.drafts ?? 0,
        completed: d?.completed ?? 0,
        completionRate: pct(d?.completed ?? 0, d?.drafts ?? 0),
        humanPicks: p?.picks ?? 0,
        autoPicks: p?.auto ?? 0,
        /** picks the server made because time ran out (or the player was away) */
        autoRate: pct(p?.auto ?? 0, p?.picks ?? 0),
        players: p?.players ?? 0,
        avgPickMs: speed.results.find((x) => x.seconds === seconds)?.ms ?? null,
        leaguesStarted: e?.started ?? 0,
        abandoned: e?.abandoned ?? 0,
        abandonRate: pct(e?.abandoned ?? 0, e?.started ?? 0),
        ratings: r?.n ?? 0,
        draftFun: r?.draftFun ?? null,
        resultFair: r?.resultFair ?? null,
      };
    });
}

/** league ratings (decision 65) */
export async function ratingSummary(env: Env, fromMs: number, toMs: number, f: ActivityFilter) {
  const w = userIdWhere('l.user_id', f);
  const where = `l.created_at >= ? AND l.created_at < ?${w.sql}`;
  const binds = [fromMs, toMs, ...w.binds];
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n, AVG(l.draft_fun) AS draftFun, AVG(l.result_fair) AS resultFair FROM league_ratings l WHERE ${where}`)
    .bind(...binds)
    .first<{ n: number; draftFun: number | null; resultFair: number | null }>();
  const dist = await env.DB.prepare(`SELECT l.draft_fun AS d, l.result_fair AS r FROM league_ratings l WHERE ${where}`).bind(...binds).all<{ d: number; r: number }>();
  const histogram = (k: 'd' | 'r') => [1, 2, 3, 4, 5].map((v) => dist.results.filter((x) => x[k] === v).length);
  const group = async (col: string) =>
    (
      await env.DB.prepare(`SELECT ${col} AS key, COUNT(*) AS n, AVG(l.draft_fun) AS draftFun, AVG(l.result_fair) AS resultFair FROM league_ratings l WHERE ${where} GROUP BY ${col} ORDER BY n DESC LIMIT 12`)
        .bind(...binds)
        .all<{ key: string | number | null; n: number; draftFun: number; resultFair: number }>()
    ).results;
  return {
    count: total?.n ?? 0,
    draftFun: total?.draftFun ?? null,
    resultFair: total?.resultFair ?? null,
    histogram: { draftFun: histogram('d'), resultFair: histogram('r') },
    byMode: await group('l.mode'),
    byFormation: await group('l.formation'),
    byRank: await group('l.final_rank'),
  };
}

export async function betaReport(env: Env, p: { from: string; to: string; days: number }, f: ActivityFilter, now: number) {
  const fromMs = dayStart(p.from);
  const toMs = dayStart(addDays(p.to, 1));
  const uw = usersWhere(f);
  const testers = await env.DB.prepare(
    `SELECT COUNT(*) AS total, SUM(u.created_at >= ? AND u.created_at < ?) AS registered FROM users u WHERE u.created_at < ?${uw.sql}`,
  )
    .bind(fromMs, toMs, toMs, ...uw.binds)
    .first<{ total: number; registered: number | null }>();
  const tags = await env.DB.prepare(`SELECT t.tag, COUNT(*) AS n FROM user_tags t JOIN users u ON u.id = t.user_id WHERE u.created_at < ?${uw.sql} GROUP BY t.tag`)
    .bind(toMs, ...uw.binds)
    .all<{ tag: string; n: number }>();
  const developers = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_tags WHERE tag = 'developer'").first<{ n: number }>();
  const activity = await activitySummary(env, p.from, p.to, f);
  const { series, ...activityRest } = activity;
  // revisit: active players of the period who came back on another day
  const mw = metricsWhere(f);
  const revisit = await env.DB.prepare(
    `SELECT COUNT(*) AS players, SUM(days >= 2) AS returned FROM (SELECT m.user_id, COUNT(*) AS days FROM daily_user_metrics m WHERE m.day_key BETWEEN ? AND ?${mw.sql} GROUP BY m.user_id)`,
  )
    .bind(p.from, p.to, ...mw.binds)
    .first<{ players: number; returned: number | null }>();
  // left before the league ended (match_abandoned) per league started
  const ew = userIdWhere('e.user_id', f);
  const leagues = await env.DB.prepare(
    `SELECT SUM(e.event_name = 'draft_started') AS started, SUM(e.event_name = 'match_abandoned') AS abandoned
       FROM analytics_events e WHERE e.environment = ? AND e.timestamp >= ? AND e.timestamp < ? AND e.event_name IN ('draft_started', 'match_abandoned')${ew.sql}`,
  )
    .bind(env.ENVIRONMENT, fromMs, toMs, ...ew.binds)
    .first<{ started: number | null; abandoned: number | null }>();
  const features = await env.DB.prepare(
    `SELECT COUNT(DISTINCT e.user_id) AS players, ${BETA_FEATURES.map((x) => `COUNT(DISTINCT CASE WHEN ${x.sql} THEN e.user_id END) AS ${x.key}`).join(', ')}
       FROM analytics_events e
      WHERE e.environment = ? AND e.timestamp >= ? AND e.timestamp < ? AND e.user_id IN (SELECT m.user_id FROM daily_user_metrics m WHERE m.day_key BETWEEN ? AND ?${mw.sql})`,
  )
    .bind(env.ENVIRONMENT, fromMs, toMs, p.from, p.to, ...mw.binds)
    .first<Record<string, number>>();
  const fw = userIdWhere('f.user_id', f);
  const feedback = await env.DB.prepare(`SELECT f.category, f.status, COUNT(*) AS n FROM feedback f WHERE f.created_at >= ? AND f.created_at < ?${fw.sql} GROUP BY f.category, f.status`)
    .bind(fromMs, toMs, ...fw.binds)
    .all<{ category: string; status: string; n: number }>();
  const cohorts = await retentionCohorts(env, p.from, p.to, f, now);
  const activePlayers = activity.activeUsers;
  return {
    period: p,
    filter: f,
    generatedAt: now,
    testers: {
      total: testers?.total ?? 0,
      registeredInPeriod: testers?.registered ?? 0,
      active: activePlayers,
      byTag: tags.results,
      developersExcluded: f.excludeDevelopers ? developers?.n ?? 0 : 0,
    },
    retention: { average: averageRetention(cohorts), cohorts: cohorts.length, players: cohorts.reduce((s, c) => s + c.size, 0) },
    activity: activityRest,
    series,
    revisit: { players: revisit?.players ?? 0, returned: revisit?.returned ?? 0, rate: pct(revisit?.returned ?? 0, revisit?.players ?? 0) },
    abandon: { leagues: leagues?.started ?? 0, abandoned: leagues?.abandoned ?? 0, rate: pct(leagues?.abandoned ?? 0, leagues?.started ?? 0) },
    features: BETA_FEATURES.map((x) => ({ key: x.key, label: x.label, players: features?.[x.key] ?? 0, rate: pct(features?.[x.key] ?? 0, activePlayers) })),
    feedback: {
      total: feedback.results.reduce((s, r) => s + r.n, 0),
      byCategory: Object.entries(
        feedback.results.reduce<Record<string, number>>((acc, r) => ((acc[r.category] = (acc[r.category] ?? 0) + r.n), acc), {}),
      ).map(([category, n]) => ({ category, n })),
      open: feedback.results.filter((r) => ['new', 'reviewing', 'investigating'].includes(r.status)).reduce((s, r) => s + r.n, 0),
    },
    ratings: await ratingSummary(env, fromMs, toMs, f),
    timer: await timerComparison(env, fromMs, toMs, f),
  };
}
