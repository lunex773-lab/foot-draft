/**
 * Plays one full league against a deployed API (staging) to check that the
 * game really works there: accounts, room, WebSocket, server-side draft with
 * CPU teams, lineups, match simulation (CPU time on Workers), standings,
 * history, and the Phase 3 endpoints.
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
  if (errors.length) console.log(`  (server errors received: ${errors.join(', ')})`);

  console.log(`\n${failures === 0 ? 'REMOTE CHECK PASSED' : `${failures} CHECK(S) FAILED`} in ${elapsed()}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`REMOTE CHECK CRASHED after ${elapsed()}:`, e);
  process.exit(1);
});
