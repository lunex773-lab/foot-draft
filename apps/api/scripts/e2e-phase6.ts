/**
 * Phase 6 end-to-end test against a running local API (`npm run dev -w @fd/api`).
 *
 *   npm run e2e:phase6 -w @fd/api
 *
 *  - shop and the mock store: start -> pay -> verify -> GEMS (purchased / bonus kept apart),
 *    first-time bonus once, receipts cannot be replayed, forged or moved to another purchase,
 *    simultaneous verifications grant once, cancelled purchases count as failures
 *  - refunds: what is left is taken back, the rest is recorded as a shortfall; admin resolves it
 *  - membership: purchase, badge (profile, room seat), daily FREE GEMS, renew / cancel / expire, refund
 *  - Season Pass: XP from a league, premium for 800 GEMS (FREE first), claim every reward once (incl. cards)
 *  - gacha management: draft (hidden), publish, versioned edit (note required), history for players
 *  - products, revenue, permissions
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PASS_CONFIG, passTotals, type RoomSnapshot, type ServerMessage } from '@fd/shared';

const API = process.env.FD_API_URL ?? 'http://127.0.0.1:8787';
const WS = API.replace(/^http/, 'ws');
const RUN = Math.random().toString(36).slice(2, 8);
const HERE = dirname(fileURLToPath(import.meta.url));
const FAST = { pickSeconds: 2, lineupSecondsFirst: 2, lineupSecondsBetween: 1, playbackSeconds: 1 };
let failures = 0;

function check(cond: unknown, label: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rid = () => `e2e-${RUN}-${Math.random().toString(36).slice(2, 12)}`;

async function api<T = any>(path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<{ status: number; data: T }> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(`${API}${path}`, {
        method: opts.method ?? (opts.body ? 'POST' : 'GET'),
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: res.status, data };
    } catch (e) {
      if (i >= 4) throw e;
      await sleep(1000);
    }
  }
}

function d1(sql: string) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', sql], { cwd: join(HERE, '..'), stdio: ['ignore', 'ignore', 'inherit'] });
}

async function register(name: string) {
  const username = `${name}_${RUN}`;
  const r = await api<{ token: string; user: { id: string } }>('/api/auth/register', { body: { username, password: 'password-1234', displayName: name } });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.data)}`);
  return { username, token: r.data.token, id: r.data.user.id };
}

function createAdmin(name: string, role: string) {
  execFileSync('npx', ['tsx', join(HERE, 'create-admin.ts'), '--local', '--username', name, '--role', role, '--no-totp'], {
    env: { ...process.env, FD_ADMIN_PASSWORD: 'admin-password-123' },
    cwd: join(HERE, '..'),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function adminLogin(name: string) {
  const r = await api('/api/admin/auth/login', { body: { username: name, password: 'admin-password-123' } });
  if (r.status !== 200) throw new Error(`admin login failed ${r.status}`);
  return r.data.token as string;
}

/** start -> mock store -> verify */
async function buy(token: string, productId: string) {
  const s = await api('/api/purchases', { token, body: { productId, store: 'mock' } });
  if (s.status !== 201) return { start: s, purchaseId: null as string | null, receipt: null as string | null, verify: null as any };
  const pay = await api(`/api/purchases/${s.data.purchaseId}/mock-checkout`, { token, body: {} });
  const verify = await api(`/api/purchases/${s.data.purchaseId}/verify`, { token, body: { receipt: pay.data.receipt } });
  return { start: s, purchaseId: s.data.purchaseId as string, receipt: pay.data.receipt as string, verify };
}

const wallet = async (token: string) => (await api('/api/currency', { token })).data.wallet;

async function main() {
  console.log(`Phase 6 E2E against ${API} (run ${RUN})`);
  const a = await register('p6a');
  const b = await register('p6b');
  const adminName = `p6admin_${RUN}`;
  const viewerName = `p6viewer_${RUN}`;
  const supportName = `p6support_${RUN}`;
  createAdmin(adminName, 'admin');
  createAdmin(viewerName, 'viewer');
  createAdmin(supportName, 'support');
  await sleep(1000);
  const at = await adminLogin(adminName);
  const vt = await adminLogin(viewerName);
  const st = await adminLogin(supportName);

  // ------------------------------------------------------------ shop and the mock store
  console.log('\n[shop and purchases]');
  const shop = await api('/api/purchases/shop', { token: a.token });
  check(shop.status === 200 && shop.data.products.length === 7 && shop.data.stores.mock.available && !shop.data.stores.apple.available, 'shop: 7 products, mock store available locally, Apple / Google not connected');
  check(shop.data.products.find((p: any) => p.id === 'gems_300').firstTimeBonus === 150, 'Starter Pack shows the first-time bonus');
  const apple = await api('/api/purchases', { token: a.token, body: { productId: 'gems_300', store: 'apple' } });
  check(apple.status === 409 && apple.data.error.code === 'STORE_UNAVAILABLE', 'Apple purchases are refused (not connected)');
  const w0 = await wallet(a.token);
  const p1 = await buy(a.token, 'gems_300');
  const w1 = await wallet(a.token);
  check(p1.verify.status === 200 && p1.verify.data.purchase.status === 'completed', 'Starter Pack bought with the mock store');
  check(w1.gems.paidPurchased - w0.gems.paidPurchased === 300 && w1.gems.paidGranted - w0.gems.paidGranted === 150, '+300 purchased PAID GEMS and +150 first-time bonus (distributed)');
  const again = await api(`/api/purchases/${p1.purchaseId}/verify`, { token: a.token, body: { receipt: p1.receipt } });
  check(again.status === 200 && (await wallet(a.token)).gems.paid === w1.gems.paid, 'sending the receipt again grants nothing more');
  const other = await api('/api/purchases', { token: a.token, body: { productId: 'gems_300', store: 'mock' } });
  const moved = await api(`/api/purchases/${other.data.purchaseId}/verify`, { token: a.token, body: { receipt: p1.receipt } });
  check(moved.status === 400 && moved.data.error.code === 'RECEIPT_INVALID', 'a receipt cannot complete another purchase');
  const p2 = await buy(a.token, 'gems_300');
  const [payload, sig] = (await api(`/api/purchases/${(await api('/api/purchases', { token: a.token, body: { productId: 'gems_600', store: 'mock' } })).data.purchaseId}/mock-checkout`, { token: a.token, body: {} })).data.receipt.split('.');
  const forgedStart = await api('/api/purchases', { token: a.token, body: { productId: 'gems_10000', store: 'mock' } });
  const forged = await api(`/api/purchases/${forgedStart.data.purchaseId}/verify`, { token: a.token, body: { receipt: `${payload}x.${sig}` } });
  check(forged.status === 400, 'a changed receipt is refused');
  const w2 = await wallet(a.token);
  check(p2.verify.data.purchase.gemsGranted === 0 && w2.gems.paidPurchased - w1.gems.paidPurchased === 300 && w2.gems.paidGranted === w1.gems.paidGranted, 'second Starter Pack: no first-time bonus');
  // simultaneous verification of one purchase
  const s3 = await api('/api/purchases', { token: a.token, body: { productId: 'gems_1200', store: 'mock' } });
  const pay3 = await api(`/api/purchases/${s3.data.purchaseId}/mock-checkout`, { token: a.token, body: {} });
  const [v3a, v3b] = await Promise.all([
    api(`/api/purchases/${s3.data.purchaseId}/verify`, { token: a.token, body: { receipt: pay3.data.receipt } }),
    api(`/api/purchases/${s3.data.purchaseId}/verify`, { token: a.token, body: { receipt: pay3.data.receipt } }),
  ]);
  const w3 = await wallet(a.token);
  check(v3a.status === 200 && v3b.status === 200 && w3.gems.paidPurchased - w2.gems.paidPurchased === 1200 && w3.gems.paidGranted - w2.gems.paidGranted === 50, 'two simultaneous verifications grant once (+1,200 purchased, +50 bonus)');
  const cancel = await api('/api/purchases', { token: a.token, body: { productId: 'gems_600', store: 'mock' } });
  await api(`/api/purchases/${cancel.data.purchaseId}/cancel`, { token: a.token, body: { reason: 'user_cancelled' } });
  const hist = await api('/api/purchases', { token: a.token });
  check(hist.data.items.filter((x: any) => x.status === 'completed').length === 3 && hist.data.items.some((x: any) => x.status === 'failed'), 'purchase history: 3 completed, failures recorded');

  // ------------------------------------------------------------ refund with a shortfall
  console.log('\n[refunds]');
  // spend 1,000 PAID GEMS: distributed first (200), then purchased (800)
  const draw = await api('/api/gacha/banners/premium-s1/draw', { token: a.token, body: { count: 10, requestId: rid() } });
  check(draw.status === 200 && draw.data.cost.split.GEMS_PAID_GRANTED === 200 && draw.data.cost.split.GEMS_PAID_PURCHASED === 800, 'Premium 10-draw paid with distributed 200 + purchased 800');
  const refund = await api(`/api/admin/purchases/${s3.data.purchaseId}/mock-refund`, { token: at, body: {} });
  const w4 = await wallet(a.token);
  check(refund.status === 200 && refund.data.gemsToRecover === 1250 && refund.data.gemsRecovered === 1000 && refund.data.shortfall === 250, 'refund of the Medium Pack: 1,000 taken back, 250 recorded as a shortfall');
  check(w4.gems.paidPurchased === 0 && w4.gems.paidGranted === 0, 'balances never go below 0');
  const twice = await api(`/api/admin/purchases/${s3.data.purchaseId}/mock-refund`, { token: at, body: {} });
  check(twice.data.refundId === refund.data.refundId && twice.data.replayed === true && (await wallet(a.token)).gems.paid === w4.gems.paid, 'a second refund notice returns the first result and takes nothing more');
  const open = await api('/api/admin/refunds?status=shortfall', { token: st });
  const rec = open.data.items.find((r: any) => r.transaction_id === s3.data.purchaseId);
  check(rec && rec.shortfall === 250, 'shortfall listed for the operator (support can see it)');
  check((await api(`/api/admin/refunds/${rec.id}/resolve`, { token: st, body: { note: 'x' } })).status === 403, 'support cannot resolve it');
  const res = await api(`/api/admin/refunds/${rec.id}/resolve`, { token: at, body: { note: '少額のため回収しない（テスト）' } });
  check(res.status === 200, 'admin resolves the shortfall with a note');

  // ------------------------------------------------------------ membership
  console.log('\n[membership]');
  const m = await buy(b.token, 'membership_monthly');
  const me = await api('/api/users/me', { token: b.token });
  const days = (me.data.membership.periodEnd - Date.now()) / 86400000;
  check(m.verify.status === 200 && me.data.membership.active && days > 29.9 && days <= 30, 'membership active for 30 days');
  check((await api('/api/purchases', { token: b.token, body: { productId: 'membership_monthly', store: 'mock' } })).data.error?.code === 'ALREADY_MEMBER', 'cannot buy it twice while active');
  const free0 = (await wallet(b.token)).gems.free;
  const lb = await api('/api/rewards/login', { token: b.token, body: {} });
  const lb2 = await api('/api/rewards/login', { token: b.token, body: {} });
  check(lb.data.membershipGems === 20 && lb2.data.membershipGems === 0 && (await wallet(b.token)).gems.free === free0 + 20, 'member: 20 FREE GEMS once per day');
  const room = await api('/api/rooms', { token: b.token, body: { settings: { fillWithCpu: true } } });
  const snap = await api(`/api/rooms/${room.data.roomId}`, { token: b.token });
  check(snap.data.seats[room.data.seat].member === true, 'member badge on the room seat');
  await api(`/api/rooms/${room.data.roomId}/leave`, { token: b.token, body: {} });
  const subs = await api('/api/admin/subscriptions', { token: at });
  const sub = subs.data.items.find((x: any) => x.user_id === b.id);
  const end1 = sub.current_period_end;
  await api(`/api/admin/subscriptions/${sub.id}/mock/renew`, { token: at, body: {} });
  const sub2 = (await api('/api/admin/subscriptions', { token: at })).data.items.find((x: any) => x.id === sub.id);
  check(sub2.current_period_end - end1 === 30 * 86400000 && sub2.payments === 2, 'renewal: second payment, +30 days');
  await api('/api/purchases/membership/cancel', { token: b.token, body: {} });
  const me2 = await api('/api/users/me', { token: b.token });
  check(me2.data.membership.active && me2.data.membership.autoRenew === false, 'cancelled by the player: still active until the end of the period');
  await api(`/api/admin/subscriptions/${sub.id}/mock/expire`, { token: at, body: {} });
  check((await api('/api/users/me', { token: b.token })).data.membership.active === false, 'expired: no longer a member');
  const m2 = await buy(b.token, 'membership_monthly');
  await api(`/api/admin/purchases/${m2.purchaseId}/mock-refund`, { token: at, body: {} });
  check((await api('/api/users/me', { token: b.token })).data.membership.active === false, 'a refunded membership ends at once');

  // ------------------------------------------------------------ Season Pass
  console.log('\n[Season Pass]');
  const pass0 = await api('/api/pass', { token: a.token });
  check(pass0.status === 200 && pass0.data.levels.length === PASS_CONFIG.levels && pass0.data.level === 0 && !pass0.data.premium, 'pass: 30 levels, level 0, free track');
  // one league: XP
  const st0 = await api('/api/solo/start', { token: a.token, body: { settings: FAST } });
  const snapEnd = await playSolo(a.token, st0.data.roomId);
  const reward = snapEnd.outcome!.rewards![snapEnd.you!];
  const pass1 = await api('/api/pass', { token: a.token });
  check(reward.passXp && reward.passXp >= 100 && pass1.data.xp === reward.passXp, `a league gives ${reward.passXp} XP`);
  // premium: FREE GEMS first
  await api('/api/admin/economy/test-grants', { token: at, body: { username: a.username, kind: 'GEMS_FREE', amount: 500 } });
  await api('/api/admin/economy/test-grants', { token: at, body: { username: a.username, kind: 'GEMS_PAID_PURCHASED', amount: 1000 } });
  const wp = await wallet(a.token);
  const prem = await api('/api/pass/premium', { token: a.token, body: { requestId: rid() } });
  check(prem.status === 200 && prem.data.split.GEMS_FREE === wp.gems.free && (prem.data.split.GEMS_PAID_PURCHASED ?? 0) === 800 - wp.gems.free, `premium for 800 GEMS: FREE GEMS first (${JSON.stringify(prem.data.split)})`);
  check((await api('/api/pass/premium', { token: a.token, body: { requestId: rid() } })).status === 409, 'premium bought once per season');
  // reach the last level (test shortcut), then claim everything
  d1(`UPDATE season_pass_progress SET xp = ${PASS_CONFIG.levels * PASS_CONFIG.xpPerLevel} WHERE user_id = '${a.id}'`);
  const before = await wallet(a.token);
  const cards0 = (await api('/api/collection', { token: a.token })).data.counts.owned;
  const claim = await api('/api/pass/claim', { token: a.token, body: { requestId: rid() } });
  const after = await wallet(a.token);
  const free = passTotals('free');
  const premT = passTotals('premium');
  const cards1 = (await api('/api/collection', { token: a.token })).data.counts.owned;
  check(claim.status === 200 && claim.data.granted.length === 55, `claimed all 55 rewards (${claim.data.granted?.length})`);
  check(after.coins - before.coins === free.coins + premT.coins && after.gems.free - before.gems.free === free.gemsFree, `+${free.coins + premT.coins} COINS, +${free.gemsFree} FREE GEMS`);
  check(after.points.standard - before.points.standard === premT.standardPoints && after.points.premium - before.points.premium === premT.premiumPoints, 'exchange points from the premium track');
  check(cards1 - cards0 === 2 && claim.data.granted.filter((g: any) => g.reward.type === 'card' && g.playerId).length === 2, 'an Epic and a Legendary card not owned before');
  check((await api('/api/pass/claim', { token: a.token, body: { requestId: rid() } })).status === 409, 'rewards are paid once');

  // ------------------------------------------------------------ gacha management
  console.log('\n[gacha management]');
  const cards = (await api('/api/admin/cards?limit=500', { token: at })).data.items as { id: string; rarity: string }[];
  const pool = cards.filter((c) => c.rarity !== 'common').map((c) => c.id);
  const id = `e2e-${RUN}`;
  const def = {
    id,
    kind: 'premium',
    seriesId: `e2e-series-${RUN}`,
    name: `E2E ガシャ ${RUN}`,
    description: 'e2e test banner',
    costSingle: 100,
    costMulti: 1000,
    ratesPpm: { common: 0, rare: 600000, epic: 300000, legendary: 90000, icon: 10000 },
    pity: { epicAt: 50, legendaryAt: 100, bonusEvery: 150 },
    poolIds: pool,
    startsAt: Date.now() - 60_000,
    endsAt: Date.now() + 86_400_000,
  };
  check((await api('/api/admin/gacha/banners', { token: at, body: { ...def, ratesPpm: { ...def.ratesPpm, rare: 500000 } } })).status === 400, 'rates that do not add up to 100% are refused');
  check((await api('/api/admin/gacha/banners', { token: vt, body: def })).status === 403, 'viewer cannot create a gacha');
  const created = await api('/api/admin/gacha/banners', { token: at, body: def });
  check(created.status === 201 && created.data.banner.status === 'draft', 'draft created');
  check((await api(`/api/gacha/banners/${id}`, { token: a.token })).status === 404, 'drafts are not visible to players');
  const pub = await api(`/api/admin/gacha/banners/${id}/publish`, { token: at, body: {} });
  check(pub.status === 200 && pub.data.banner.status === 'published' && pub.data.versions.length === 1, 'published (version 1 recorded)');
  await api('/api/admin/economy/test-grants', { token: at, body: { username: a.username, kind: 'GEMS_PAID_PURCHASED', amount: 1000 } });
  const d1draw = await api(`/api/gacha/banners/${id}/draw`, { token: a.token, body: { count: 1, requestId: rid() } });
  check(d1draw.status === 200 && d1draw.data.ratesVersion === 1, 'a player draws with version 1');
  check((await api(`/api/admin/gacha/banners/${id}`, { method: 'PATCH', token: at, body: { ...def, ratesPpm: { common: 0, rare: 550000, epic: 350000, legendary: 90000, icon: 10000 } } })).status === 400, 'changing a published gacha needs a note');
  const edit = await api(`/api/admin/gacha/banners/${id}`, { method: 'PATCH', token: at, body: { ...def, ratesPpm: { common: 0, rare: 550000, epic: 350000, legendary: 90000, icon: 10000 }, changeNote: 'Epic の排出率を 30% から 35% に変更' } });
  check(edit.status === 200 && edit.data.banner.rates_version === 2 && edit.data.versions.length === 2, 'edit of a published gacha: version 2');
  const pd = await api(`/api/gacha/banners/${id}`, { token: a.token });
  check(pd.data.banner.ratesPpm.epic === 350000 && pd.data.versions[0].change_note.includes('35%'), 'players see the new rates and the change history');
  const d2draw = await api(`/api/gacha/banners/${id}/draw`, { token: a.token, body: { count: 1, requestId: rid() } });
  check(d2draw.data.ratesVersion === 2, 'the next draw records version 2');
  const ad = await api(`/api/admin/gacha/banners/${id}`, { token: vt });
  check(ad.status === 200 && ad.data.draws.length === 2, 'admin (viewer too) sees draws per version');
  const end = await api(`/api/admin/gacha/banners/${id}/end`, { token: at, body: {} });
  check(end.data.banner.status === 'archived' && !(await api('/api/gacha/banners', { token: a.token })).data.items.some((x: any) => x.id === id), 'ended: no longer listed');

  // ------------------------------------------------------------ products and revenue
  console.log('\n[products and revenue]');
  check((await api('/api/admin/products/gems_1200', { method: 'PATCH', token: at, body: { gems_base: 1300 } })).status === 400, 'purchased GEMS must equal the price (decision 53)');
  check((await api('/api/admin/products/gems_1200', { method: 'PATCH', token: st, body: { gems_bonus: 60 } })).status === 403, 'support cannot change products');
  const pp = await api('/api/admin/products/gems_1200', { method: 'PATCH', token: at, body: { gems_bonus: 60 } });
  check(pp.status === 200 && pp.data.product.gems_bonus === 60, 'admin changes the bonus');
  await api('/api/admin/products/gems_1200', { method: 'PATCH', token: at, body: { gems_bonus: 50 } });
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const rev = await api(`/api/admin/revenue?from=${today}&to=${today}`, { token: vt });
  check(rev.status === 200 && rev.data.gross >= 300 + 300 + 1200 + 500 + 500 + 500 && rev.data.refunds >= 1200 + 500 && rev.data.net === rev.data.gross - rev.data.refunds, `revenue: gross ${rev.data.gross}, refunds ${rev.data.refunds}, net ${rev.data.net}`);
  check(rev.data.payers >= 2 && rev.data.arppu > 0 && rev.data.failureRate > 0 && rev.data.mockGross === rev.data.gross, 'payers, ARPPU, failure rate; everything locally is mock');
  check(rev.data.byProduct.some((x: any) => x.product_id === 'gems_300' && x.n >= 2) && rev.data.gacha.length >= 1, 'per product and per gacha');
  const ov = await api(`/api/admin/overview?from=${today}&to=${today}`, { token: vt });
  check(ov.data.revenue.implemented === true && ov.data.revenue.storesConnected === false, 'overview: revenue shown, stores marked as not connected');
  check((await api('/api/admin/purchases', { token: vt })).status === 403, 'viewer cannot see individual purchases');
  const ud = await api(`/api/admin/users/${a.id}`, { token: st });
  check(ud.data.purchases.items.length >= 3, 'user details list the purchases');

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

/** plays a Solo Challenge room with automatic picks and returns the final snapshot */
async function playSolo(token: string, roomId: string): Promise<RoomSnapshot> {
  const { data } = await api<{ ticket: string }>(`/api/rooms/${roomId}/ticket`, { token, body: {} });
  const ws = new WebSocket(`${WS}/api/rooms/${roomId}/ws?ticket=${encodeURIComponent(data.ticket)}`);
  let snap: RoomSnapshot | null = null;
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMessage;
    if (msg.type === 'snapshot') snap = msg.state;
  });
  const start = Date.now();
  for (;;) {
    const s = snap as RoomSnapshot | null;
    if (s?.phase === 'finished' && s.outcome?.rewards) break;
    if (Date.now() - start > 300_000) throw new Error('solo league timed out');
    await sleep(250);
  }
  ws.close();
  return snap!;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
