import { Hono } from 'hono';
import { audit, ipOf } from '../lib/audit';
import { can, requirePermission } from '../lib/auth';
import { randomId } from '../lib/crypto';
import { ApiError, readJson } from '../lib/http';
import { activeUsers, addDays, dayStart, periodOf, refreshDailyMetrics } from '../lib/metrics';
import { refundPurchase, renewSubscription, storeStatus, type ProductRow } from '../lib/purchases';
import type { AppEnv } from '../env';

/**
 * Products, purchases, refunds, subscriptions and revenue for the admin site
 * (spec 11-5, 12-8; decisions 52-57).
 */
export const adminShopRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------- products

adminShopRoutes.get('/products', async (c) => {
  const a = c.get('admin');
  if (!can(a.role, 'revenue.read') && !can(a.role, 'products.write') && !can(a.role, 'purchases.read')) throw new ApiError('FORBIDDEN', 'permission denied');
  const rows = await c.env.DB.prepare('SELECT * FROM purchase_products ORDER BY sort_order').all<ProductRow>();
  return c.json({ items: rows.results, stores: storeStatus(c.env) });
});

const PRODUCT_FIELDS = ['name', 'price_jpy', 'gems_base', 'gems_bonus', 'first_time_bonus', 'apple_product_id', 'google_product_id', 'active', 'sort_order'] as const;

/** price, GEMS, store product ids, on sale or not (past purchases keep their own values) */
adminShopRoutes.patch('/products/:id', requirePermission('products.write'), async (c) => {
  const a = c.get('admin');
  const before = await c.env.DB.prepare('SELECT * FROM purchase_products WHERE id = ?').bind(c.req.param('id')).first<ProductRow>();
  if (!before) throw new ApiError('NOT_FOUND', 'product not found');
  const body = await readJson<Record<string, unknown>>(c);
  const next: Record<string, unknown> = {};
  for (const f of PRODUCT_FIELDS) {
    if (body[f] === undefined) continue;
    const v = body[f];
    if (f === 'name') {
      if (typeof v !== 'string' || !v.trim() || v.length > 60) throw new ApiError('BAD_REQUEST', 'name: 1-60 characters');
      next[f] = v.trim();
    } else if (f === 'apple_product_id' || f === 'google_product_id') {
      if (v !== null && (typeof v !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(v))) throw new ApiError('BAD_REQUEST', `${f}: letters, digits, . _ -`);
      next[f] = v || null;
    } else if (f === 'active') {
      next[f] = v ? 1 : 0;
    } else {
      const n = Number(v);
      const max = f === 'price_jpy' ? 100_000 : 1_000_000;
      if (!Number.isInteger(n) || n < (f === 'price_jpy' ? 1 : 0) || n > max) throw new ApiError('BAD_REQUEST', `${f}: integer 0-${max}`);
      next[f] = n;
    }
  }
  if (Object.keys(next).length === 0) throw new ApiError('BAD_REQUEST', 'nothing to change');
  // GEMS packs: the purchased part equals the price (decision 53: 1 yen = 1 GEMS)
  const price = (next.price_jpy as number | undefined) ?? before.price_jpy;
  const base = (next.gems_base as number | undefined) ?? before.gems_base;
  if (before.kind === 'gems' && base !== price) throw new ApiError('BAD_REQUEST', 'for GEMS packs the purchased GEMS must equal the price in yen (decision 53); put extra GEMS in the bonus');
  const sets = Object.keys(next).map((k) => `${k} = ?`);
  await c.env.DB.prepare(`UPDATE purchase_products SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...Object.values(next), Date.now(), before.id).run();
  const changed = Object.fromEntries(Object.keys(next).map((k) => [k, [before[k as keyof ProductRow], next[k]]]));
  await audit(c.env, a.id, 'product_updated', { type: 'product', id: before.id }, changed, ipOf(c));
  return c.json({ product: await c.env.DB.prepare('SELECT * FROM purchase_products WHERE id = ?').bind(before.id).first() });
});

// ---------------------------------------------------------------- purchases

adminShopRoutes.get('/purchases', requirePermission('purchases.read'), async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.status && ['started', 'completed', 'failed', 'refunded'].includes(q.status)) {
    where.push('t.status = ?');
    binds.push(q.status);
  }
  if (q.store && ['mock', 'apple', 'google'].includes(q.store)) {
    where.push('t.store = ?');
    binds.push(q.store);
  }
  if (q.q) {
    where.push('(u.username LIKE ? OR t.id = ? OR t.store_transaction_id = ?)');
    binds.push(`%${q.q}%`, q.q, q.q);
  }
  const limit = Math.min(Math.max(Number(q.limit ?? 100) || 100, 1), 200);
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.user_id, u.username, u.display_name, t.product_id, p.name AS product_name, t.store, t.status, t.store_transaction_id, t.price_jpy,
            t.gems_purchased, t.gems_granted, t.receipt_status, t.failure_reason, t.store_environment, t.is_renewal, t.created_at, t.completed_at, t.refunded_at
       FROM purchase_transactions t JOIN users u ON u.id = t.user_id JOIN purchase_products p ON p.id = t.product_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.created_at DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all();
  return c.json({ items: rows.results, mockActions: storeStatus(c.env).mock.available });
});

adminShopRoutes.get('/purchases/:id', requirePermission('purchases.read'), async (c) => {
  const id = c.req.param('id');
  const tx = await c.env.DB.prepare(
    `SELECT t.*, u.username, u.display_name, p.name AS product_name, p.kind AS product_kind FROM purchase_transactions t
       JOIN users u ON u.id = t.user_id JOIN purchase_products p ON p.id = t.product_id WHERE t.id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!tx) throw new ApiError('NOT_FOUND', 'purchase not found');
  const [receipts, refunds, subs] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, store, receipt_sha256, result, detail_json, created_at FROM purchase_receipts WHERE transaction_id = ? ORDER BY created_at').bind(id),
    c.env.DB.prepare('SELECT r.*, a.username AS resolved_by_name FROM refund_records r LEFT JOIN admin_users a ON a.id = r.resolved_by WHERE r.transaction_id = ?').bind(id),
    c.env.DB.prepare('SELECT * FROM subscriptions WHERE store = ? AND original_transaction_id = ?').bind(tx.store, tx.original_transaction_id ?? '-'),
  ]);
  return c.json({ purchase: tx, receipts: receipts.results, refund: refunds.results[0] ?? null, subscription: subs.results[0] ?? null, mockActions: storeStatus(c.env).mock.available });
});

/** staging / local: the mock store reports a refund (in production refunds come from the stores) */
adminShopRoutes.post('/purchases/:id/mock-refund', requirePermission('purchases.write'), async (c) => {
  if (!storeStatus(c.env).mock.available) throw new ApiError('FORBIDDEN', 'mock store actions are disabled in production');
  const a = c.get('admin');
  const tx = await c.env.DB.prepare('SELECT store FROM purchase_transactions WHERE id = ?').bind(c.req.param('id')).first<{ store: string }>();
  if (!tx) throw new ApiError('NOT_FOUND', 'purchase not found');
  if (tx.store !== 'mock') throw new ApiError('FORBIDDEN', 'only mock store purchases can be refunded from here');
  const r = await refundPurchase(c.env, c.req.param('id'), 'mock_store_refund');
  await audit(c.env, a.id, 'mock_refund', { type: 'purchase', id: c.req.param('id') }, { ...r }, ipOf(c));
  return c.json(r);
});

adminShopRoutes.get('/refunds', requirePermission('purchases.read'), async (c) => {
  const status = c.req.query('status');
  const rows = await c.env.DB.prepare(
    `SELECT r.*, u.username, t.product_id, a.username AS resolved_by_name FROM refund_records r JOIN users u ON u.id = r.user_id
       JOIN purchase_transactions t ON t.id = r.transaction_id LEFT JOIN admin_users a ON a.id = r.resolved_by
      ${status && ['settled', 'shortfall', 'resolved'].includes(status) ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC LIMIT 200`,
  )
    .bind(...(status && ['settled', 'shortfall', 'resolved'].includes(status) ? [status] : []))
    .all();
  return c.json({ items: rows.results });
});

/** decision 57: the operator decides what to do with a shortfall and records it */
adminShopRoutes.post('/refunds/:id/resolve', requirePermission('purchases.write'), async (c) => {
  const a = c.get('admin');
  const note = String((await readJson(c)).note ?? '').trim().slice(0, 500);
  if (!note) throw new ApiError('BAD_REQUEST', 'note is required');
  const r = await c.env.DB.prepare("UPDATE refund_records SET status = 'resolved', resolved_by = ?, resolution_note = ?, resolved_at = ? WHERE id = ? AND status = 'shortfall'")
    .bind(a.id, note, Date.now(), c.req.param('id'))
    .run();
  if (r.meta.changes !== 1) throw new ApiError('CONFLICT', 'only an open shortfall can be resolved');
  await audit(c.env, a.id, 'refund_shortfall_resolved', { type: 'refund', id: c.req.param('id') }, { note }, ipOf(c));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- subscriptions (membership)

adminShopRoutes.get('/subscriptions', requirePermission('purchases.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.*, u.username, u.display_name, (SELECT COUNT(*) FROM purchase_transactions t WHERE t.store = s.store AND t.original_transaction_id = s.original_transaction_id AND t.status = 'completed') AS payments
       FROM subscriptions s JOIN users u ON u.id = s.user_id ORDER BY s.updated_at DESC LIMIT 200`,
  ).all();
  return c.json({ items: rows.results, now: Date.now(), mockActions: storeStatus(c.env).mock.available });
});

/** staging / local: the mock store reports a renewal, a cancellation or an expiry */
adminShopRoutes.post('/subscriptions/:id/mock/:action', requirePermission('purchases.write'), async (c) => {
  if (!storeStatus(c.env).mock.available) throw new ApiError('FORBIDDEN', 'mock store actions are disabled in production');
  const a = c.get('admin');
  const id = c.req.param('id');
  const action = c.req.param('action');
  const sub = await c.env.DB.prepare('SELECT id, store, status FROM subscriptions WHERE id = ?').bind(id).first<{ id: string; store: string; status: string }>();
  if (!sub) throw new ApiError('NOT_FOUND', 'subscription not found');
  if (sub.store !== 'mock') throw new ApiError('FORBIDDEN', 'only mock store subscriptions');
  const now = Date.now();
  if (action === 'renew') await renewSubscription(c.env, id, `mock-${randomId(10)}`);
  else if (action === 'cancel') await c.env.DB.prepare('UPDATE subscriptions SET auto_renew = 0, updated_at = ? WHERE id = ?').bind(now, id).run();
  else if (action === 'expire')
    await c.env.DB.prepare("UPDATE subscriptions SET status = 'expired', auto_renew = 0, current_period_end = MIN(current_period_end, ?), updated_at = ? WHERE id = ? AND status = 'active'")
      .bind(now, now, id)
      .run();
  else throw new ApiError('BAD_REQUEST', 'action must be renew, cancel or expire');
  await audit(c.env, a.id, `mock_subscription_${action}`, { type: 'subscription', id }, undefined, ipOf(c));
  return c.json({ subscription: await c.env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first() });
});

// ---------------------------------------------------------------- revenue (spec 11-5)

adminShopRoutes.get('/revenue', requirePermission('revenue.read'), async (c) => {
  const now = Date.now();
  await refreshDailyMetrics(c.env, now);
  const q = c.req.query();
  const p = periodOf(q, now);
  const fromMs = dayStart(p.from);
  const toMs = dayStart(addDays(p.to, 1));
  const unit = q.unit === 'week' ? 'week' : q.unit === 'month' ? 'month' : 'day';
  const bucket =
    unit === 'month'
      ? "substr(date((completed_at + 32400000) / 1000, 'unixepoch'), 1, 7)"
      : unit === 'week'
        ? "date((completed_at + 32400000) / 1000, 'unixepoch', '-6 days', 'weekday 1')"
        : "date((completed_at + 32400000) / 1000, 'unixepoch')";
  const paid = "status IN ('completed', 'refunded') AND completed_at >= ?1 AND completed_at < ?2";
  const totals = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(price_jpy), 0) AS gross, COUNT(*) AS purchases, COUNT(DISTINCT user_id) AS payers,
            COALESCE(SUM(CASE WHEN store = 'mock' THEN price_jpy END), 0) AS mock_gross
       FROM purchase_transactions WHERE ${paid}`,
  )
    .bind(fromMs, toMs)
    .first<{ gross: number; purchases: number; payers: number; mock_gross: number }>();
  const refunds = await c.env.DB.prepare('SELECT COALESCE(SUM(amount_jpy), 0) AS amount, COUNT(*) AS n, COALESCE(SUM(shortfall), 0) AS shortfall FROM refund_records WHERE created_at >= ? AND created_at < ?')
    .bind(fromMs, toMs)
    .first<{ amount: number; n: number; shortfall: number }>();
  const series = await c.env.DB.prepare(`SELECT ${bucket} AS bucket, SUM(price_jpy) AS gross, COUNT(*) AS n FROM purchase_transactions WHERE ${paid} GROUP BY bucket ORDER BY bucket`)
    .bind(fromMs, toMs)
    .all<{ bucket: string; gross: number; n: number }>();
  const byProduct = await c.env.DB.prepare(
    `SELECT t.product_id, p.name, COUNT(*) AS n, COUNT(DISTINCT t.user_id) AS buyers, SUM(t.price_jpy) AS gross FROM purchase_transactions t JOIN purchase_products p ON p.id = t.product_id
      WHERE t.status IN ('completed', 'refunded') AND t.completed_at >= ?1 AND t.completed_at < ?2 GROUP BY t.product_id ORDER BY gross DESC`,
  )
    .bind(fromMs, toMs)
    .all<{ product_id: string; name: string; n: number; buyers: number; gross: number }>();
  const byStore = await c.env.DB.prepare(`SELECT store, COUNT(*) AS n, SUM(price_jpy) AS gross FROM purchase_transactions WHERE ${paid} GROUP BY store`).bind(fromMs, toMs).all();
  const attempts = await c.env.DB.prepare(
    "SELECT COUNT(*) AS started, SUM(status = 'failed') AS failed FROM purchase_transactions WHERE is_renewal = 0 AND created_at >= ? AND created_at < ?",
  )
    .bind(fromMs, toMs)
    .first<{ started: number; failed: number | null }>();
  // players whose first ever purchase is in the period
  const firstPayers = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM (SELECT user_id, MIN(completed_at) AS first FROM purchase_transactions WHERE status IN ('completed', 'refunded') GROUP BY user_id) WHERE first >= ? AND first < ?`,
  )
    .bind(fromMs, toMs)
    .first<{ n: number }>();
  // purchased PAID GEMS spent on each gacha (1 GEMS = 1 yen of sales, decision 53)
  const gacha = await c.env.DB.prepare(
    `SELECT d.banner_id, b.name, -SUM(t.amount) AS purchased_gems FROM currency_transactions t JOIN gacha_draws d ON d.id = t.ref_id JOIN gacha_banners b ON b.id = d.banner_id
      WHERE t.reason = 'gacha' AND t.currency = 'GEMS_PAID_PURCHASED' AND t.created_at >= ? AND t.created_at < ? GROUP BY d.banner_id`,
  )
    .bind(fromMs, toMs)
    .all();
  const unused = await c.env.DB.prepare('SELECT COALESCE(SUM(gems_paid_purchased), 0) AS purchased, COALESCE(SUM(gems_paid_granted), 0) AS granted FROM currency_wallets').first<{ purchased: number; granted: number }>();
  const openShortfalls = await c.env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(shortfall), 0) AS gems FROM refund_records WHERE status = 'shortfall'").first<{ n: number; gems: number }>();
  const active = await activeUsers(c.env, p.from, p.to);
  const gross = totals?.gross ?? 0;
  const net = gross - (refunds?.amount ?? 0);
  const payers = totals?.payers ?? 0;
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
  return c.json({
    period: p,
    unit,
    gross,
    refunds: refunds?.amount ?? 0,
    refundCount: refunds?.n ?? 0,
    net,
    purchases: totals?.purchases ?? 0,
    payers,
    activeUsers: active,
    payerRate: ratio(payers, active),
    arpu: ratio(net, active),
    arppu: ratio(net, payers),
    firstPayers: firstPayers?.n ?? 0,
    firstPurchaseRate: ratio(firstPayers?.n ?? 0, active),
    failureRate: ratio(attempts?.failed ?? 0, attempts?.started ?? 0),
    attempts: attempts?.started ?? 0,
    series: series.results,
    byProduct: byProduct.results.map((r) => ({ ...r, purchaseRate: ratio(r.buyers, active) })),
    byStore: byStore.results,
    gacha: gacha.results,
    unusedPaidGems: unused,
    openShortfalls,
    mockGross: totals?.mock_gross ?? 0,
    stores: storeStatus(c.env),
  });
});
