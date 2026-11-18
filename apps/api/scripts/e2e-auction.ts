/**
 * PLAYER AUCTION end-to-end test against a running local API (`npm run dev -w @fd/api`).
 *
 *   npm run e2e:auction -w @fd/api
 *
 *  - initial funds once (decision 100), the market lists the admin's queue (decision 105)
 *  - bid rules: start price, +5 % / +100, no bid on one's own lead, +5 cards refused (decision 99)
 *  - holds: the previous highest bid is released, holds never exceed the balance
 *  - two simultaneous bids: exactly one wins, one active hold per lot
 *  - GEMS exchange (decisions 101-102): FREE first, then PAID, one request id = once
 *  - extension in the last seconds, outbid / market messages on the WebSocket, reconnect
 *  - settlement: only the winner pays, new card / +1 / points at +5, one result per lot,
 *    ledger = balance, holds = active holds
 *  - unsold cards go back to the queue and are listed again
 *  - rate limit, fraud log, admin figures and permissions, cancel, test data reset
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AUCTION_SETTINGS, getCatalog, type AuctionLotView, type AuctionServerMessage } from '@fd/shared';

const API = process.env.FD_API_URL ?? 'http://127.0.0.1:8787';
const WS = API.replace(/^http/, 'ws');
const RUN = Math.random().toString(36).slice(2, 8);
const HERE = dirname(fileURLToPath(import.meta.url));
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

function d1<T = Record<string, unknown>>(sql: string): T[] {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', sql], { cwd: join(HERE, '..'), stdio: ['ignore', 'pipe', 'inherit'] }).toString();
  const parsed = JSON.parse(out) as { results: T[] }[];
  return parsed[parsed.length - 1]?.results ?? [];
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
  const r = await api<{ token: string }>('/api/admin/auth/login', { body: { username: name, password: 'admin-password-123' } });
  if (r.status !== 200) throw new Error(`admin login failed ${r.status}`);
  return r.data.token;
}

type User = Awaited<ReturnType<typeof register>>;

const state = (u: User) => api<{ market: { lots: AuctionLotView[]; serverNow: number }; wallet: { balance: number; held: number; available: number }; owned: Record<string, number> }>('/api/auction/state', { token: u.token });
const bid = (u: User, lotId: string, amount: number) => api('/api/auction/bid', { token: u.token, body: { lotId, amount } });

/** a viewer on the market WebSocket that keeps every message */
async function connect(u: User) {
  const t = await api<{ ticket: string }>('/api/auction/ticket', { token: u.token, body: {} });
  const ws = new WebSocket(`${WS}/api/auction/ws?ticket=${encodeURIComponent(t.data.ticket)}`);
  const messages: AuctionServerMessage[] = [];
  ws.addEventListener('message', (e) => messages.push(JSON.parse(String(e.data)) as AuctionServerMessage));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });
  return { ws, messages };
}

async function waitFor(cond: () => boolean | Promise<boolean>, ms: number, label: string) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await cond()) return true;
    await sleep(250);
  }
  console.log(`    (timed out waiting for ${label})`);
  return false;
}

async function main() {
  console.log(`PLAYER AUCTION e2e (run ${RUN}) against ${API}`);
  const adminName = `auc_admin_${RUN}`;
  const viewerName = `auc_viewer_${RUN}`;
  createAdmin(adminName, 'admin');
  createAdmin(viewerName, 'viewer');
  const at = await adminLogin(adminName);
  const vt = await adminLogin(viewerName);
  const A = await register('aucA');
  const B = await register('aucB');
  const C = await register('aucC');
  const D = await register('aucD');
  const E = await register('aucE');

  // five COMMON cards for the queue
  const commons = getCatalog()
    .filter((p) => p.rarity === 'common')
    .map((p) => p.id)
    .sort()
    .slice(0, 5);
  const [c1, c2, c3, c4, c5] = commons;
  const now = Date.now();
  // A owns c1 at +2 (a win makes +3), B owns c2 at +5 (cannot bid), D owns c3 at +4
  d1(
    `INSERT OR REPLACE INTO user_collections (user_id, player_id, source, source_ref, obtained_at, level) VALUES
       ('${A.id}', '${c1}', 'test_grant', 'e2e', ${now}, 2), ('${B.id}', '${c2}', 'test_grant', 'e2e', ${now}, 5), ('${D.id}', '${c3}', 'test_grant', 'e2e', ${now}, 4)`,
  );

  console.log('\n[market set up by the admin (decision 105)]');
  check((await api('/api/admin/auction/settings', { method: 'PUT', token: vt, body: { open: false } })).status === 403, 'viewer cannot change the settings');
  check((await api('/api/admin/auction/settings', { method: 'PUT', token: at, body: { concurrentLots: 0 } })).status === 400, 'settings outside the bounds are refused');
  await api('/api/admin/auction/settings', { method: 'PUT', token: at, body: { open: false } });
  const ov0 = await api('/api/admin/auction/overview', { token: at });
  for (const l of ov0.data.market.lots as { id: string }[]) await api(`/api/admin/auction/lots/${l.id}/cancel`, { token: at, body: { reason: 'e2e clean start' } });
  const q = await api('/api/admin/auction/queue', { method: 'PUT', token: at, body: { playerIds: [c1, c2, c3, c4, c5] } });
  check(q.status === 200 && q.data.count === 5, 'queue of 5 cards saved');
  const set = await api('/api/admin/auction/settings', {
    method: 'PUT',
    token: at,
    body: { ...DEFAULT_AUCTION_SETTINGS, open: true, mode: 'manual', pauseWhenIdle: true, concurrentLots: 3, bidSeconds: 20, extendWindowSeconds: 5, extendSeconds: 5 },
  });
  check(set.status === 200 && set.data.settings.mode === 'manual', 'manual listing, 3 lots, 20 s');

  console.log('\n[initial funds once (decision 100)]');
  const sA = await state(A);
  check(sA.status === 200 && sA.data.wallet.balance === 100_000 && sA.data.wallet.held === 0, 'A has 100,000 auction coins');
  const lots = sA.data.market.lots;
  check(lots.length === 3 && lots.map((l) => l.playerId).join() === [c1, c2, c3].join(), 'the first 3 cards of the queue are listed in order');
  const sA2 = await state(A);
  check(sA2.data.wallet.balance === 100_000, 'opening again does not pay again');
  const L1 = lots[0];
  const L2 = lots[1];
  const L3 = lots[2];
  check(L1.minNextBid === 1_000 && L1.currentPrice === null, 'COMMON start price 1,000 (decision 103)');
  for (const u of [B, C, D, E]) await state(u);

  console.log('\n[bid rules and holds]');
  check((await bid(A, L1.id, 999)).data?.error?.code === 'BID_TOO_LOW', 'below the start price refused');
  check((await bid(A, L1.id, 1000.5)).data?.error?.code === 'BAD_AMOUNT', 'not a whole number refused');
  const a1 = await bid(A, L1.id, 1_000);
  check(a1.status === 200 && a1.data.wallet.held === 1_000 && a1.data.wallet.available === 99_000, 'A bids 1,000: 1,000 held');
  check((await bid(A, L1.id, 1_100)).data?.error?.code === 'ALREADY_LEADING', 'no bid on one\'s own highest bid');
  check((await bid(B, L1.id, 1_050)).data?.error?.code === 'BID_TOO_LOW', 'raise below +100 refused');
  const b1 = await bid(B, L1.id, 1_100);
  check(b1.status === 200 && b1.data.lot.leaderIsYou && b1.data.lot.minNextBid === 1_200, 'B bids 1,100 (next minimum 1,200)');
  check((await state(A)).data.wallet.held === 0, "A's hold is released when overtaken");

  console.log('\n[two simultaneous bids]');
  const [ra, rc] = await Promise.all([bid(A, L1.id, 1_200), bid(C, L1.id, 1_200)]);
  const okCount = [ra, rc].filter((r) => r.status === 200).length;
  check(okCount === 1, `exactly one of two equal bids wins (${ra.status} / ${rc.status})`);
  const raceWinner = ra.status === 200 ? A : C;
  const active = d1<{ n: number }>(`SELECT COUNT(*) AS n FROM auction_holds WHERE lot_id = '${L1.id}' AND status = 'active'`)[0].n;
  check(active === 1, 'one active hold on the lot');

  console.log('\n[decision 99: owned cards]');
  const bMax = await bid(B, L2.id, 5_000);
  check(bMax.data?.error?.code === 'MAX_LEVEL', 'a +5 card cannot be bid on');
  const cL2 = await bid(C, L2.id, 50_000);
  check(cL2.status === 200, 'C bids 50,000 on another lot');
  const cAvail = (await state(C)).data.wallet.available;
  const over = await bid(C, L3.id, cAvail + 1);
  check(over.data?.error?.code === 'INSUFFICIENT_FUNDS', 'holds never exceed the balance (insufficient funds refused)');
  const dL3 = await bid(D, L3.id, 1_000);
  check(dL3.status === 200, 'D bids on a card owned at +4');

  console.log('\n[GEMS exchange (decisions 101-102)]');
  await api('/api/admin/economy/test-grants', { token: at, body: { username: C.username, kind: 'GEMS_FREE', amount: 1000, note: 'e2e auction' } });
  await api('/api/admin/economy/test-grants', { token: at, body: { username: C.username, kind: 'GEMS_PAID_GRANTED', amount: 500, note: 'e2e auction' } });
  const before = (await state(C)).data.wallet;
  const reqId = rid();
  const ex = await api('/api/auction/exchange', { token: C.token, body: { gems: 1200, requestId: reqId } });
  check(ex.status === 200 && ex.data.coins === 12_000 && ex.data.split.GEMS_FREE === 1000 && ex.data.split.GEMS_PAID_GRANTED === 200, '1,200 GEMS -> 12,000 coins, FREE first then PAID');
  const ex2 = await api('/api/auction/exchange', { token: C.token, body: { gems: 1200, requestId: reqId } });
  check(ex2.data.replayed === true, 'the same request id is not exchanged twice');
  const after = (await state(C)).data.wallet;
  check(after.balance === before.balance + 12_000, 'balance +12,000 once');
  check((await api('/api/auction/exchange', { token: C.token, body: { gems: 999_999, requestId: rid() } })).data?.error?.code === 'INSUFFICIENT_FUNDS', 'not enough GEMS refused');

  console.log('\n[rate limit and fraud log]');
  const flood = [];
  for (let i = 0; i < 7; i++) flood.push(await bid(E, L2.id, 1));
  check(flood[6].status === 429, '7 bids within 5 s: the 7th is refused (RATE_LIMITED)');

  // D's card becomes +5 before the end: the win gives exchange points instead
  d1(`UPDATE user_collections SET level = 5 WHERE user_id = '${D.id}' AND player_id = '${c3}'`);

  console.log('\n[WebSocket: outbid, extension, reconnect]');
  const leaderWs = await connect(raceWinner);
  await waitFor(() => leaderWs.messages.some((m) => m.type === 'market'), 3000, 'market');
  check(leaderWs.messages[0]?.type === 'market', 'the viewer receives the whole market on connecting');
  // wait for the last 5 seconds of L1
  const l1Now = (await state(B)).data.market.lots.find((l) => l.id === L1.id)!;
  const wait = l1Now.endsAt - Date.now() - 3_500;
  if (wait > 0) await sleep(wait);
  const ext = await bid(B, L1.id, 1_300);
  check(ext.status === 200 && ext.data.lot.endsAt >= l1Now.endsAt + 5_000 - 50, 'a bid in the last 5 s moves the end 5 s later');
  check(d1<{ extended: number }>(`SELECT extended FROM auction_bids WHERE lot_id = '${L1.id}' ORDER BY bid_no DESC LIMIT 1`)[0].extended === 1, 'the bid is recorded as extending');
  await waitFor(() => leaderWs.messages.some((m) => m.type === 'outbid' && m.lotId === L1.id), 3000, 'outbid');
  check(leaderWs.messages.some((m) => m.type === 'outbid' && m.lotId === L1.id), 'the previous highest bidder is told at once');
  leaderWs.ws.close();
  await sleep(300);
  const again = await connect(raceWinner);
  await waitFor(() => again.messages.some((m) => m.type === 'market'), 3000, 'market again');
  const m0 = again.messages.find((m) => m.type === 'market');
  const l1Again = m0 && m0.type === 'market' ? m0.market.lots.find((l) => l.id === L1.id) : null;
  check(!!l1Again && l1Again.currentPrice === 1_300 && !l1Again.leaderIsYou && l1Again.leaderName === 'aucB', 'after reconnecting the state is the same (B leads with 1,300)');
  // A takes L1 back in the last seconds (A owns the card at +2)
  const a2 = await bid(A, L1.id, 1_400);
  check(a2.status === 200, 'A bids 1,400');

  console.log('\n[settlement]');
  const lastEnd = Math.max(...(await state(A)).data.market.lots.filter((l) => [L1.id, L2.id, L3.id].includes(l.id)).map((l) => l.endsAt));
  await sleep(Math.max(0, lastEnd - Date.now()) + 2_500);
  const results = d1<{ lot_id: string; user_id: string; price: number; outcome: string; level_after: number | null; points: number }>(
    `SELECT lot_id, user_id, price, outcome, level_after, points FROM auction_results WHERE lot_id IN ('${L1.id}', '${L2.id}', '${L3.id}')`,
  );
  const r1 = results.find((r) => r.lot_id === L1.id);
  const r2 = results.find((r) => r.lot_id === L2.id);
  const r3 = results.find((r) => r.lot_id === L3.id);
  check(results.length === 3, 'one result per lot');
  check(r1?.user_id === A.id && r1.price === 1_400 && r1.outcome === 'enhanced' && r1.level_after === 3, 'A won L1 for 1,400: the card +2 -> +3');
  check(r2?.user_id === C.id && r2.price === 50_000 && r2.outcome === 'new', 'C won L2 for 50,000: a new card');
  check(r3?.user_id === D.id && r3.outcome === 'points' && r3.points === 10, 'D won L3 at +5: 10 Premium exchange points');
  const cards = d1<{ user_id: string; player_id: string; level: number; source: string }>(
    `SELECT user_id, player_id, level, source FROM user_collections WHERE (user_id = '${A.id}' AND player_id = '${c1}') OR (user_id = '${C.id}' AND player_id = '${c2}')`,
  );
  check(cards.find((c) => c.user_id === A.id)?.level === 3, "A's card is +3");
  check(cards.find((c) => c.user_id === C.id)?.source === 'auction', "C's new card came from the auction");
  const wA = (await state(A)).data.wallet;
  const wB = (await state(B)).data.wallet;
  const wC = (await state(C)).data.wallet;
  const wD = (await state(D)).data.wallet;
  check(wA.balance === 98_600 && wA.held === 0, 'A paid 1,400 (98,600 left, nothing held)');
  check(wB.balance === 100_000 && wB.held === 0, 'B did not win: nothing paid, nothing held');
  check(wC.balance === 100_000 + 12_000 - 50_000 && wC.held === 0, 'C paid only the lot it won');
  check(wD.balance === 99_000, 'D paid 1,000');
  const ledger = d1<{ user_id: string; sum: number; balance: number; held: number; holds: number }>(
    `SELECT w.user_id, (SELECT COALESCE(SUM(amount), 0) FROM auction_transactions t WHERE t.user_id = w.user_id) AS sum, w.balance, w.held,
            (SELECT COALESCE(SUM(amount), 0) FROM auction_holds h WHERE h.user_id = w.user_id AND h.status = 'active') AS holds
       FROM auction_wallets w WHERE w.user_id IN ('${A.id}', '${B.id}', '${C.id}', '${D.id}', '${E.id}')`,
  );
  check(ledger.length === 5 && ledger.every((r) => r.sum === r.balance && r.held === r.holds), 'for every player: ledger = balance and held = active holds');
  const pts = d1<{ premium_points: number }>(`SELECT premium_points FROM exchange_wallets WHERE user_id = '${D.id}'`)[0];
  check(pts?.premium_points === 10, 'D received the exchange points');

  console.log('\n[unsold cards are listed again]');
  const listed = (await state(B)).data.market.lots;
  check(listed.some((l) => l.playerId === c4) && listed.some((l) => l.playerId === c5), 'the next cards of the queue are listed');
  // shorter lots from now on (the running ones keep their rules)
  await api('/api/admin/auction/settings', { method: 'PUT', token: at, body: { bidSeconds: 10 } });
  const c4Lot = listed.find((l) => l.playerId === c4)!;
  await sleep(Math.max(0, c4Lot.endsAt - Date.now()) + 1_500);
  const relisted = (await state(B)).data.market.lots;
  const c4Rows = d1<{ status: string }>(`SELECT status FROM auction_lots WHERE player_id = '${c4}' AND listed_at >= ${now} ORDER BY no`);
  check(c4Rows[0]?.status === 'unsold', 'a lot without bids ends unsold');
  check(relisted.some((l) => l.playerId === c4 && l.id !== c4Lot.id), 'the unsold card is listed again (queue end)');

  console.log('\n[admin: cancel a lot]');
  const c4New = relisted.find((l) => l.playerId === c4)!;
  const bc = await bid(B, c4New.id, 1_000);
  check(bc.status === 200 && (await state(B)).data.wallet.held === 1_000, 'B bids and holds 1,000');
  const cancel = await api(`/api/admin/auction/lots/${c4New.id}/cancel`, { token: at, body: { reason: 'e2e' } });
  check(cancel.status === 200, 'admin cancels the lot');
  const wB2 = (await state(B)).data.wallet;
  check(wB2.held === 0 && wB2.balance === 100_000, 'the hold is released, nothing paid');
  check(d1<{ status: string }>(`SELECT status FROM auction_lots WHERE id = '${c4New.id}'`)[0].status === 'cancelled', 'the lot is cancelled');
  check(d1(`SELECT 1 FROM admin_audit_logs WHERE action = 'auction.cancel' AND target_id = '${c4New.id}'`).length === 1, 'the cancel is in the admin log');

  console.log('\n[admin figures (spec 7) and permissions]');
  const ov = await api('/api/admin/auction/overview', { token: at });
  check(ov.status === 200 && ov.data.totals.sold >= 3 && ov.data.totals.totalPrice >= 52_400, 'total and average prices');
  check(ov.data.byRarity.find((r: { rarity: string }) => r.rarity === 'common').sold >= 3, 'average price by rarity');
  const pl = await api('/api/admin/auction/players', { token: at });
  check(pl.data.players.some((p: { playerId: string; sold: number }) => p.playerId === c1 && p.sold >= 1), 'price by player');
  check(pl.data.players.some((p: { playerId: string; unsold: number }) => p.playerId === c4 && p.unsold >= 1), 'unsold players');
  const bids = await api(`/api/admin/auction/bids?username=${B.username}`, { token: at });
  check(bids.status === 200 && bids.data.bids.length >= 3, 'bid history by player');
  const bal = await api(`/api/admin/auction/balances?q=${RUN}`, { token: at });
  check(bal.status === 200 && bal.data.balances.length >= 5, 'balances by player');
  const fraud = await api('/api/admin/auction/fraud?all=1&limit=500', { token: at });
  const kinds = new Set((fraud.data.logs as { kind: string; username: string | null }[]).filter((l) => l.username?.endsWith(RUN)).map((l) => l.kind));
  check(kinds.has('refused:MAX_LEVEL') && kinds.has('rate_limited') && kinds.has('refused:INSUFFICIENT_FUNDS'), 'refusals and the rate limit are logged');
  check(kinds.has('shared_network'), 'several accounts from one network on one lot are flagged');
  check((await api('/api/admin/auction/overview', { token: vt })).status === 200, 'viewer can read the figures');
  check((await api('/api/admin/auction/bids', { token: vt })).status === 403, 'viewer cannot see individual bids');

  console.log('\n[test data reset]');
  const rs = await api('/api/admin/beta/resets', { token: at, body: { target: { usernames: [C.username] }, note: 'e2e auction' } });
  await api(`/api/admin/beta/resets/${rs.data.id}/run`, { token: at, body: {} });
  const z = d1<{ balance: number; held: number }>(`SELECT balance, held FROM auction_wallets WHERE user_id = '${C.id}'`)[0];
  check(z.balance === 0 && z.held === 0, 'the reset empties the auction coins');
  check((await state(C)).data.wallet.balance === 100_000, 'the initial funds come again');

  // back to the normal market for local play
  again.ws.close();
  await api('/api/admin/auction/settings', { method: 'PUT', token: at, body: { ...DEFAULT_AUCTION_SETTINGS } });
  await api('/api/admin/auction/queue', { method: 'PUT', token: at, body: { playerIds: [] } });

  console.log(failures ? `\n${failures} check(s) failed` : '\nall auction checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
