import { CURRENCIES, jstDateKey } from '@fd/shared';
import { Hono } from 'hono';
import { can, requirePermission } from '../lib/auth';
import {
  RETENTION_DAYS,
  activeUsers,
  addDays,
  averageRetention,
  dailySeries,
  dayStart,
  filterOf,
  metricsWhere,
  periodOf,
  refreshDailyMetrics,
  retentionCohorts,
  usersWhere,
  type ActivityFilter,
} from '../lib/metrics';
import type { AppEnv, Env } from '../env';

/**
 * Aggregated figures for the admin site (spec 12-3, 12-5, 12-6, 12-7).
 * Nothing here identifies a player except the "top players" lists, which
 * need users.read.
 */
export const adminInsightRoutes = new Hono<AppEnv>();

const pct = (a: number, b: number) => (b > 0 ? a / b : null);

async function summary(env: Env, from: string, to: string, f: ActivityFilter) {
  const series = await dailySeries(env, from, to, f);
  const sum = (k: 'active' | 'sessions' | 'playtimeMs' | 'matches' | 'newUsers') => series.reduce((s, r) => s + r[k], 0);
  const activeDays = sum('active');
  const w = metricsWhere(f);
  const extra = await env.DB.prepare(
    `SELECT COALESCE(SUM(m.drafts_started), 0) AS ds, COALESCE(SUM(m.drafts_completed), 0) AS dc,
            COALESCE(SUM(m.matches_started), 0) AS ms, COALESCE(SUM(m.matches_completed), 0) AS mc
       FROM daily_user_metrics m WHERE m.day_key BETWEEN ? AND ?${w.sql}`,
  )
    .bind(from, to, ...w.binds)
    .first<{ ds: number; dc: number; ms: number; mc: number }>();
  return {
    series,
    activeUsers: await activeUsers(env, from, to, f),
    newUsers: sum('newUsers'),
    sessions: sum('sessions'),
    matches: sum('matches'),
    /** per active player and day */
    avgPlaytimeMs: activeDays ? sum('playtimeMs') / activeDays : null,
    avgMatches: activeDays ? sum('matches') / activeDays : null,
    avgSessionMs: sum('sessions') ? sum('playtimeMs') / sum('sessions') : null,
    draftCompletion: pct(extra?.dc ?? 0, extra?.ds ?? 0),
    matchCompletion: pct(extra?.mc ?? 0, extra?.ms ?? 0),
  };
}

/** DAU on `day`, WAU / MAU on the 7 / 30 days ending on `day` */
async function dauWauMau(env: Env, day: string, f: ActivityFilter) {
  return {
    dau: await activeUsers(env, day, day, f),
    wau: await activeUsers(env, addDays(day, -6), day, f),
    mau: await activeUsers(env, addDays(day, -29), day, f),
  };
}

/** sales of a period for the overview (details: GET /api/admin/revenue) */
async function revenueSummary(env: Env, from: string, to: string) {
  const fromMs = dayStart(from);
  const toMs = dayStart(addDays(to, 1));
  const t = await env.DB.prepare(
    `SELECT COALESCE(SUM(price_jpy), 0) AS gross, COUNT(DISTINCT user_id) AS payers, COALESCE(SUM(CASE WHEN store = 'mock' THEN price_jpy END), 0) AS mock
       FROM purchase_transactions WHERE status IN ('completed', 'refunded') AND completed_at >= ? AND completed_at < ?`,
  )
    .bind(fromMs, toMs)
    .first<{ gross: number; payers: number; mock: number }>();
  const total = await env.DB.prepare(
    "SELECT COALESCE(SUM(price_jpy), 0) AS gross FROM purchase_transactions WHERE status IN ('completed', 'refunded')",
  ).first<{ gross: number }>();
  const refunds = await env.DB.prepare('SELECT COALESCE(SUM(amount_jpy), 0) AS n FROM refund_records WHERE created_at >= ? AND created_at < ?').bind(fromMs, toMs).first<{ n: number }>();
  const totalRefunds = await env.DB.prepare('SELECT COALESCE(SUM(amount_jpy), 0) AS n FROM refund_records').first<{ n: number }>();
  const active = await activeUsers(env, from, to);
  const net = (t?.gross ?? 0) - (refunds?.n ?? 0);
  return {
    implemented: true,
    // decision 52: Apple / Google are not connected yet; only the mock store (not in production) takes purchases
    storesConnected: false,
    cumulativeNet: (total?.gross ?? 0) - (totalRefunds?.n ?? 0),
    net,
    mockGross: t?.mock ?? 0,
    payers: t?.payers ?? 0,
    payerRate: pct(t?.payers ?? 0, active),
    arpu: pct(net, active),
    arppu: pct(net, t?.payers ?? 0),
  };
}

adminInsightRoutes.get('/overview', requirePermission('analytics.read'), async (c) => {
  const now = Date.now();
  await refreshDailyMetrics(c.env, now);
  const p = periodOf(c.req.query(), now);
  const prevTo = addDays(p.from, -1);
  const prevFrom = addDays(prevTo, -(p.days - 1));
  const [cur, prev] = [await summary(c.env, p.from, p.to, {}), await summary(c.env, prevFrom, prevTo, {})];
  const totals = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM users WHERE status = 'suspended') AS suspended,
            (SELECT COUNT(*) FROM feedback WHERE status IN ('new', 'reviewing', 'investigating')) AS open_feedback,
            (SELECT COUNT(*) FROM feedback WHERE status = 'new') AS new_feedback,
            (SELECT COALESCE(SUM(gems_free), 0) FROM currency_wallets) AS gems_free,
            (SELECT COALESCE(SUM(gems_paid_purchased + gems_paid_granted), 0) FROM currency_wallets) AS gems_paid`,
  ).first<{ users: number; suspended: number; open_feedback: number; new_feedback: number; gems_free: number; gems_paid: number }>();
  const spent = async (from: string, to: string) =>
    (
      await c.env.DB.prepare(
        "SELECT COALESCE(-SUM(amount), 0) AS n FROM currency_transactions WHERE amount < 0 AND currency IN ('GEMS_FREE', 'GEMS_PAID_PURCHASED', 'GEMS_PAID_GRANTED') AND created_at >= ? AND created_at < ?",
      )
        .bind(dayStart(from), dayStart(addDays(to, 1)))
        .first<{ n: number }>()
    )?.n ?? 0;
  const errors = async (from: string, to: string) =>
    (
      await c.env.DB.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE environment = ? AND event_name = 'server_error' AND timestamp >= ? AND timestamp < ?")
        .bind(c.env.ENVIRONMENT, dayStart(from), dayStart(addDays(to, 1)))
        .first<{ n: number }>()
    )?.n ?? 0;
  // retention of the players registered in the last 60 days (finished days only)
  const cohorts = await retentionCohorts(c.env, addDays(p.to, -59), p.to, {}, now);
  const { series: _s, ...curRest } = cur;
  const { series: _p, ...prevRest } = prev;
  void _s;
  void _p;
  return c.json({
    period: p,
    previous: { from: prevFrom, to: prevTo },
    today: jstDateKey(now),
    totals: { ...totals },
    current: { ...curRest, ...(await dauWauMau(c.env, p.to, {})), gemsSpent: await spent(p.from, p.to), errors: await errors(p.from, p.to) },
    before: { ...prevRest, ...(await dauWauMau(c.env, prevTo, {})), gemsSpent: await spent(prevFrom, prevTo), errors: await errors(prevFrom, prevTo) },
    series: cur.series,
    retention: averageRetention(cohorts),
    revenue: await revenueSummary(c.env, p.from, p.to),
  });
});

adminInsightRoutes.get('/analytics', requirePermission('analytics.read'), async (c) => {
  const now = Date.now();
  await refreshDailyMetrics(c.env, now);
  const q = c.req.query();
  const p = periodOf(q, now);
  const f = filterOf(q);
  const cur = await summary(c.env, p.from, p.to, f);
  const w = metricsWhere(f);
  const modes = await c.env.DB.prepare(
    `SELECT j.key AS mode, SUM(j.value) AS n FROM daily_user_metrics m, json_each(m.modes_json) j
      WHERE m.day_key BETWEEN ? AND ? AND m.modes_json IS NOT NULL${w.sql} GROUP BY j.key ORDER BY n DESC`,
  )
    .bind(p.from, p.to, ...w.binds)
    .all<{ mode: string; n: number }>();
  // first league: share of players registered in the period who finished at least one match
  const uw = usersWhere(f);
  const first = await c.env.DB.prepare(
    `SELECT COUNT(*) AS registered,
            SUM(EXISTS (SELECT 1 FROM daily_user_metrics x WHERE x.user_id = u.id AND x.matches_completed > 0)) AS played
       FROM users u WHERE u.created_at >= ? AND u.created_at < ?${uw.sql}`,
  )
    .bind(dayStart(p.from), dayStart(addDays(p.to, 1)), ...uw.binds)
    .first<{ registered: number; played: number | null }>();
  // churn: active in the previous period of the same length but not in this one
  const prevTo = addDays(p.from, -1);
  const prevFrom = addDays(prevTo, -(p.days - 1));
  const churn = await c.env.DB.prepare(
    `SELECT COUNT(*) AS before, SUM(NOT EXISTS (SELECT 1 FROM daily_user_metrics n WHERE n.user_id = b.user_id AND n.day_key BETWEEN ? AND ?)) AS gone
       FROM (SELECT DISTINCT m.user_id FROM daily_user_metrics m WHERE m.day_key BETWEEN ? AND ?${w.sql}) b`,
  )
    .bind(p.from, p.to, prevFrom, prevTo, ...w.binds)
    .first<{ before: number; gone: number | null }>();
  const options = await c.env.DB.prepare(
    "SELECT DISTINCT platform, app_version FROM daily_user_metrics WHERE day_key >= ? AND (platform IS NOT NULL OR app_version IS NOT NULL)",
  )
    .bind(addDays(p.to, -90))
    .all<{ platform: string | null; app_version: string | null }>();
  const cohorts = await retentionCohorts(c.env, p.from, p.to, f, now);
  return c.json({
    period: p,
    filter: f,
    ...cur,
    ...(await dauWauMau(c.env, p.to, f)),
    modes: modes.results,
    firstMatch: { registered: first?.registered ?? 0, played: first?.played ?? 0, rate: pct(first?.played ?? 0, first?.registered ?? 0) },
    churn: { previousActive: churn?.before ?? 0, notReturned: churn?.gone ?? 0, rate: pct(churn?.gone ?? 0, churn?.before ?? 0) },
    retention: averageRetention(cohorts),
    options: {
      platforms: [...new Set(options.results.map((o) => o.platform).filter(Boolean))],
      versions: [...new Set(options.results.map((o) => o.app_version).filter(Boolean))],
    },
  });
});

adminInsightRoutes.get('/retention', requirePermission('analytics.read'), async (c) => {
  const now = Date.now();
  await refreshDailyMetrics(c.env, now);
  const q = c.req.query();
  const p = periodOf({ from: q.from ?? addDays(jstDateKey(now), -44), to: q.to }, now);
  const f = filterOf(q);
  const cohorts = await retentionCohorts(c.env, p.from, p.to, f, now);
  // comparison groups (spec 12-6: friend testers vs everyone else)
  const groups = q.compare === '0' ? null : {
    friend_tester: averageRetention(await retentionCohorts(c.env, p.from, p.to, { tag: 'friend_tester' }, now)),
    beta_tester: averageRetention(await retentionCohorts(c.env, p.from, p.to, { tag: 'beta_tester' }, now)),
    normal: averageRetention(await retentionCohorts(c.env, p.from, p.to, { tag: 'normal' }, now)),
  };
  return c.json({ period: p, filter: f, days: RETENTION_DAYS, cohorts, average: averageRetention(cohorts), groups, timezone: 'Asia/Tokyo' });
});

adminInsightRoutes.get('/economy', requirePermission('economy.read'), async (c) => {
  const p = periodOf(c.req.query());
  const fromMs = dayStart(p.from);
  const toMs = dayStart(addDays(p.to, 1));
  const byReason = await c.env.DB.prepare(
    `SELECT currency, reason, COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) AS issued, COALESCE(-SUM(CASE WHEN amount < 0 THEN amount END), 0) AS spent, COUNT(*) AS n
       FROM currency_transactions WHERE created_at >= ? AND created_at < ? GROUP BY currency, reason ORDER BY currency, reason`,
  )
    .bind(fromMs, toMs)
    .all<{ currency: string; reason: string; issued: number; spent: number; n: number }>();
  const points = await c.env.DB.prepare(
    `SELECT point_type, reason, COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) AS issued, COALESCE(-SUM(CASE WHEN amount < 0 THEN amount END), 0) AS spent
       FROM exchange_transactions WHERE created_at >= ? AND created_at < ? GROUP BY point_type, reason`,
  )
    .bind(fromMs, toMs)
    .all<{ point_type: string; reason: string; issued: number; spent: number }>();
  const outstanding = await c.env.DB.prepare(
    `SELECT COUNT(*) AS wallets, COALESCE(SUM(coins), 0) AS COINS, COALESCE(SUM(gems_free), 0) AS GEMS_FREE,
            COALESCE(SUM(gems_paid_purchased), 0) AS GEMS_PAID_PURCHASED, COALESCE(SUM(gems_paid_granted), 0) AS GEMS_PAID_GRANTED,
            (SELECT COALESCE(SUM(standard_points), 0) FROM exchange_wallets) AS standard_points,
            (SELECT COALESCE(SUM(premium_points), 0) FROM exchange_wallets) AS premium_points
       FROM currency_wallets`,
  ).first<Record<string, number>>();
  const gacha = await c.env.DB.prepare(
    `SELECT d.banner_id, b.name, COUNT(*) AS draws, COALESCE(SUM(d.draw_count), 0) AS cards, d.cost_currency, COALESCE(SUM(d.cost_amount), 0) AS cost, COUNT(DISTINCT d.user_id) AS players
       FROM gacha_draws d JOIN gacha_banners b ON b.id = d.banner_id WHERE d.created_at >= ? AND d.created_at < ? GROUP BY d.banner_id`,
  )
    .bind(fromMs, toMs)
    .all();
  const daily = await c.env.DB.prepare(
    `SELECT date((created_at + 32400000) / 1000, 'unixepoch') AS day, currency,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) AS issued, COALESCE(-SUM(CASE WHEN amount < 0 THEN amount END), 0) AS spent
       FROM currency_transactions WHERE created_at >= ? AND created_at < ? GROUP BY day, currency ORDER BY day`,
  )
    .bind(fromMs, toMs)
    .all<{ day: string; currency: string; issued: number; spent: number }>();
  const totals = Object.fromEntries(
    CURRENCIES.map((cur) => {
      const rows = byReason.results.filter((r) => r.currency === cur);
      return [cur, { issued: rows.reduce((s, r) => s + r.issued, 0), spent: rows.reduce((s, r) => s + r.spent, 0) }];
    }),
  );
  // spending per player (individual information: only with users.read)
  const top = can(c.get('admin').role, 'users.read')
    ? (
        await c.env.DB.prepare(
          `SELECT t.user_id, u.username, u.display_name, -SUM(t.amount) AS spent FROM currency_transactions t JOIN users u ON u.id = t.user_id
            WHERE t.amount < 0 AND t.currency LIKE 'GEMS%' AND t.created_at >= ? AND t.created_at < ? GROUP BY t.user_id ORDER BY spent DESC LIMIT 20`,
        )
          .bind(fromMs, toMs)
          .all()
      ).results
    : null;
  return c.json({ period: p, totals, byReason: byReason.results, points: points.results, outstanding, gacha: gacha.results, daily: daily.results, topGemSpenders: top, purchases: { implemented: false } });
});
