/**
 * Plays one full league against a deployed API (staging) to check that the
 * game really works there: accounts, room, WebSocket, server-side draft with
 * CPU teams, lineups, match simulation (CPU time on Workers), standings,
 * history, the Phase 3 endpoints and the Phase 4 economy (wallet, login bonus,
 * gacha refusal without funds, match reward and missions after the league) and
 * Phase 5 (app sessions, feedback, admin APIs closed to players).
 *
 *   FD_API_URL=https://<api> npx tsx scripts/remote-check.ts
 *
 * Creates one test account ("check_<random>") in the target database.
 * Uses only the production rules (no test timings): takes about 5 minutes.
 */
import type { RoomSnapshot, ServerMessage } from '@fd/shared';

const API = (process.env.FD_API_URL ?? '').replace(/\/$/, '');
if (!API) throw new Error('FD_API_URL is required');
const WS = API.replace(/^http/, 'ws');
let failures = 0;
const t0 = Date.now();
const elapsed = () => `${Math.round((Date.now() - t0) / 1000)}s`;

function check(cond: unknown, label: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

async function api<T = any>(path: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API}${path}`, {
    method: opts.body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, data };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`remote check against ${API}`);
  const health = await api('/api/health');
  check(health.status === 200 && health.data.ok, `health (${JSON.stringify(health.data)})`);

  const username = `check_${Math.random().toString(36).slice(2, 8)}`;
  const reg = await api<{ token: string }>('/api/auth/register', { body: { username, password: 'check-password-1234', displayName: 'Check' } });
  check(reg.status === 201 && reg.data.token, 'register a test account');
  const token = reg.data.token;
  const players = await api('/api/players', { token });
  check(players.status === 200 && players.data.players?.length === 300, 'player database: 300 cards');
  for (const p of ['/api/ranked/me', '/api/solo/today', '/api/events', '/api/ranked/leaderboard']) {
    const r = await api(p, { token });
    check(r.status === 200, `GET ${p}`);
  }
  // ---------------------------------------------------------------- economy (Phase 4)
  const w0 = await api('/api/currency', { token });
  check(w0.status === 200 && w0.data.wallet?.coins === 0 && w0.data.wallet?.gems?.total === 0, 'new wallet: all balances 0');
  const lb = await api('/api/rewards/login', { token, body: {} });
  check(lb.status === 200 && lb.data.paid === 100 && lb.data.wallet?.coins === 100, 'login bonus: +100 COINS');
  const lb2 = await api('/api/rewards/login', { token, body: {} });
  check(lb2.data.paid === 0, 'login bonus only once per day');
  const banners = await api('/api/gacha/banners', { token });
  check(banners.status === 200 && banners.data.items?.length === 2, 'two gacha banners are open');
  const details = await api('/api/gacha/banners/premium-s1', { token });
  check(details.status === 200 && details.data.cards?.length === 180, 'Premium details: 180 cards');
  const poor = await api('/api/gacha/banners/standard/draw', { token, body: { count: 1, requestId: `check-${Math.random().toString(36).slice(2, 12)}` } });
  check(poor.status === 409 && poor.data.error?.code === 'INSUFFICIENT_FUNDS', 'a draw without enough COINS is refused');
  const missions = await api('/api/missions', { token });
  check(missions.status === 200 && missions.data.items?.length === 12, 'missions listed');
  const coll = await api('/api/collection', { token });
  check(coll.status === 200 && coll.data.counts?.total === 300, 'collection endpoint');
  const shop = await api('/api/exchange/catalog', { token });
  check(shop.status === 200 && shop.data.sections?.length === 2, 'exchange shop endpoint');
  const grant = await api('/api/admin/economy/test-grants', { token, body: { username, kind: 'COINS', amount: 1000 } });
  check(grant.status === 401, 'a player token cannot use admin test grants');

  // ---------------------------------------------------------------- Phase 5 (sessions, feedback, admin APIs closed to players)
  const sid = `check-${Math.random().toString(36).slice(2, 12)}`;
  check((await api('/api/sessions/start', { token, body: { sessionId: sid } })).status === 200, 'app session started');
  const fb = await api('/api/feedback', { token, body: { category: 'other', subject: 'staging check', body: 'automatic check from the Staging check workflow' } });
  check(fb.status === 201, 'feedback sent');
  const mine = await api('/api/feedback', { token });
  check(mine.status === 200 && mine.data.items?.[0]?.id === fb.data.id, 'own feedback listed');
  let closed = true;
  for (const p of ['/api/admin/overview', '/api/admin/users', '/api/admin/feedback', '/api/admin/distributions', '/api/admin/admins']) {
    if ((await api(p, { token })).status !== 401) closed = false;
  }
  check(closed, 'admin APIs refuse player tokens (overview, users, feedback, distributions, admins)');

  const badAdmin = await api('/api/admin/auth/login', { body: { username: 'nobody', password: 'wrong-password-123' } });
  check(badAdmin.status === 401, 'admin login rejects unknown accounts');

  // ---------------------------------------------------------------- league
  const room = await api<{ roomId: string }>('/api/rooms', { token, body: { settings: { pickSeconds: 5, fillWithCpu: true } } });
  check(room.status === 201, 'create a room');
  const { data: tk } = await api<{ ticket: string }>(`/api/rooms/${room.data.roomId}/ticket`, { token, body: {} });
  const ws = new WebSocket(`${WS}/api/rooms/${room.data.roomId}/ws?ticket=${encodeURIComponent(tk.ticket)}`);
  // (initialised via a cast so TypeScript does not narrow it to null; it is set in the message handler)
  let snap = null as RoomSnapshot | null;
  const pool = new Map<string, { id: string; primaryPosition: string }>();
  const errors: string[] = [];
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  const pickIfMine = () => {
    const s = snap;
    if (!s || s.phase !== 'drafting' || !s.draft || s.draft.currentSeat !== s.you) return;
    const taken = new Set(s.draft.picks.map((p) => p.playerId));
    const mineGk = s.draft.picks.some((p) => p.seat === s.you && pool.get(p.playerId)?.primaryPosition === 'GK');
    const cands = s.draft.pool.filter((id) => !taken.has(id)).map((id) => pool.get(id)!).filter(Boolean);
    const choice = (!mineGk ? cands.find((p) => p.primaryPosition === 'GK') : cands.find((p) => p.primaryPosition !== 'GK')) ?? cands[0];
    if (choice) send({ type: 'pick', playerId: choice.id });
  };
  let readySentFor = 0;
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMessage;
    if (msg.type === 'snapshot') {
      snap = msg.state;
      if (snap.phase === 'lineup' && readySentFor !== snap.matchday) {
        readySentFor = snap.matchday;
        send({ type: 'ready', ready: true });
      }
      pickIfMine();
    } else if (msg.type === 'players') for (const p of msg.players) pool.set(p.id, p);
    else if (msg.type === 'pick' && snap?.draft) {
      if (!snap.draft.picks.some((p) => p.pickNo === msg.pick.pickNo)) snap.draft.picks.push(msg.pick);
      snap.draft.currentSeat = msg.nextSeat;
      pickIfMine();
    } else if (msg.type === 'error') errors.push(msg.code);
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('websocket error')));
  });
  check(true, 'WebSocket connected');
  const wait = async (cond: () => boolean, label: string, ms: number) => {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > ms) throw new Error(`timeout: ${label} (phase ${snap?.phase})`);
      await sleep(250);
    }
  };
  await wait(() => !!snap, 'snapshot', 15_000);
  send({ type: 'start' });
  await wait(() => snap?.phase === 'drafting', 'draft start', 20_000);
  check(snap!.seats.filter((s) => s.isCpu).length === 3, `draft started with 3 CPU teams (${elapsed()})`);
  // the lineup phase can be very short (this client is ready at once), so accept any later phase
  await wait(() => !!snap && ['lineup', 'playing', 'finished'].includes(snap.phase), 'draft finished', 180_000);
  const s1 = snap;
  check(!!s1 && Object.values(s1.rosters).every((r) => r.length === 14), `56 picks done, every team has 14 players (${elapsed()})`);
  for (let md = 1; md <= 3; md++) {
    await wait(() => snap?.phase === 'playing' && snap.matchday === md, `matchday ${md} start`, 120_000);
    check(snap!.live.length === 2, `matchday ${md}: 2 matches simulated on the server (${elapsed()})`);
  }
  await wait(() => snap?.phase === 'finished', 'league finished', 240_000);
  const fin = snap;
  check(!!fin && fin.fixtures.every((f) => f.homeGoals !== null), `all 6 fixtures have results (${elapsed()})`);
  check(!!fin && Object.keys(fin.finalRanks ?? {}).length === 4, `final ranks: ${fin ? fin.standings.map((r) => `${r.rank}位 ${fin.seats[r.seat].displayName} ${r.points}点`).join(' / ') : '-'}`);
  ws.close();
  const hist = await api('/api/matches/history', { token });
  check(hist.status === 200 && hist.data.items?.length === 3, 'match history has my 3 matches');
  const myRank = fin?.you !== null && fin?.you !== undefined ? fin.finalRanks?.[fin.you] : undefined;
  const reward = fin?.you !== null && fin?.you !== undefined ? fin.outcome?.rewards?.[fin.you] : undefined;
  check(!!reward && reward.matchRewardGiven && reward.coins === 100 + ({ 1: 150, 2: 100, 3: 50, 4: 25 } as Record<number, number>)[myRank ?? 0], `match reward ${reward?.coins} COINS for rank ${myRank}`);
  check(!!reward && reward.missionsCompleted.includes('d-league'), `missions completed: ${reward?.missionsCompleted.join(', ')}`);
  const claim = await api('/api/missions/d-league/claim', { token, body: {} });
  check(claim.status === 200 && claim.data.paid === 100, 'claim the daily mission');
  const w1 = await api('/api/currency', { token });
  check(w1.data.wallet?.coins === 100 + (reward?.coins ?? 0) + 100, `wallet: ${w1.data.wallet?.coins} COINS (login + match reward + mission)`);
  check((await api('/api/sessions/end', { token, body: { sessionId: sid, durationMs: Date.now() - t0 } })).status === 200, 'app session ended');
  if (errors.length) console.log(`  (server errors received: ${errors.join(', ')})`);

  console.log(`\n${failures === 0 ? 'REMOTE CHECK PASSED' : `${failures} CHECK(S) FAILED`} in ${elapsed()}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`REMOTE CHECK CRASHED after ${elapsed()}:`, e);
  process.exit(1);
});
