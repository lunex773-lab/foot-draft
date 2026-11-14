/**
 * Phase 4 end-to-end test against a running local API (`npm run dev -w @fd/api`).
 *
 *   npm run e2e:phase4 -w @fd/api
 *
 *  - wallet: separate balances, login bonus once per day, ledger = balance
 *  - admin test grants: RBAC, audit log (production is covered by the unit test)
 *  - gacha: not enough COINS changes nothing, 10-draw, request id replay, parallel draws
 *    (balance never negative, no double spend), duplicates -> points, PAID GEMS spend order,
 *    pity status, transparency details, history
 *  - exchange shop: point type / rarity rules, owned card, not enough points
 *  - collection + Collection Draft: roster rules, reserved cards only for their owners
 *  - league rewards: match reward, missions (progress, claim once), daily cap of 10 leagues,
 *    solo clear bonus, season rewards (FREE GEMS)
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MISSIONS, matchRewardFor, type Player, type RoomSnapshot, type ServerMessage } from '@fd/shared';

const API = process.env.FD_API_URL ?? 'http://127.0.0.1:8787';
const WS = API.replace(/^http/, 'ws');
const RUN = Math.random().toString(36).slice(2, 8);
const FAST = { pickSeconds: 2, lineupSecondsFirst: 2, lineupSecondsBetween: 1, playbackSeconds: 1, queueSeconds: 3 };
const HERE = dirname(fileURLToPath(import.meta.url));
let failures = 0;

function check(cond: unknown, label: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

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
      // the local dev server can drop a connection right after `wrangler d1 execute`
      if (i >= 4) throw e;
      await sleep(1000);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rid = () => `e2e-${RUN}-${Math.random().toString(36).slice(2, 12)}`;

async function waitFor(fn: () => boolean, label: string, timeoutMs = 240_000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(100);
  }
}

function d1(sql: string) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', sql], { cwd: join(HERE, '..'), stdio: ['ignore', 'ignore', 'inherit'] });
}

function d1json<T>(sql: string): T[] {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', sql], { cwd: join(HERE, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  return JSON.parse(out)[0].results as T[];
}

/** WebSocket client: picks its own reserved cards first, never other players' reserved cards */
class Client {
  ws: WebSocket | null = null;
  snap: RoomSnapshot | null = null;
  players = new Map<string, Player>();
  errors: string[] = [];
  /** when set, the next own turn first tries a card reserved for another player (to test the RESERVED error) */
  tryOthersReserved = false;
  constructor(
    public name: string,
    public token: string,
    public roomId: string,
  ) {}

  async connect() {
    const { data } = await api<{ ticket: string }>(`/api/rooms/${this.roomId}/ticket`, { method: 'POST', token: this.token, body: {} });
    const ws = new WebSocket(`${WS}/api/rooms/${this.roomId}/ws?ticket=${encodeURIComponent(data.ticket)}`);
    this.ws = ws;
    ws.addEventListener('message', (ev) => this.onMessage(JSON.parse(String(ev.data)) as ServerMessage));
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error(`${this.name} ws error`)));
    });
    await waitFor(() => !!this.snap, `${this.name} snapshot`);
  }

  close() {
    this.ws?.close();
  }

  send(msg: unknown) {
    this.ws?.send(JSON.stringify(msg));
  }

  onMessage(msg: ServerMessage) {
    if (msg.type === 'snapshot') {
      this.snap = msg.state;
      this.maybePick();
    } else if (msg.type === 'players') {
      for (const p of msg.players) this.players.set(p.id, p);
    } else if (msg.type === 'pick') {
      if (this.snap?.draft) {
        if (!this.snap.draft.picks.some((p) => p.pickNo === msg.pick.pickNo)) this.snap.draft.picks.push(msg.pick);
        this.snap.draft.currentSeat = msg.nextSeat;
      }
      this.maybePick();
    } else if (msg.type === 'error') {
      this.errors.push(msg.code);
      if (msg.code === 'RESERVED') this.maybePick();
    }
  }

  maybePick() {
    const s = this.snap;
    if (!s || s.phase !== 'drafting' || !s.draft || s.draft.currentSeat !== s.you) return;
    const reserved = s.draft.reserved ?? {};
    const taken = new Set(s.draft.picks.map((p) => p.playerId));
    if (this.tryOthersReserved) {
      const other = s.draft.pool.find((id) => !taken.has(id) && reserved[id] && !reserved[id].includes(s.you!));
      this.tryOthersReserved = false;
      if (other) {
        this.send({ type: 'pick', playerId: other });
        return;
      }
    }
    const mine = s.draft.picks.filter((p) => p.seat === s.you).map((p) => this.players.get(p.playerId));
    const allowed = s.draft.pool.filter((id) => !taken.has(id) && (!reserved[id] || reserved[id].includes(s.you!)));
    const own = allowed.find((id) => reserved[id]?.includes(s.you!));
    const gks = mine.filter((p) => p?.primaryPosition === 'GK').length;
    const cands = allowed.map((id) => this.players.get(id)!).filter((p) => p && !(p.primaryPosition === 'GK' && gks >= 2));
    const choice = own ?? (gks === 0 ? cands.find((p) => p.primaryPosition === 'GK') ?? cands[0] : cands.find((p) => p.primaryPosition !== 'GK') ?? cands[0])?.id;
    if (choice) this.send({ type: 'pick', playerId: choice });
  }
}

async function register(name: string) {
  const username = `${name}_${RUN}`;
  const r = await api<{ token: string; user: { id: string } }>('/api/auth/register', { body: { username, password: 'password-1234', displayName: name } });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.data)}`);
  return { username, token: r.data.token, id: r.data.user.id };
}

function createAdmin(name: string, role: 'admin' | 'viewer') {
  execFileSync('npx', ['tsx', join(HERE, 'create-admin.ts'), '--local', '--username', name, '--role', role, '--no-totp'], {
    env: { ...process.env, FD_ADMIN_PASSWORD: 'admin-password-123' },
    cwd: join(HERE, '..'),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function adminLogin(name: string) {
  const r = await api('/api/admin/auth/login', { body: { username: name, password: 'admin-password-123' } });
  return r.data.token as string;
}

/** ledger of a user sums to the wallet, and every balance_after follows the previous one */
async function ledgerMatches(token: string): Promise<boolean> {
  const [w, h] = await Promise.all([api('/api/currency', { token }), api('/api/currency/history?limit=200', { token })]);
  const wallet = w.data.wallet;
  const expect: Record<string, number> = { COINS: wallet.coins, GEMS_FREE: wallet.gems.free, GEMS_PAID_PURCHASED: wallet.gems.paidPurchased, GEMS_PAID_GRANTED: wallet.gems.paidGranted };
  const rows = [...h.data.items].reverse() as { currency: string; amount: number; balance_after: number }[];
  const run: Record<string, number> = {};
  for (const r of rows) {
    run[r.currency] = (run[r.currency] ?? 0) + r.amount;
    if (run[r.currency] !== r.balance_after) return false;
  }
  return Object.entries(expect).every(([c, v]) => (run[c] ?? 0) === v);
}

async function playLeague(clients: Client[]) {
  await waitFor(() => clients.every((c) => c.snap?.phase === 'finished' && !!c.snap.outcome?.rewards), 'league finished with rewards');
}

async function main() {
  console.log(`Phase 4 E2E against ${API} (run ${RUN})`);
  const [a, b, cUser] = await Promise.all(['eco_a', 'eco_b', 'eco_c'].map(register));

  // ------------------------------------------------------------ wallet + login bonus
  console.log('\n[wallet + login bonus]');
  const w0 = await api('/api/currency', { token: a.token });
  check(
    w0.status === 200 && w0.data.wallet.coins === 0 && w0.data.wallet.gems.total === 0 && w0.data.wallet.points.standard === 0 && w0.data.login.claimedToday === false,
    'new player: all balances 0, login bonus not received',
  );
  const lb = await api('/api/rewards/login', { token: a.token, body: {} });
  check(lb.status === 200 && lb.data.paid === 100 && lb.data.streak === 1 && lb.data.wallet.coins === 100, 'login bonus: +100 COINS (day 1)');
  const lb2 = await api('/api/rewards/login', { token: a.token, body: {} });
  check(lb2.data.paid === 0 && lb2.data.wallet.coins === 100, 'login bonus only once per day');
  const [p1, p2] = await Promise.all([api('/api/rewards/login', { token: b.token, body: {} }), api('/api/rewards/login', { token: b.token, body: {} })]);
  check(p1.data.paid + p2.data.paid === 100, 'two simultaneous claims pay once');

  // ------------------------------------------------------------ gacha without funds
  console.log('\n[gacha: not enough]');
  const poor = await api('/api/gacha/banners/standard/draw', { token: a.token, body: { count: 1, requestId: rid() } });
  check(poor.status === 409 && poor.data.error.code === 'INSUFFICIENT_FUNDS', 'Standard draw with 100 COINS is rejected');
  const premiumPoor = await api('/api/gacha/banners/premium-s1/draw', { token: a.token, body: { count: 1, requestId: rid() } });
  check(premiumPoor.status === 409 && premiumPoor.data.error.code === 'INSUFFICIENT_FUNDS', 'Premium draw without PAID GEMS is rejected (FREE GEMS cannot be used)');
  const bad = await api('/api/gacha/banners/standard/draw', { token: a.token, body: { count: 3, requestId: rid() } });
  check(bad.status === 400, 'only 1 or 10 draws');
  const noId = await api('/api/gacha/banners/standard/draw', { token: a.token, body: { count: 1 } });
  check(noId.status === 400, 'a request id is required');
  const w1 = await api('/api/currency', { token: a.token });
  check(w1.data.wallet.coins === 100, 'nothing changed after the rejected draws');

  // ------------------------------------------------------------ admin test grants
  console.log('\n[admin test grants]');
  const adminName = `ecoadmin_${RUN}`;
  const viewerName = `ecoviewer_${RUN}`;
  createAdmin(adminName, 'admin');
  createAdmin(viewerName, 'viewer');
  const at = await adminLogin(adminName);
  const vt = await adminLogin(viewerName);
  const status = await api('/api/admin/economy/status', { token: at });
  check(status.status === 200 && status.data.testGrantsEnabled === true && status.data.environment === 'local', 'test grants are enabled locally');
  const grant = (token: string, username: string, kind: string, amount: number) => api('/api/admin/economy/test-grants', { token, body: { username, kind, amount, note: 'e2e' } });
  check((await grant(vt, a.username, 'COINS', 1000)).status === 403, 'viewer cannot grant');
  check((await grant(a.token, a.username, 'COINS', 1000)).status === 401, 'player token cannot grant');
  check((await grant(at, a.username, 'COINS', 0)).status === 400 && (await grant(at, a.username, 'COINS', 2_000_000)).status === 400, 'invalid amounts rejected');
  const g1 = await grant(at, a.username, 'COINS', 50_000);
  check(g1.status === 200 && g1.data.wallet.coins === 50_100, 'admin grants 50,000 COINS');
  await grant(at, a.username, 'GEMS_PAID_GRANTED', 600);
  const g3 = await grant(at, a.username, 'GEMS_PAID_PURCHASED', 1000);
  check(g3.data.wallet.gems.paidGranted === 600 && g3.data.wallet.gems.paidPurchased === 1000 && g3.data.wallet.gems.paid === 1600, 'PAID GEMS granted (distributed 600, purchased 1,000) and kept separately');
  const logs = await api('/api/admin/audit-logs', { token: at });
  check(logs.data.items.filter((l: any) => l.action === 'test_grant' && l.target_id === a.id).length === 3, 'every grant is in the audit log');
  const lookup = await api(`/api/admin/economy/users/${a.username}`, { token: at });
  check(lookup.status === 200 && lookup.data.wallet.coins === 50_100 && lookup.data.ledger[0].reason === 'test_grant', 'admin can look up the wallet and ledger');
  check((await api(`/api/admin/economy/users/${a.username}`, { token: vt })).status === 403, 'viewer cannot look up an individual wallet (decision 45)');

  // ------------------------------------------------------------ standard gacha
  console.log('\n[standard gacha]');
  const banners = await api('/api/gacha/banners', { token: a.token });
  // banners added in the admin site (Phase 6) may be open too; the two first ones must be
  const openIds: string[] = banners.data.items.map((x: any) => x.id);
  check(openIds.includes('standard') && openIds.includes('premium-s1'), `open banners: ${openIds.join(', ')}`);
  const details = await api('/api/gacha/banners/premium-s1', { token: a.token });
  const rateSum = Object.values(details.data.banner.ratesPpm as Record<string, number>).reduce((s, v) => s + v, 0);
  const cardSum = (details.data.cards as any[]).reduce((s, c) => s + c.ratePpm, 0);
  check(details.data.cards.length === 180 && details.data.counts.common === 0 && rateSum === 1_000_000 && Math.abs(cardSum - 1_000_000) < 1, 'Premium details: 180 cards, rates and per-card rates add up to 100%');
  check(details.data.banner.endsAt > Date.now() && details.data.banner.pityRules.epicAt === 50 && details.data.banner.pity.epicIn === 50, 'Premium details: end date, pity rules and state');
  const sd = await api('/api/gacha/banners/standard', { token: a.token });
  check(sd.data.cards.length === 291 && sd.data.counts.icon === 0 && sd.data.banner.pity === null, 'Standard details: 291 cards, no Icon, no pity');

  const req = rid();
  const d1r = await api('/api/gacha/banners/standard/draw', { token: a.token, body: { count: 10, requestId: req } });
  check(d1r.status === 200 && d1r.data.results.length === 10 && d1r.data.cost.amount === 10_000 && d1r.data.wallet.coins === 40_100, '10-draw: 10 cards for 10,000 COINS');
  check(d1r.data.results.every((r: any) => r.rarity !== 'icon' && r.guarantee === 'none' && !r.free), 'Standard: no Icon, no guarantees');
  const replay = await api('/api/gacha/banners/standard/draw', { token: a.token, body: { count: 10, requestId: req } });
  check(replay.data.drawId === d1r.data.drawId && replay.data.replayed === true, 'the same request id returns the same result');
  const w2 = await api('/api/currency', { token: a.token });
  check(w2.data.wallet.coins === 40_100, 'a repeated request is not charged twice');

  // parallel: 5 single draws (all affordable), then 5 10-draws with COINS for only 3 of them
  const singles = await Promise.all(Array.from({ length: 5 }, () => api('/api/gacha/banners/standard/draw', { token: a.token, body: { count: 1, requestId: rid() } })));
  check(singles.every((r) => r.status === 200), `5 single draws at the same time all succeed (${singles.map((r) => r.status).join(',')})`);
  const w3 = await api('/api/currency', { token: a.token });
  check(w3.data.wallet.coins === 35_100, `COINS: 35,100 after 5 parallel draws (got ${w3.data.wallet.coins})`);
  const tens = await Promise.all(Array.from({ length: 5 }, () => api('/api/gacha/banners/standard/draw', { token: a.token, body: { count: 10, requestId: rid() } })));
  const ok = tens.filter((r) => r.status === 200).length;
  const w4 = await api('/api/currency', { token: a.token });
  check(ok === 3 && tens.filter((r) => r.data?.error?.code === 'INSUFFICIENT_FUNDS').length === 2 && w4.data.wallet.coins === 5_100, `5 parallel 10-draws with COINS for 3: 3 succeed, 2 rejected, 5,100 left (ok ${ok}, coins ${w4.data.wallet.coins})`);
  const draws = [d1r, ...singles, ...tens.filter((r) => r.status === 200)].flatMap((r) => r.data.results);
  const coll = await api('/api/collection', { token: a.token });
  check(coll.data.counts.owned === new Set(draws.map((r: any) => r.playerId)).size && coll.data.counts.owned === draws.filter((r: any) => !r.duplicate).length, `collection = distinct cards drawn (${coll.data.counts.owned})`);
  const pts = draws.reduce((s: number, r: any) => s + r.points, 0);
  check(w4.data.wallet.points.standard === pts && pts > 0, `duplicates became ${pts} Standard points`);
  check(await ledgerMatches(a.token), 'ledger rows add up to the balances');
  const hist = await api('/api/gacha/history?limit=200', { token: a.token });
  check(hist.data.items.length === draws.length, 'draw history has every card');

  // ------------------------------------------------------------ premium gacha
  console.log('\n[premium gacha]');
  const pr = await api('/api/gacha/banners/premium-s1/draw', { token: a.token, body: { count: 10, requestId: rid() } });
  check(pr.status === 200 && pr.data.results.every((r: any) => r.rarity !== 'common'), 'Premium 10-draw: Rare or better only');
  check(pr.data.cost.split.GEMS_PAID_GRANTED === 600 && pr.data.cost.split.GEMS_PAID_PURCHASED === 400, 'PAID GEMS: distributed 600 used first, then 400 purchased');
  const w5 = await api('/api/currency', { token: a.token });
  check(w5.data.wallet.gems.paidGranted === 0 && w5.data.wallet.gems.paidPurchased === 600, 'balances after: distributed 0, purchased 600');
  const sinceEpic = (() => {
    let n = 0;
    for (const r of pr.data.results) n = ['epic', 'legendary', 'icon'].includes(r.rarity) ? 0 : n + 1;
    return n;
  })();
  check(pr.data.pity.total === 10 && pr.data.pity.epicIn === 50 - sinceEpic && pr.data.pity.bonusIn === 140, `pity state: total 10, Epic+ guaranteed in ${pr.data.pity.epicIn}, bonus in 140`);
  check(w5.data.wallet.points.premium === pr.data.pointsGained.amount, 'Premium duplicates become Premium points (kept apart from Standard)');

  // ------------------------------------------------------------ exchange shop
  console.log('\n[exchange shop]');
  await grant(at, a.username, 'POINTS_STANDARD', 5000);
  const cat = await api('/api/exchange/catalog', { token: a.token });
  const std = cat.data.sections.find((s: any) => s.pointType === 'standard');
  const prem = cat.data.sections.find((s: any) => s.pointType === 'premium');
  check(std.prices.map((p: any) => p.rarity).join(',') === 'common,rare,epic,legendary' && prem.prices.map((p: any) => p.rarity).join(',') === 'rare,epic,legendary,icon', 'Standard points: Common-Legendary, Premium points: Rare-Icon');
  check(std.cards.every((c: any) => !coll.data.items.some((o: any) => o.playerId === c.playerId)), 'the shop lists only cards not owned');
  const common = std.cards.find((c: any) => c.rarity === 'common');
  const before = (await api('/api/currency', { token: a.token })).data.wallet.points.standard;
  const ex = await api('/api/exchange/redeem', { token: a.token, body: { playerId: common.playerId, pointType: 'standard', requestId: rid() } });
  check(ex.status === 200 && ex.data.price === 100 && ex.data.wallet.points.standard === before - 100, 'exchange a Common card for 100 Standard points');
  const ex2 = await api('/api/exchange/redeem', { token: a.token, body: { playerId: common.playerId, pointType: 'standard', requestId: rid() } });
  check(ex2.status === 409, 'an owned card cannot be exchanged again');
  const icon = prem.cards.find((c: any) => c.rarity === 'icon');
  const ex3 = await api('/api/exchange/redeem', { token: a.token, body: { playerId: icon.playerId, pointType: 'standard', requestId: rid() } });
  check(ex3.status === 400, 'Icon cards cannot be bought with Standard points');
  const ex4 = await api('/api/exchange/redeem', { token: a.token, body: { playerId: icon.playerId, pointType: 'premium', requestId: rid() } });
  check(ex4.status === 409 && ex4.data.error.code === 'INSUFFICIENT_FUNDS', 'not enough Premium points for an Icon (10,000)');
  const exh = await api('/api/exchange/history', { token: a.token });
  check(exh.data.items.length === 1 && exh.data.items[0].player_id === common.playerId, 'exchange history');

  // ------------------------------------------------------------ roster + Collection Draft
  console.log('\n[collection draft]');
  const owned = (await api('/api/collection', { token: a.token })).data.items.map((o: any) => o.playerId) as string[];
  const notOwned = std.cards.find((c: any) => c.playerId !== common.playerId)!.playerId;
  check((await api('/api/collection/roster', { method: 'PUT', token: a.token, body: { playerIds: [notOwned] } })).status === 403, 'cards not owned cannot be registered');
  check((await api('/api/collection/roster', { method: 'PUT', token: a.token, body: { playerIds: owned.slice(0, 4) } })).status === 400, 'at most 3 cards');
  const aRoster = owned.slice(0, 3);
  const rr = await api('/api/collection/roster', { method: 'PUT', token: a.token, body: { playerIds: aRoster } });
  check(rr.status === 200 && rr.data.roster.join(',') === aRoster.join(','), 'A registers 3 owned cards');
  // B gets one card through the shop and registers it
  await grant(at, b.username, 'POINTS_PREMIUM', 10_000);
  const bCard = prem.cards.find((c: any) => c.rarity === 'icon' && !aRoster.includes(c.playerId))!.playerId as string;
  const bx = await api('/api/exchange/redeem', { token: b.token, body: { playerId: bCard, pointType: 'premium', requestId: rid() } });
  check(bx.status === 200 && bx.data.price === 10_000, 'B exchanges 10,000 Premium points for an Icon');
  await api('/api/collection/roster', { method: 'PUT', token: b.token, body: { playerIds: [bCard] } });

  const qa = await api('/api/collection/draft/quick', { token: a.token, body: { settings: FAST } });
  const qb = await api('/api/collection/draft/quick', { token: b.token, body: { settings: FAST } });
  check(qa.status === 201 && qb.data.roomId === qa.data.roomId, 'Collection Draft matchmaking puts A and B in the same room');
  const byCode = await api('/api/rooms/join', { token: cUser.token, body: { code: qa.data.code } });
  check(byCode.status === 409, 'Collection Draft rooms cannot be joined with a code');
  const ca = new Client('A', a.token, qa.data.roomId);
  const cb = new Client('B', b.token, qa.data.roomId);
  await ca.connect();
  await cb.connect();
  // B first tries to pick one of A's reserved cards
  cb.tryOthersReserved = true;
  await api(`/api/rooms/${qa.data.roomId}/start`, { token: a.token, body: {} });
  await waitFor(() => ca.snap?.phase === 'drafting' || ca.snap?.phase === 'lineup', 'collection draft start', 20_000);
  const res = ca.snap!.draft!.reserved;
  const seatA = ca.snap!.you!;
  const seatB = cb.snap!.you!;
  check(aRoster.every((id) => res[id]?.join() === String(seatA)) && res[bCard]?.join() === String(seatB), 'registered cards are in the pool, reserved for their owners');
  check(ca.snap!.draft!.pool.length === 84 + 4 && aRoster.every((id) => ca.snap!.draft!.pool.includes(id)), 'pool: 84 common candidates + 4 reserved cards');
  await waitFor(() => cb.errors.includes('RESERVED'), 'RESERVED error', 60_000);
  check(true, "B cannot pick A's reserved card (RESERVED)");
  await waitFor(() => ca.snap?.phase !== 'drafting', 'collection draft finished');
  const picks = ca.snap!.draft!.picks;
  check(picks.every((p) => !res[p.playerId] || res[p.playerId].includes(p.seat)), 'reserved cards went only to their owners (CPU auto picks respect them)');
  check(aRoster.every((id) => ca.snap!.rosters[seatA].includes(id)), 'A drafted the 3 own cards');
  await playLeague([ca, cb]);
  const out = ca.snap!.outcome!.rewards!;
  const rankA = ca.snap!.finalRanks![seatA];
  check(out[seatA].coins === matchRewardFor(rankA).total && out[seatA].matchRewardGiven && out[seatA].leaguesToday === 1, `A: match reward ${out[seatA].coins} COINS (rank ${rankA})`);
  check(out[seatA].missionsCompleted.includes('d-league') && out[seatA].missionsCompleted.includes('b-collection'), `missions completed by the league: ${out[seatA].missionsCompleted.join(', ')}`);
  ca.close();
  cb.close();

  // ------------------------------------------------------------ missions
  console.log('\n[missions]');
  const ms = await api('/api/missions', { token: a.token });
  const m = (id: string) => ms.data.items.find((x: any) => x.id === id);
  check(ms.data.items.length === MISSIONS.length && m('d-league').completed && m('b-gacha').completed && m('b-collection').completed && m('w-leagues').progress === 1, 'progress: daily league, beginner gacha / Collection Draft, weekly 1/10');
  const coinsBefore = (await api('/api/currency', { token: a.token })).data.wallet.coins;
  const cl = await api('/api/missions/d-league/claim', { token: a.token, body: {} });
  check(cl.status === 200 && cl.data.paid === 100 && cl.data.wallet.coins === coinsBefore + 100, 'claim the daily mission: +100 COINS');
  const cl2 = await api('/api/missions/d-league/claim', { token: a.token, body: {} });
  check(cl2.data.paid === 0, 'a mission reward is paid once');
  const cl3 = await api('/api/missions/w-leagues/claim', { token: a.token, body: {} });
  check(cl3.status === 409, 'an unfinished mission cannot be claimed');
  const gemsBefore = (await api('/api/currency', { token: a.token })).data.wallet.gems.free;
  const all = await api('/api/missions/claim-all', { token: a.token, body: {} });
  const freeGained = all.data.results.filter((r: any) => r.reward.currency === 'GEMS_FREE').reduce((s: number, r: any) => s + r.paid, 0);
  check(all.status === 200 && freeGained >= 100 && all.data.wallet.gems.free === gemsBefore + freeGained, `claim all: +${freeGained} FREE GEMS from beginner missions`);
  check(await ledgerMatches(a.token), 'ledger still adds up to the balances');

  // ------------------------------------------------------------ daily cap + solo bonus
  console.log('\n[daily cap of 10 leagues]');
  const rooms = d1json<{ id: string }>('SELECT id FROM rooms ORDER BY created_at LIMIT 10');
  const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  d1(`INSERT INTO daily_match_rewards (user_id, day_key, slot, room_id, created_at) VALUES ${rooms.map((r, i) => `('${cUser.id}', '${day}', ${i + 1}, '${r.id}', 0)`).join(', ')}`);
  let capFails = 0;
  try {
    d1(`INSERT INTO daily_match_rewards (user_id, day_key, slot, room_id, created_at) VALUES ('${cUser.id}', '${day}', 11, '${rooms[0].id}', 0)`);
  } catch {
    capFails++;
  }
  check(capFails === 1, 'the database refuses an 11th slot');
  const st = await api('/api/solo/start', { token: cUser.token, body: { settings: FAST } });
  const sc = new Client('C', cUser.token, st.data.roomId);
  await sc.connect();
  await playLeague([sc]);
  const sr = sc.snap!.outcome!.rewards![sc.snap!.you!];
  const cleared = sc.snap!.outcome!.solo!.cleared;
  check(!sr.matchRewardGiven && sr.leaguesToday === 10 && sr.coins === (cleared ? 200 : 0), `11th league today: no match reward${cleared ? ', solo clear bonus 200 COINS' : ' (challenge not cleared)'}`);
  const cm = await api('/api/missions', { token: cUser.token });
  check(cm.data.items.find((x: any) => x.id === 'd-league').completed && cm.data.items.find((x: any) => x.id === 'b-solo').completed, 'missions still count above the cap');
  sc.close();

  // ------------------------------------------------------------ season rewards
  console.log('\n[season rewards]');
  const old = '2000-01';
  d1(
    // a finished test season from an earlier run is reset first
    `DELETE FROM season_results WHERE season_id = '${old}'; DELETE FROM ranked_ratings WHERE season_id = '${old}'; DELETE FROM seasons WHERE id = '${old}'; ` +
      `INSERT INTO seasons (id, name, starts_at, ends_at, status, created_at) VALUES ('${old}', 'test', 0, 1000, 'active', 0); ` +
      `INSERT INTO ranked_ratings (season_id, user_id, rating, initial_rating, peak_rating, games, wins, created_at, updated_at) VALUES ('${old}', '${b.id}', 9999, 1000, 9999, 5, 3, 0, 0)`,
  );
  const bw = await api('/api/currency', { token: b.token });
  check(bw.data.wallet.gems.free === 300, 'season closed: 1st place receives 300 FREE GEMS');
  const bw2 = await api('/api/currency', { token: b.token });
  check(bw2.data.wallet.gems.free === 300, 'season reward paid once');
  check(await ledgerMatches(b.token), 'B ledger adds up');

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
