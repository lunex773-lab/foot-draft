import type { Store } from '@fd/shared';
import type { Env } from '../env';
import { analyticsWhen, currencyStmts, ensureWalletStmts, rewardStmts, runOperation, walletOf } from './economy';
import { fromB64Url, hmacSha256, randomId, safeEqual, sha256Hex, toB64Url } from './crypto';
import { ApiError } from './http';

/**
 * Purchases (spec 11, 12-8, 20-3; decisions 52-57).
 *
 * - A purchase is started by the game, paid in the store, then the game sends
 *   the receipt and the server verifies it before granting anything.
 * - One grant per store transaction: UNIQUE (store, store_transaction_id) and
 *   reward_claims keys ("purchase:<store>:<transaction>").
 * - The mock store (not in production) signs its receipts on the server, so a
 *   client cannot make one up. Apple / Google are not connected yet.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProductRow {
  id: string;
  kind: 'gems' | 'membership';
  name: string;
  price_jpy: number;
  gems_base: number;
  gems_bonus: number;
  first_time_bonus: number;
  period_days: number | null;
  apple_product_id: string | null;
  google_product_id: string | null;
  active: number;
  sort_order: number;
}

export interface TxRow {
  id: string;
  user_id: string;
  product_id: string;
  store: Store;
  status: 'started' | 'completed' | 'failed' | 'refunded';
  store_transaction_id: string | null;
  original_transaction_id: string | null;
  price_jpy: number;
  gems_purchased: number;
  gems_granted: number;
  receipt_status: string;
  store_environment: string;
  is_renewal: number;
  created_at: number;
  completed_at: number | null;
  refunded_at: number | null;
}

export async function productById(env: Env, id: string): Promise<ProductRow | null> {
  return env.DB.prepare('SELECT * FROM purchase_products WHERE id = ?').bind(id).first<ProductRow>();
}

/** which stores can take purchases in this environment */
export function storeStatus(env: Env): Record<Store, { available: boolean; reason?: string }> {
  return {
    mock: env.ENVIRONMENT === 'production' ? { available: false, reason: 'production' } : { available: true },
    // decision 52: connected once the iOS / Android apps and the store settings exist
    apple: { available: false, reason: 'not_connected' },
    google: { available: false, reason: 'not_connected' },
  };
}

// ---------------------------------------------------------------- mock store

export interface MockReceipt {
  v: 1;
  type: 'purchase';
  /** store transaction id */
  tx: string;
  /** original transaction id (subscriptions keep the first one) */
  otx: string;
  product: string;
  user: string;
  purchase: string;
  at: number;
}

const mockKey = (env: Env) => `${env.WS_TICKET_SECRET}:mock-store-v1`;

export async function signMockReceipt(env: Env, r: MockReceipt): Promise<string> {
  const payload = toB64Url(new TextEncoder().encode(JSON.stringify(r)));
  return `${payload}.${await hmacSha256(mockKey(env), payload)}`;
}

async function readMockReceipt(env: Env, receipt: string): Promise<MockReceipt | null> {
  const [payload, sig] = receipt.split('.');
  if (!payload || !sig) return null;
  if (!safeEqual(await hmacSha256(mockKey(env), payload), sig)) return null;
  try {
    const r = JSON.parse(new TextDecoder().decode(fromB64Url(payload))) as MockReceipt;
    return r.v === 1 && r.type === 'purchase' ? r : null;
  } catch {
    return null;
  }
}

export type Verification =
  | { ok: true; storeTransactionId: string; originalTransactionId: string; productId: string; userId: string; purchaseId: string; environment: 'sandbox' | 'production' }
  | { ok: false; result: 'invalid' | 'not_connected'; reason: string };

/** verification per store (Apple / Google: connection point only, decision 52) */
export async function verifyReceipt(env: Env, store: Store, receipt: string): Promise<Verification> {
  if (store === 'mock') {
    if (!storeStatus(env).mock.available) return { ok: false, result: 'invalid', reason: 'the mock store is disabled in production' };
    const r = await readMockReceipt(env, receipt);
    if (!r) return { ok: false, result: 'invalid', reason: 'bad signature' };
    return { ok: true, storeTransactionId: r.tx, originalTransactionId: r.otx, productId: r.product, userId: r.user, purchaseId: r.purchase, environment: 'sandbox' };
  }
  // App Store Server API / Google Play Developer API are called here once connected
  return { ok: false, result: 'not_connected', reason: `${store} is not connected yet` };
}

// ---------------------------------------------------------------- membership

export interface MembershipView {
  active: boolean;
  subscriptionId: string | null;
  autoRenew: boolean;
  periodEnd: number | null;
}

export async function membershipOf(env: Env, userId: string, now = Date.now()): Promise<MembershipView> {
  const s = await env.DB.prepare(
    "SELECT id, auto_renew, current_period_end FROM subscriptions WHERE user_id = ? AND status = 'active' AND current_period_end > ? ORDER BY current_period_end DESC LIMIT 1",
  )
    .bind(userId, now)
    .first<{ id: string; auto_renew: number; current_period_end: number }>();
  return s ? { active: true, subscriptionId: s.id, autoRenew: !!s.auto_renew, periodEnd: s.current_period_end } : { active: false, subscriptionId: null, autoRenew: false, periodEnd: null };
}

/** user ids with an active membership (badges) */
export async function membersAmong(env: Env, userIds: string[], now = Date.now()): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await env.DB.prepare(
    `SELECT DISTINCT user_id FROM subscriptions WHERE status = 'active' AND current_period_end > ? AND user_id IN (${userIds.map(() => '?').join(',')})`,
  )
    .bind(now, ...userIds)
    .all<{ user_id: string }>();
  return new Set(rows.results.map((r) => r.user_id));
}

// ---------------------------------------------------------------- completing a purchase

/**
 * Verified receipt -> grant (one D1 batch). Returns the stored transaction.
 * A receipt can only complete the purchase it was issued for, once.
 */
export async function completePurchase(env: Env, tx: TxRow, product: ProductRow, v: Extract<Verification, { ok: true }>, receipt: string): Promise<TxRow> {
  const now = Date.now();
  const opId = randomId();
  const userId = tx.user_id;
  const keyBase = `${tx.store}:${v.storeTransactionId}`;
  const stmts: D1PreparedStatement[] = [
    // fails on the UNIQUE (store, store_transaction_id) if this store transaction was used before
    env.DB.prepare(
      "UPDATE purchase_transactions SET status = 'completed', store_transaction_id = ?, original_transaction_id = ?, receipt_status = 'verified', store_environment = ?, completed_at = ?, gems_purchased = ? WHERE id = ? AND status = 'started'",
    ).bind(v.storeTransactionId, v.originalTransactionId, v.environment, now, product.gems_base, tx.id),
    env.DB.prepare('INSERT INTO purchase_receipts (id, transaction_id, store, receipt_sha256, result, detail_json, created_at) VALUES (?,?,?,?,?,?,?)').bind(
      randomId(),
      tx.id,
      tx.store,
      await sha256Hex(receipt),
      'verified',
      JSON.stringify({ storeTransactionId: v.storeTransactionId, environment: v.environment }),
      now,
    ),
    ...ensureWalletStmts(env, userId, now),
  ];
  const grant = (key: string, kind: string, currency: 'GEMS_PAID_PURCHASED' | 'GEMS_PAID_GRANTED', amount: number) =>
    amount > 0 ? rewardStmts(env, { userId, key, kind, currency, amount, refType: 'purchase', refId: tx.id, opId, now }, undefined, { analytics: false }) : [];
  if (product.kind === 'gems') {
    stmts.push(
      ...grant(`purchase:${keyBase}`, 'purchase', 'GEMS_PAID_PURCHASED', product.gems_base),
      ...grant(`purchase-bonus:${keyBase}`, 'purchase_bonus', 'GEMS_PAID_GRANTED', product.gems_bonus),
      // the first-time bonus is paid once per player and product
      ...grant(`first-purchase:${product.id}`, 'purchase_bonus', 'GEMS_PAID_GRANTED', product.first_time_bonus),
      env.DB.prepare(
        `UPDATE purchase_transactions SET gems_granted = ?1 + COALESCE((SELECT amount FROM reward_claims WHERE user_id = ?2 AND reward_key = ?3 AND op_id = ?4), 0) WHERE id = ?5`,
      ).bind(product.gems_bonus, userId, `first-purchase:${product.id}`, opId, tx.id),
    );
  } else {
    // membership: a new subscription chain for 30 days
    const days = product.period_days ?? 30;
    stmts.push(
      env.DB.prepare(
        "INSERT INTO subscriptions (id, user_id, product_id, store, original_transaction_id, status, auto_renew, current_period_start, current_period_end, created_at, updated_at) VALUES (?,?,?,?,?,'active',1,?,?,?,?)",
      ).bind(randomId(), userId, product.id, tx.store, v.originalTransactionId, now, now + days * DAY_MS, now, now),
      analyticsWhen(env, 'membership_started', userId, { productId: product.id, store: tx.store }, now),
    );
  }
  stmts.push(analyticsWhen(env, 'purchase_completed', userId, { purchaseId: tx.id, productId: product.id, store: tx.store, priceJpy: tx.price_jpy, environment: v.environment }, now));
  await env.DB.batch(stmts);
  return (await env.DB.prepare('SELECT * FROM purchase_transactions WHERE id = ?').bind(tx.id).first<TxRow>())!;
}

// ---------------------------------------------------------------- renewals (subscriptions)

/** a renewal reported by the store: a new completed transaction and 30 more days */
export async function renewSubscription(env: Env, subscriptionId: string, storeTransactionId: string): Promise<void> {
  const sub = await env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(subscriptionId).first<{
    id: string;
    user_id: string;
    product_id: string;
    store: Store;
    original_transaction_id: string;
    status: string;
    auto_renew: number;
    current_period_end: number;
  }>();
  if (!sub) throw new ApiError('NOT_FOUND', 'subscription not found');
  if (sub.status !== 'active' || !sub.auto_renew) throw new ApiError('CONFLICT', 'only an active, auto-renewing subscription renews');
  const product = (await productById(env, sub.product_id))!;
  const now = Date.now();
  const start = Math.max(now, sub.current_period_end);
  const txId = randomId();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO purchase_transactions (id, user_id, product_id, store, status, store_transaction_id, original_transaction_id, price_jpy, receipt_status, store_environment, is_renewal, created_at, completed_at)
       VALUES (?,?,?,?,'completed',?,?,?,'verified',?,1,?,?)`,
    ).bind(txId, sub.user_id, product.id, sub.store, storeTransactionId, sub.original_transaction_id, product.price_jpy, sub.store === 'mock' ? 'sandbox' : 'production', now, now),
    env.DB.prepare('UPDATE subscriptions SET current_period_start = ?, current_period_end = ?, updated_at = ? WHERE id = ?').bind(start, start + (product.period_days ?? 30) * DAY_MS, now, sub.id),
    analyticsWhen(env, 'purchase_completed', sub.user_id, { purchaseId: txId, productId: product.id, store: sub.store, priceJpy: product.price_jpy, renewal: true }, now),
  ]);
}

// ---------------------------------------------------------------- refunds (decision 57)

export interface RefundResult {
  refundId: string;
  gemsToRecover: number;
  gemsRecovered: number;
  shortfall: number;
}

/**
 * Takes back the GEMS of a refunded purchase: what is left of the purchased
 * part from the purchased balance, the bonus from the distributed balance;
 * what cannot be taken back is recorded as a shortfall. A refunded membership
 * ends at once. Runs once per transaction.
 */
export async function refundPurchase(env: Env, transactionId: string, reason: string): Promise<RefundResult> {
  const tx = await env.DB.prepare('SELECT * FROM purchase_transactions WHERE id = ?').bind(transactionId).first<TxRow>();
  if (!tx) throw new ApiError('NOT_FOUND', 'purchase not found');
  return runOperation<RefundResult>(env, tx.user_id, `refund-${transactionId}`, 'refund', async ({ opId, now }) => {
    const cur = (await env.DB.prepare('SELECT status FROM purchase_transactions WHERE id = ?').bind(transactionId).first<{ status: string }>())!;
    if (cur.status !== 'completed') throw new ApiError('CONFLICT', `the purchase is ${cur.status}`);
    const w = await walletOf(env, tx.user_id);
    const fromPurchased = Math.min(tx.gems_purchased, w.gems.paidPurchased);
    const fromGranted = Math.min(tx.gems_granted, w.gems.paidGranted);
    const toRecover = tx.gems_purchased + tx.gems_granted;
    const recovered = fromPurchased + fromGranted;
    const shortfall = toRecover - recovered;
    const refundId = randomId();
    const change = { userId: tx.user_id, reason: 'refund', refType: 'purchase', refId: tx.id, opId, now };
    const statements: D1PreparedStatement[] = [
      ...(fromPurchased > 0 ? currencyStmts(env, { ...change, currency: 'GEMS_PAID_PURCHASED', amount: -fromPurchased }) : []),
      ...(fromGranted > 0 ? currencyStmts(env, { ...change, currency: 'GEMS_PAID_GRANTED', amount: -fromGranted }) : []),
      env.DB.prepare("UPDATE purchase_transactions SET status = 'refunded', refunded_at = ? WHERE id = ? AND status = 'completed'").bind(now, tx.id),
      env.DB.prepare(
        'INSERT INTO refund_records (id, transaction_id, user_id, amount_jpy, gems_to_recover, gems_recovered, shortfall, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      ).bind(refundId, tx.id, tx.user_id, tx.price_jpy, toRecover, recovered, shortfall, shortfall > 0 ? 'shortfall' : 'settled', now),
      // a refunded membership ends now
      env.DB.prepare(
        "UPDATE subscriptions SET status = 'refunded', auto_renew = 0, current_period_end = MIN(current_period_end, ?), updated_at = ? WHERE store = ? AND original_transaction_id = ? AND status = 'active'",
      ).bind(now, now, tx.store, tx.original_transaction_id ?? '-'),
      analyticsWhen(env, 'purchase_refunded', tx.user_id, { purchaseId: tx.id, productId: tx.product_id, priceJpy: tx.price_jpy, recovered, shortfall, reason }, now),
    ];
    return { statements, response: { refundId, gemsToRecover: toRecover, gemsRecovered: recovered, shortfall } };
  });
}
