import type { Store } from '@fd/shared';
import { Hono } from 'hono';
import { track } from '../lib/analytics';
import { requireUser } from '../lib/auth';
import { randomId, sha256Hex } from '../lib/crypto';
import { walletOf } from '../lib/economy';
import { ApiError, readJson } from '../lib/http';
import { completePurchase, membershipOf, productById, signMockReceipt, storeStatus, verifyReceipt, type ProductRow, type TxRow } from '../lib/purchases';
import type { AppEnv, Env } from '../env';

/**
 * Shop and purchases of the logged-in player (spec 11, decision 52).
 * The client never decides what it receives: the server verifies the receipt
 * and grants from its own product table.
 */
export const purchaseRoutes = new Hono<AppEnv>();
purchaseRoutes.use('*', requireUser);

const STORES: Store[] = ['mock', 'apple', 'google'];

async function shopView(env: Env, userId: string) {
  const products = await env.DB.prepare('SELECT * FROM purchase_products WHERE active = 1 ORDER BY sort_order').all<ProductRow>();
  const firsts = await env.DB.prepare("SELECT reward_key FROM reward_claims WHERE user_id = ? AND reward_key LIKE 'first-purchase:%'").bind(userId).all<{ reward_key: string }>();
  const used = new Set(firsts.results.map((r) => r.reward_key.slice('first-purchase:'.length)));
  return {
    products: products.results.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      priceJpy: p.price_jpy,
      gems: p.gems_base,
      bonus: p.gems_bonus,
      firstTimeBonus: used.has(p.id) ? 0 : p.first_time_bonus,
      periodDays: p.period_days,
    })),
    stores: storeStatus(env),
    membership: await membershipOf(env, userId),
    wallet: await walletOf(env, userId),
  };
}

purchaseRoutes.get('/shop', async (c) => c.json(await shopView(c.env, c.get('user').id)));

/** 1. start: records the attempt (purchase failure rate, spec 11-5) */
purchaseRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await readJson<{ productId?: unknown; store?: unknown }>(c);
  const store = body.store as Store;
  if (!STORES.includes(store)) throw new ApiError('BAD_REQUEST', 'store must be mock, apple or google');
  const st = storeStatus(c.env)[store];
  if (!st.available) throw new ApiError('STORE_UNAVAILABLE', st.reason === 'not_connected' ? `${store} is not connected yet` : 'this store is not available here', 409);
  const product = await productById(c.env, String(body.productId ?? ''));
  if (!product || !product.active) throw new ApiError('NOT_FOUND', 'product not found');
  if (product.kind === 'membership' && (await membershipOf(c.env, user.id)).active) throw new ApiError('ALREADY_MEMBER', 'the membership is already active', 409);
  const id = randomId();
  await c.env.DB.prepare(
    "INSERT INTO purchase_transactions (id, user_id, product_id, store, status, price_jpy, store_environment, created_at) VALUES (?,?,?,?,'started',?,?,?)",
  )
    .bind(id, user.id, product.id, store, product.price_jpy, store === 'mock' ? 'sandbox' : 'production', Date.now())
    .run();
  await track(c.env, { name: 'purchase_started', userId: user.id, properties: { purchaseId: id, productId: product.id, store, priceJpy: product.price_jpy } });
  return c.json({ purchaseId: id, productId: product.id, store, priceJpy: product.price_jpy }, 201);
});

/** cancel the automatic renewal of the membership (stays active until the end of the period) */
purchaseRoutes.post('/membership/cancel', async (c) => {
  const user = c.get('user');
  const m = await membershipOf(c.env, user.id);
  if (!m.active || !m.subscriptionId) throw new ApiError('NOT_FOUND', 'no active membership');
  // in the real stores this happens in the store's subscription settings; the mock store does it here
  if (!storeStatus(c.env).mock.available) throw new ApiError('STORE_UNAVAILABLE', 'manage the subscription in the store', 409);
  await c.env.DB.prepare('UPDATE subscriptions SET auto_renew = 0, updated_at = ? WHERE id = ?').bind(Date.now(), m.subscriptionId).run();
  return c.json({ membership: await membershipOf(c.env, user.id) });
});

// (registered before the /:id routes so that /membership/cancel is not read as a purchase id)

async function ownTx(env: Env, userId: string, id: string): Promise<TxRow> {
  const tx = await env.DB.prepare('SELECT * FROM purchase_transactions WHERE id = ? AND user_id = ?').bind(id, userId).first<TxRow>();
  if (!tx) throw new ApiError('NOT_FOUND', 'purchase not found');
  return tx;
}

/**
 * 2. the mock store (local / staging only): "pays" and returns a receipt
 * signed by the server. No money is charged.
 */
purchaseRoutes.post('/:id/mock-checkout', async (c) => {
  if (!storeStatus(c.env).mock.available) throw new ApiError('STORE_UNAVAILABLE', 'the mock store is disabled in production', 409);
  const user = c.get('user');
  const tx = await ownTx(c.env, user.id, c.req.param('id'));
  if (tx.store !== 'mock' || tx.status !== 'started') throw new ApiError('CONFLICT', 'this purchase cannot be paid');
  const storeTx = `mock-${randomId(10)}`;
  const receipt = await signMockReceipt(c.env, { v: 1, type: 'purchase', tx: storeTx, otx: storeTx, product: tx.product_id, user: user.id, purchase: tx.id, at: Date.now() });
  return c.json({ receipt, storeTransactionId: storeTx });
});

/** the player closed the store without paying (or the payment failed) */
purchaseRoutes.post('/:id/cancel', async (c) => {
  const user = c.get('user');
  const tx = await ownTx(c.env, user.id, c.req.param('id'));
  const body = await readJson<{ reason?: unknown }>(c).catch(() => ({}) as { reason?: unknown });
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 40) : 'cancelled';
  const r = await c.env.DB.prepare("UPDATE purchase_transactions SET status = 'failed', failure_reason = ? WHERE id = ? AND status = 'started'").bind(reason, tx.id).run();
  if (r.meta.changes === 1) await track(c.env, { name: 'purchase_failed', userId: user.id, properties: { purchaseId: tx.id, productId: tx.product_id, reason } });
  return c.json({ ok: true });
});

/** 3. verify the receipt and grant (safe to send again) */
purchaseRoutes.post('/:id/verify', async (c) => {
  const user = c.get('user');
  const body = await readJson<{ receipt?: unknown }>(c);
  if (typeof body.receipt !== 'string' || body.receipt.length < 10 || body.receipt.length > 20_000) throw new ApiError('BAD_REQUEST', 'receipt is required');
  const receipt = body.receipt;
  let tx = await ownTx(c.env, user.id, c.req.param('id'));
  if (tx.status === 'completed' || tx.status === 'refunded') return c.json({ purchase: view(tx), wallet: await walletOf(c.env, user.id), membership: await membershipOf(c.env, user.id) });
  if (tx.status !== 'started') throw new ApiError('CONFLICT', `the purchase is ${tx.status}`);
  const v = await verifyReceipt(c.env, tx.store, receipt);
  const fail = async (result: string, reason: string) => {
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO purchase_receipts (id, transaction_id, store, receipt_sha256, result, detail_json, created_at) VALUES (?,?,?,?,?,?,?)').bind(
        randomId(),
        tx.id,
        tx.store,
        await sha256Hex(receipt),
        result,
        JSON.stringify({ reason }),
        now,
      ),
      c.env.DB.prepare("UPDATE purchase_transactions SET status = 'failed', receipt_status = ?, failure_reason = ? WHERE id = ? AND status = 'started'").bind(result, reason.slice(0, 80), tx.id),
    ]);
    await track(c.env, { name: 'purchase_failed', userId: user.id, properties: { purchaseId: tx.id, productId: tx.product_id, reason: result } });
    throw new ApiError('RECEIPT_INVALID', reason, 400);
  };
  if (!v.ok) return fail(v.result, v.reason);
  // the receipt must belong to this player, this purchase and this product
  if (v.userId !== user.id || v.purchaseId !== tx.id || v.productId !== tx.product_id) return fail('invalid', 'the receipt does not match this purchase');
  const product = (await productById(c.env, tx.product_id))!;
  try {
    tx = await completePurchase(c.env, tx, product, v, receipt);
  } catch (err) {
    // a concurrent request completed it, or the store transaction was already used
    const again = await ownTx(c.env, user.id, tx.id);
    if (again.status !== 'completed') {
      console.error('purchase completion failed', err);
      throw new ApiError('CONFLICT', 'this receipt was already used');
    }
    tx = again;
  }
  return c.json({ purchase: view(tx), wallet: await walletOf(c.env, user.id), membership: await membershipOf(c.env, user.id) });
});

const view = (t: TxRow) => ({
  id: t.id,
  productId: t.product_id,
  store: t.store,
  status: t.status,
  priceJpy: t.price_jpy,
  gemsPurchased: t.gems_purchased,
  gemsGranted: t.gems_granted,
  renewal: !!t.is_renewal,
  createdAt: t.created_at,
  completedAt: t.completed_at,
  refundedAt: t.refunded_at,
});

/** the player's purchase history */
purchaseRoutes.get('/', async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM purchase_transactions WHERE user_id = ? AND status <> 'started' ORDER BY created_at DESC LIMIT 100").bind(c.get('user').id).all<TxRow>();
  return c.json({ items: rows.results.map(view) });
});
