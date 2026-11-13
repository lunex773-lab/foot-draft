/**
 * End-to-end test against a running local API (`npm run dev -w @fd/api`).
 *
 *   npm run e2e -w @fd/api            (API at http://127.0.0.1:8787)
 *
 * Plays a full online league with 4 real WebSocket clients:
 *  - register / login, private room, invite code, membership checks
 *  - 56-pick snake draft (one player never picks -> server auto picks on timeout)
 *  - invalid picks are rejected, one client disconnects and reconnects
 *  - lineups, 3 matchdays, final standings, match history, reproducibility
 *  - quick match with CPU fill
 *  - admin auth separation, card list, audit log
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GAME_CONFIG,
  simulateMatch,
  type Lineup,
  type Player,
  type RoomSnapshot,
  type ServerMessage,
} from '@fd/shared';

const API = process.env.FD_API_URL ?? 'http://127.0.0.1:8787';
const WS = API.replace(/^http/, 'ws');
const RUN = Math.random().toString(36).slice(2, 8);
let failures = 0;

function check(cond: unknown, label: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

async function api<T = any>(path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<{ status: number; data: T }> {
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
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn: () => boolean, label: string, timeoutMs = 120_000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(100);
  }
}

class Client {
  ws: WebSocket | null = null;
  snap: RoomSnapshot | null = null;
  players = new Map<string, Player>();
  errors: string[] = [];
  autoPick = true;
  picksMade = 0;
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

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.snap = null;
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
        this.snap.draft.deadline = msg.deadline;
      }
      this.maybePick();
    } else if (msg.type === 'error') {
      this.errors.push(msg.code);
    }
  }

  maybePick() {
    const s = this.snap;
    if (!this.autoPick || !s || s.phase !== 'drafting' || !s.draft || s.draft.currentSeat !== s.you) return;
    const taken = new Set(s.draft.picks.map((p) => p.playerId));
    const mine = s.draft.picks.filter((p) => p.seat === s.you).map((p) => this.players.get(p.playerId)!);
    const gks = mine.filter((p) => p?.primaryPosition === 'GK').length;
    const needGk = gks === 0;
    const cands = s.draft.pool
      .filter((id) => !taken.has(id))
      .map((id) => this.players.get(id)!)
      .filter((p) => p && (needGk ? true : p.primaryPosition !== 'GK'));
    const choice = needGk ? cands.find((p) => p.primaryPosition === 'GK') ?? cands[0] : cands[0];
    if (choice) {
      this.picksMade++;
      this.send({ type: 'pick', playerId: choice.id });
    }
  }
}

async function register(name: string) {
  const username = `${name}_${RUN}`;
  const r = await api<{ token: string; user: { id: string } }>('/api/auth/register', { body: { username, password: 'password-1234', displayName: name } });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.data)}`);
  return { username, token: r.data.token, id: r.data.user.id };
}

async function main() {
  console.log(`E2E against ${API} (run ${RUN})`);
  const health = await api('/api/health');
  check(health.status === 200 && health.data.ok, 'health endpoint');

  console.log('\n[auth]');
  const [a, b, c, d] = await Promise.all(['alice', 'bob', 'carol', 'dave'].map(register));
  check(!!a.token, 'register returns a token');
  const dup = await api('/api/auth/register', { body: { username: a.username, password: 'password-1234' } });
  check(dup.status === 409, 'duplicate username rejected (409)');
  const badLogin = await api('/api/auth/login', { body: { username: a.username, password: 'wrong-password' } });
  check(badLogin.status === 401, 'wrong password rejected (401)');
  const login = await api('/api/auth/login', { body: { username: a.username, password: 'password-1234' } });
  check(login.status === 200 && login.data.token, 'login works');
  const me = await api('/api/users/me', { token: login.data.token });
  check(me.status === 200 && me.data.user.username === a.username, 'GET /api/users/me');
  const noAuth = await api('/api/users/me');
  check(noAuth.status === 401, 'unauthenticated request rejected');
  const players = await api('/api/players', { token: a.token });
  check(players.status === 200 && players.data.players.length === GAME_CONFIG.catalogSize, `GET /api/players returns ${GAME_CONFIG.catalogSize} cards`);

  console.log('\n[private room]');
  const created = await api('/api/rooms', {
    token: a.token,
    body: { settings: { pickSeconds: 2, fillWithCpu: true, lineupSecondsFirst: 4, lineupSecondsBetween: 3, playbackSeconds: 2 } },
  });
  check(created.status === 201 && created.data.code?.length === 6, `room created with code ${created.data.code}`);
  const roomId = created.data.roomId as string;
  for (const u of [b, c, d]) {
    const j = await api('/api/rooms/join', { token: u.token, body: { code: created.data.code } });
    check(j.status === 200 && j.data.roomId === roomId, `${u.username.split('_')[0]} joined by invite code`);
  }
  const outsider = await register('eve');
  const full = await api('/api/rooms/join', { token: outsider.token, body: { code: created.data.code } });
  check(full.status === 409 && full.data.error.code === 'ROOM_FULL', '5th player gets ROOM_FULL');
  const wrong = await api('/api/rooms/join', { token: outsider.token, body: { code: 'ZZZZZZ' } });
  check(wrong.status === 404, 'unknown code -> 404');
  const tk = await api(`/api/rooms/${roomId}/ticket`, { method: 'POST', token: outsider.token, body: {} });
  check(tk.status === 403, 'non-member cannot get a websocket ticket');
  const forged = await new Promise<string>((resolve) => {
    const ws = new WebSocket(`${WS}/api/rooms/${roomId}/ws?ticket=forged.ticket`);
    ws.addEventListener('open', () => {
      ws.close();
      resolve('open');
    });
    ws.addEventListener('error', () => resolve('rejected'));
  });
  check(forged === 'rejected', 'forged websocket ticket rejected');

  const clients = [new Client('alice', a.token, roomId), new Client('bob', b.token, roomId), new Client('carol', c.token, roomId), new Client('dave', d.token, roomId)];
  clients[3].autoPick = false; // dave never picks -> server timeouts
  await Promise.all(clients.map((cl) => cl.connect()));
  check(clients.every((cl) => cl.snap?.phase === 'lobby'), 'all 4 clients connected (lobby)');
  await waitFor(() => clients.every((cl) => cl.snap!.seats.every((s) => s.userId && s.connected)), 'all connected', 5000).catch(() => undefined);
  check(clients.every((cl) => cl.snap!.seats.every((s) => s.userId && s.connected)), 'every client sees all 4 seats occupied and connected');
  const notHost = await api(`/api/rooms/${roomId}/start`, { method: 'POST', token: b.token, body: {} });
  check(notHost.status === 403, 'only the host can start');

  console.log('\n[draft]');
  const t0 = Date.now();
  clients[0].send({ type: 'start' });
  await waitFor(() => clients.every((cl) => cl.snap?.phase === 'drafting' && cl.players.size === 84), 'draft start');
  check(true, 'draft started, pool of 84 players delivered to every client');
  const order = clients[0].snap!.draft!.order;
  check(order.length === 56, 'snake order has 56 picks');
  check(order[3] === order[4] && order[0] === order[7], 'order follows P1 P2 P3 P4 P4 P3 P2 P1');

  // invalid pick: someone who is not on the clock
  const onClock = clients[0].snap!.draft!.currentSeat;
  const offClock = clients.find((cl) => cl.snap!.you !== onClock && cl.name !== 'dave')!;
  offClock.send({ type: 'pick', playerId: clients[0].snap!.draft!.pool[0] });
  await waitFor(() => offClock.errors.includes('NOT_YOUR_TURN'), 'NOT_YOUR_TURN error');
  check(true, 'pick out of turn rejected (NOT_YOUR_TURN)');

  // carol disconnects for a while, then reconnects
  await waitFor(() => (clients[0].snap?.draft?.picks.length ?? 0) >= 10, '10 picks');
  clients[2].autoPick = false;
  clients[2].disconnect();
  await sleep(2500);
  await waitFor(() => clients[0].snap!.seats[clients[0].snap!.seats.findIndex((s) => s.displayName === 'carol')]?.connected === false, 'carol shown as disconnected', 5000).catch(() => undefined);
  const carolShownOffline = clients[0].snap!.seats.find((s) => s.displayName === 'carol')?.connected === false;
  check(carolShownOffline, 'other players see the disconnection');
  clients[2].autoPick = true;
  await clients[2].connect();
  check((clients[2].snap?.draft?.picks.length ?? 0) >= 10, `reconnected client receives the current draft state (${clients[2].snap?.draft?.picks.length} picks)`);

  await waitFor(() => clients[0].snap?.phase === 'lineup', 'draft complete', 180_000);
  const snap = clients[0].snap!;
  const picks = snap.draft!.picks;
  check(picks.length === 56, '56 picks completed');
  check(new Set(picks.map((p) => p.playerId)).size === 56, 'no player picked twice');
  check([0, 1, 2, 3].every((s) => snap.rosters[s]?.length === 14), 'every team has 14 players');
  const daveSeat = clients[3].snap!.you!;
  check(picks.filter((p) => p.seat === daveSeat).every((p) => p.auto), "the idle player's picks were all auto picks (timeouts)");
  const gkOk = [0, 1, 2, 3].every((s) => {
    const n = snap.rosters[s].filter((id) => clients[0].players.get(id)!.primaryPosition === 'GK').length;
    return n >= 1 && n <= GAME_CONFIG.maxGkPerTeam;
  });
  check(gkOk, 'every team has 1-3 goalkeepers');
  console.log(`    draft took ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  console.log('\n[lineups & matches]');
  const own = clients[0].snap!.lineups[clients[0].snap!.you!]!;
  check(!!own && own.starters.length === 11 && own.bench.length === 3, 'auto lineup prepared (11 + 3)');
  const bad: Lineup = { ...own, starters: own.starters.slice(0, 10) };
  clients[0].send({ type: 'lineup', lineup: bad, ready: true });
  await waitFor(() => clients[0].errors.includes('INVALID_STARTERS'), 'invalid lineup error');
  check(true, 'invalid lineup rejected');
  const changed: Lineup = { ...own, tactics: { ...own.tactics, offense: 'counter', defense: 'low_block' } };
  for (const cl of clients.slice(0, 3)) {
    const l = cl === clients[0] ? changed : cl.snap!.lineups[cl.snap!.you!]!;
    cl.send({ type: 'lineup', lineup: l, ready: true });
  }
  await waitFor(() => clients[0].snap?.phase === 'playing', 'matchday 1 playing', 30_000);
  const live = clients[0].snap!.live;
  check(live.length === 2, 'matchday 1: 2 matches played simultaneously');
  const myMatch = live.find((m) => m.homeSeat === clients[0].snap!.you || m.awaySeat === clients[0].snap!.you)!;
  const mySide = myMatch.homeSeat === clients[0].snap!.you ? 'home' : 'away';
  check(myMatch.result.tactics[mySide].offense === 'counter', 'submitted tactics were used in the match');
  await waitFor(() => clients[0].snap?.phase === 'finished', 'league finished', 120_000);
  const fin = clients[0].snap!;
  check(fin.fixtures.every((f) => f.homeGoals !== null), 'all 6 fixtures have results');
  check(Object.keys(fin.finalRanks ?? {}).length === 4, 'final ranks for 4 teams');
  check(fin.standings.every((r) => r.played === 3), 'every team played 3 matches');
  const pts = fin.standings.reduce((s, r) => s + r.points, 0);
  const draws = fin.fixtures.filter((f) => f.homeGoals === f.awayGoals).length;
  check(pts === 6 * 3 - draws, 'standings points are consistent with results');

  console.log('\n[history & reproducibility]');
  const hist = await api('/api/matches/history', { token: a.token });
  check(hist.status === 200 && hist.data.items.length === 3, 'match history has 3 matches');
  const detail = await api(`/api/matches/${hist.data.items[0].id}`, { token: a.token });
  check(detail.status === 200 && detail.data.events.length > 5, 'match detail with events');
  const re = simulateMatch({
    seed: detail.data.match.seed,
    home: { seat: detail.data.home.seat, name: detail.data.home.name, players: detail.data.home.players, lineup: detail.data.home.lineup },
    away: { seat: detail.data.away.seat, name: detail.data.away.name, players: detail.data.away.players, lineup: detail.data.away.lineup },
  });
  check(
    re.score.home === detail.data.result.home_goals && re.score.away === detail.data.result.away_goals && JSON.stringify(re.events) === JSON.stringify(detail.data.events),
    'stored seed + teams reproduce the exact same match (spec 6-4)',
  );
  const uh = await api('/api/users/me/history', { token: a.token });
  check(uh.status === 200 && uh.data.items.some((r: any) => r.room_id === roomId && r.final_rank >= 1), 'league history with final rank');
  for (const cl of clients) cl.disconnect();

  console.log('\n[quick match]');
  const [q1, q2] = await Promise.all([register('quick1'), register('quick2')]);
  const qa = await api('/api/rooms/quick', { token: q1.token, body: {} });
  const qb = await api('/api/rooms/quick', { token: q2.token, body: {} });
  check(qa.data.roomId && qa.data.roomId === qb.data.roomId, 'two quick-match players are put in the same room');
  const qs = await api(`/api/rooms/${qa.data.roomId}/start`, { method: 'POST', token: q1.token, body: {} });
  check(qs.status === 200, 'host starts the quick match');
  const qstate = await api(`/api/rooms/${qa.data.roomId}`, { token: q1.token });
  check(qstate.data.phase === 'drafting' && qstate.data.seats.filter((s: any) => s.isCpu).length === 2, 'empty seats filled with 2 CPU teams');

  console.log('\n[admin]');
  const userOnAdmin = await api('/api/admin/cards', { token: a.token });
  check(userOnAdmin.status === 401, 'player token cannot access the admin API');
  const adminName = `admin_${RUN}`;
  execFileSync('npx', ['tsx', join(dirname(fileURLToPath(import.meta.url)), 'create-admin.ts'), '--local', '--username', adminName, '--role', 'viewer', '--no-totp'], {
    env: { ...process.env, FD_ADMIN_PASSWORD: 'admin-password-123' },
    cwd: join(dirname(fileURLToPath(import.meta.url)), '..'),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const badAdmin = await api('/api/admin/auth/login', { body: { username: adminName, password: 'nope-nope-nope' } });
  check(badAdmin.status === 401, 'admin login with wrong password rejected');
  const adminLogin = await api('/api/admin/auth/login', { body: { username: adminName, password: 'admin-password-123' } });
  check(adminLogin.status === 200 && adminLogin.data.token, 'admin login works');
  const at = adminLogin.data.token as string;
  const adminOnUser = await api('/api/users/me', { token: at });
  check(adminOnUser.status === 401, 'admin token is not a player session');
  const cards = await api('/api/admin/cards', { token: at });
  check(cards.status === 200 && cards.data.total === 240, 'admin card list returns 240 cards');
  check(cards.data.counts.icon === 8 && cards.data.counts.common === 96, 'rarity counts (icon 8, common 96)');
  const icons = await api('/api/admin/cards?rarity=icon&sort=ovr', { token: at });
  check(icons.data.total === 8 && icons.data.items[0].ovr >= icons.data.items[7].ovr, 'filter by rarity + sort by OVR');
  const one = await api('/api/admin/cards/fd0001', { token: at });
  check(one.status === 200 && one.data.player.name === 'Elias Voss' && one.data.player.ovr === 64, 'card detail (Elias Voss, 64)');
  const audit = await api('/api/admin/audit-logs', { token: at });
  check(audit.status === 403, 'viewer role cannot read audit logs (RBAC)');

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
