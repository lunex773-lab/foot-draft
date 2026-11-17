/**
 * Phase 3 end-to-end test against a running local API (`npm run dev -w @fd/api`).
 *
 *   npm run e2e:phase3 -w @fd/api
 *
 *  - Ranked: 4 humans -> rating update (Elo), leaderboard, one ranked room at a time,
 *    no invite-code join, no manual start; 1 human -> CPU fill after the queue time, no rating change
 *  - Solo Challenge: today's challenge, immediate start, rule checks, goal result recorded
 *  - Special Events: admin preview / create / publish / archive (RBAC, audit log),
 *    event pool contains every target player, closed events cannot be joined
 *  - Admin seasons
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateGoal, matchesFilter, teamRecord, type FixtureResult, type Lineup, type Player, type RoomSnapshot, type ServerMessage } from '@fd/shared';

const API = process.env.FD_API_URL ?? 'http://127.0.0.1:8787';
const WS = API.replace(/^http/, 'ws');
const RUN = Math.random().toString(36).slice(2, 8);
const FAST = { pickSeconds: 2, lineupSecondsFirst: 2, lineupSecondsBetween: 1, playbackSeconds: 1, queueSeconds: 3 };
let failures = 0;

function check(cond: unknown, label: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

async function api<T = any>(path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<{ status: number; data: T }> {
  // the local dev server can drop a connection right after `wrangler d1 execute` touched the database
  for (let i = 0; ; i++) {
    try {
      return await apiOnce<T>(path, opts);
    } catch (e) {
      if (i >= 4) throw e;
      await sleep(1000);
    }
  }
}

async function apiOnce<T>(path: string, opts: { method?: string; token?: string; body?: unknown }): Promise<{ status: number; data: T }> {
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

async function waitFor(fn: () => boolean, label: string, timeoutMs = 180_000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(100);
  }
}

/** WebSocket client that picks quickly and keeps the server lineup */
class Client {
  ws: WebSocket | null = null;
  snap: RoomSnapshot | null = null;
  players = new Map<string, Player>();
  errors: string[] = [];
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
    } else if (msg.type === 'error') this.errors.push(msg.code);
  }

  maybePick() {
    const s = this.snap;
    if (!s || s.phase !== 'drafting' || !s.draft || s.draft.currentSeat !== s.you) return;
    const taken = new Set(s.draft.picks.map((p) => p.playerId));
    const mine = s.draft.picks.filter((p) => p.seat === s.you).map((p) => this.players.get(p.playerId));
    const needGk = !mine.some((p) => p?.primaryPosition === 'GK');
    const cands = s.draft.pool.filter((id) => !taken.has(id)).map((id) => this.players.get(id)!).filter(Boolean);
    const choice = needGk ? cands.find((p) => p.primaryPosition === 'GK') ?? cands[0] : cands.find((p) => p.primaryPosition !== 'GK') ?? cands[0];
    if (choice) this.send({ type: 'pick', playerId: choice.id });
  }
}

async function register(name: string) {
  const username = `${name}_${RUN}`;
  const r = await api<{ token: string; user: { id: string } }>('/api/auth/register', { body: { username, password: 'password-1234', displayName: name } });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.data)}`);
  return { username, token: r.data.token, id: r.data.user.id };
}

function createAdmin(name: string, role: 'admin' | 'viewer') {
  execFileSync('npx', ['tsx', join(dirname(fileURLToPath(import.meta.url)), 'create-admin.ts'), '--local', '--username', name, '--role', role, '--no-totp'], {
    env: { ...process.env, FD_ADMIN_PASSWORD: 'admin-password-123' },
    cwd: join(dirname(fileURLToPath(import.meta.url)), '..'),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function adminLogin(name: string) {
  // the local dev server can drop a connection right after `wrangler d1 execute` touched the database
  for (let i = 0; ; i++) {
    try {
      const r = await api('/api/admin/auth/login', { body: { username: name, password: 'admin-password-123' } });
      return r.data.token as string;
    } catch (e) {
      if (i >= 4) throw e;
      await sleep(1000);
    }
  }
}

async function main() {
  console.log(`Phase 3 E2E against ${API} (run ${RUN})`);

  // ------------------------------------------------------------ ranked x4
  console.log('\n[ranked: 4 humans]');
  const users = await Promise.all(['rk1', 'rk2', 'rk3', 'rk4'].map(register));
  const before = await api('/api/ranked/me', { token: users[0].token });
  check(before.status === 200 && before.data.rating === 1000 && before.data.tier === 'silver' && before.data.games === 0, 'new player: rating 1000 (silver), 0 games');
  const q: any[] = [];
  for (const u of users.slice(0, 3)) q.push((await api('/api/ranked/queue', { token: u.token, body: { settings: FAST } })).data);
  const roomId = q[0].roomId;
  check(q.every((x) => x.roomId === roomId), 'ranked queue puts players in the same room');
  const again = await api('/api/ranked/queue', { token: users[0].token, body: {} });
  check(again.data.roomId === roomId && again.data.rejoined === true, 'queueing again returns the ranked room you are in');
  const byCode = await api('/api/rooms/join', { token: users[3].token, body: { code: q[0].code } });
  check(byCode.status === 409 && byCode.data.error.code === 'ROOM_NOT_JOINABLE', 'ranked rooms cannot be joined with an invite code');
  const manual = await api(`/api/rooms/${roomId}/start`, { token: users[0].token, body: {} });
  check(manual.status === 403, 'ranked rooms cannot be started manually');
  const lobby = await api(`/api/rooms/${roomId}`, { token: users[0].token });
  check(lobby.data.phase === 'lobby' && lobby.data.mode === 'ranked' && lobby.data.lobbyDeadline > Date.now() - 1000, 'ranked lobby shows when CPU will fill');
  const clients = users.map((u) => new Client(u.username, u.token, roomId));
  for (const c of clients.slice(0, 3)) await c.connect();
  q.push((await api('/api/ranked/queue', { token: users[3].token, body: {} })).data);
  check(q[3].roomId === roomId, '4th player joins the same ranked room');
  await clients[3].connect();
  await waitFor(() => clients[0].snap?.phase === 'drafting' || clients[0].snap?.phase === 'lineup', 'ranked draft start', 20_000);
  check(clients[0].snap!.seats.every((s) => !s.isCpu), '4 humans: the draft starts at once, no CPU');
  await waitFor(() => clients.every((c) => c.snap?.phase === 'finished' && !!c.snap.outcome), 'ranked league finished');
  const out = clients[0].snap!.outcome!.ranked!;
  check(!!out && out.rated === true && Object.keys(out.changes).length === 4, 'rated: rating change for the 4 humans');
  const ranks = clients[0].snap!.finalRanks!;
  const deltas = Object.entries(out.changes).map(([seat, c]) => ({ rank: ranks[Number(seat)], ...c }));
  check(Math.abs(deltas.reduce((s, d) => s + d.delta, 0)) <= 2, `rating changes sum to ~0 (${deltas.map((d) => `${d.rank}位 ${d.delta >= 0 ? '+' : ''}${d.delta}`).join(', ')})`);
  check(deltas.find((d) => d.rank === 1)!.delta > 0 && deltas.find((d) => d.rank === 4)!.delta < 0, '1st gains, 4th loses');
  const winnerSeat = Number(Object.entries(ranks).find(([, r]) => r === 1)![0]);
  const winner = users.find((u) => clients.find((c) => c.token === u.token)!.snap!.you === winnerSeat)!;
  const me = await api('/api/ranked/me', { token: winner.token });
  check(me.data.rating === out.changes[winnerSeat].after && me.data.games === 1 && me.data.wins === 1 && me.data.recent[0].room_id === roomId, 'GET /api/ranked/me reflects the new rating');
  const board = await api('/api/ranked/leaderboard', { token: users[1].token });
  const mine = board.data.items.filter((r: any) => users.some((u) => u.id === r.userId));
  check(mine.length === 4 && board.data.items.every((r: any, i: number, a: any[]) => i === 0 || a[i - 1].rating >= r.rating), 'leaderboard lists the 4 players, ordered by rating');
  check(board.data.me.position !== null, 'leaderboard shows my position');
  for (const c of clients) c.close();

  // ------------------------------------------------------------ ranked x1
  console.log('\n[ranked: 1 human + CPU fill]');
  const lone = await register('rk_lone');
  const lq = await api('/api/ranked/queue', { token: lone.token, body: { settings: FAST } });
  check(lq.status === 201 && lq.data.roomId !== roomId, 'a new ranked room is created');
  const lc = new Client('lone', lone.token, lq.data.roomId);
  await lc.connect();
  await waitFor(() => lc.snap?.phase === 'drafting', 'CPU fill after the queue time', 15_000);
  check(lc.snap!.seats.filter((s) => s.isCpu).length === 3, 'after the queue time the empty seats are filled with 3 CPU teams');
  await waitFor(() => lc.snap?.phase === 'finished' && !!lc.snap.outcome, 'lone ranked league finished');
  const lo = lc.snap!.outcome!.ranked!;
  check(lo.rated === false && lo.changes[lc.snap!.you!].delta === 0, 'only one human: the rating does not change');
  const lme = await api('/api/ranked/me', { token: lone.token });
  check(lme.data.rating === 1000 && lme.data.games === 0 && lme.data.recent[0]?.rated === 0, 'unrated league is recorded but not counted');
  lc.close();

  // ------------------------------------------------------------ solo
  console.log('\n[solo challenge]');
  const solo = await register('solo');
  const today = await api('/api/solo/today', { token: solo.token });
  const ch = today.data.challenge;
  check(today.status === 200 && /^daily-\d{4}-\d{2}-\d{2}$/.test(ch.id) && today.data.attempts.length === 0, `today's challenge: ${ch.titleJa}（${ch.ruleJa}）`);
  const st = await api('/api/solo/start', { token: solo.token, body: { settings: FAST } });
  check(st.status === 201 && st.data.challengeId === ch.id, 'challenge started');
  const st2 = await api('/api/solo/start', { token: solo.token, body: {} });
  check(st2.status === 409, 'only one challenge at a time');
  const sc = new Client('solo', solo.token, st.data.roomId);
  await sc.connect();
  check(sc.snap!.phase === 'drafting' && sc.snap!.mode === 'solo' && sc.snap!.seats.filter((s) => s.isCpu).length === 3, 'draft starts immediately against 3 CPU teams');
  if (ch.rule.type === 'last_pick') check(sc.snap!.draft!.order[3] === sc.snap!.you, 'rule: you pick 4th');
  if (ch.pool.filter) check(sc.snap!.draft!.pool.every((id) => matchesFilter(sc.players.get(id)!, ch.pool.filter)), 'every candidate matches the challenge condition');
  await waitFor(() => sc.snap?.phase === 'lineup', 'solo lineup');
  if (ch.rule.type === 'fixed_formation') {
    const own = sc.snap!.lineups[sc.snap!.you!] as Lineup;
    check(own.formation === ch.rule.formation, `rule: lineup uses the fixed formation ${ch.rule.formation}`);
    sc.send({ type: 'lineup', lineup: { ...own, formation: own.formation === '4-4-2' ? '4-3-3' : '4-4-2' } });
    await waitFor(() => sc.errors.includes('FORMATION_LOCKED'), 'formation locked error', 5_000);
    check(true, 'changing the fixed formation is rejected (FORMATION_LOCKED)');
  }
  await waitFor(() => sc.snap?.phase === 'finished' && !!sc.snap.outcome, 'solo finished');
  const so = sc.snap!.outcome!.solo!;
  const results: FixtureResult[] = sc.snap!.fixtures.map((f) => ({ matchday: f.matchday, home: f.homeSeat, away: f.awaySeat, homeGoals: f.homeGoals!, awayGoals: f.awayGoals! }));
  const rec = teamRecord(sc.snap!.you!, sc.snap!.standings, results);
  check(so.cleared === evaluateGoal(ch.goal, rec), `goal "${ch.goalJa}" judged by the server: ${so.cleared ? 'cleared' : 'not cleared'} (rank ${rec.rank}, ${rec.goalsFor}-${rec.goalsAgainst})`);
  await sleep(500);
  const after = await api('/api/solo/today', { token: solo.token });
  check(after.data.attempts[0]?.status === (so.cleared ? 'cleared' : 'failed') && after.data.attempts[0]?.result?.rank === rec.rank, 'attempt result recorded');
  const hist = await api('/api/solo/history', { token: solo.token });
  check(hist.data.items[0]?.challengeId === ch.id && hist.data.items[0]?.attempts === 1, 'solo history');
  sc.close();

  // ------------------------------------------------------------ events
  console.log('\n[special events + admin]');
  const adminName = `evadmin_${RUN}`;
  const viewerName = `evviewer_${RUN}`;
  createAdmin(adminName, 'admin');
  createAdmin(viewerName, 'viewer');
  const at = await adminLogin(adminName);
  const vt = await adminLogin(viewerName);
  const preview = await api('/api/admin/events/preview', { token: vt, body: { filter: { nationalities: ['JPN', 'XXX'] } } });
  check(preview.status === 200 && preview.data.pool.eligible === 23 && preview.data.pool.included === 23 && preview.data.pool.pure === false, 'preview: 23 Japanese players, rest filled with others');
  const now = Date.now();
  const body = { name: `E2E Japanese Stars ${RUN}`, description: 'e2e', startsAt: now - 60_000, endsAt: now + 3_600_000, filter: { nationalities: ['JPN'] } };
  const vCreate = await api('/api/admin/events', { token: vt, body });
  check(vCreate.status === 403, 'viewer cannot create events');
  const userCreate = await api('/api/admin/events', { token: users[0].token, body });
  check(userCreate.status === 401, 'player token cannot create events');
  const bad = await api('/api/admin/events', { token: at, body: { ...body, endsAt: now - 120_000 } });
  check(bad.status === 400, 'invalid period rejected');
  const created = await api('/api/admin/events', { token: at, body });
  check(created.status === 201 && created.data.id, 'admin creates an event (draft)');
  const evId = created.data.id as string;
  const player = await register('eventer');
  const listDraft = await api('/api/events', { token: player.token });
  check(!listDraft.data.items.some((e: any) => e.id === evId), 'draft events are not shown to players');
  const joinDraft = await api(`/api/events/${evId}/join`, { token: player.token, body: {} });
  check(joinDraft.status === 404, 'draft events cannot be joined');
  const pub = await api(`/api/admin/events/${evId}/publish`, { token: at, body: {} });
  check(pub.status === 200, 'admin publishes the event');
  const list = await api('/api/events', { token: player.token });
  const ev = list.data.items.find((e: any) => e.id === evId);
  check(ev && ev.open === true && ev.conditions[0] === '国籍：日本', 'published event is listed and open');
  const ej = await api(`/api/events/${evId}/join`, { token: player.token, body: { settings: FAST } });
  check(ej.status === 201 || ej.status === 200, 'player joins the event');
  const evRoom = await api(`/api/rooms/${ej.data.roomId}`, { token: player.token });
  check(evRoom.data.mode === 'event' && evRoom.data.variant.eventId === evId, 'event room carries the event');
  const ec = new Client('eventer', player.token, ej.data.roomId);
  await ec.connect();
  ec.send({ type: 'start' });
  await waitFor(() => ec.snap?.phase === 'drafting' && ec.players.size >= 84, 'event draft');
  const pool = ec.snap!.draft!.pool;
  const japanese = [...ec.players.values()].filter((p) => p.nationality === 'JPN').length;
  check(pool.length === 84 && japanese === 23, 'event pool: all 23 Japanese players + 61 others');
  ec.close();
  const arch = await api(`/api/admin/events/${evId}/archive`, { token: at, body: {} });
  check(arch.status === 200, 'admin ends the event');
  const late = await api(`/api/events/${evId}/join`, { token: player.token, body: {} });
  check(late.status === 409 && late.data.error.code === 'EVENT_CLOSED', 'ended events cannot be joined');
  const logs = await api('/api/admin/audit-logs', { token: at });
  const actions = logs.data.items.filter((l: any) => l.target_id === evId).map((l: any) => l.action);
  check(['event_created', 'event_published', 'event_archived'].every((a) => actions.includes(a)), 'event operations are in the admin audit log');

  console.log('\n[admin seasons]');
  const seasons = await api('/api/admin/seasons', { token: vt });
  const cur = seasons.data.items[0];
  // since DRAFT MATCH (decision 77) the season ranking is the DRAFT MATCH ranking (checked in e2e-draft-match)
  check(seasons.status === 200 && /^\d{4}-\d{2}$/.test(cur.id) && cur.players >= 0, `current season ${cur.id}: ${cur.players} players, ${cur.rated_leagues} leagues`);
  const lb = await api(`/api/admin/seasons/${cur.id}/leaderboard`, { token: vt });
  check(lb.status === 200 && Array.isArray(lb.data.items), 'admin season leaderboard');

  console.log(`\n${failures === 0 ? 'ALL PHASE 3 CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
