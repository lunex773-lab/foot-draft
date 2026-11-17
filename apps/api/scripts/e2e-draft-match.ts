/**
 * DRAFT MATCH end-to-end test against a running local API (`npm run dev -w @fd/api`).
 *
 *   npm run e2e:draft-match -w @fd/api
 *
 *  - matching (decision 75): 2-4 people, no CPU, 4 start at once, 2-3 after the wait,
 *    one's own unfinished room is returned, a started room is not joined, leaving
 *  - formations: hidden until everybody chose, 4-3-3 when the time runs out
 *  - the common pool (decisions 79 / 81): 11 x people + 12, positions, rarities
 *  - チンチロ: the server rolls, results shown together, hands / re-matches / order
 *  - snake draft: refused picks (turn, taken card, full position group, same card at
 *    the same time), auto picks, every team matches its formation, records in D1
 *  - reconnecting restores the state; refused operations are in the audit log
 *  - team confirmation (formation fixed, no bench), round robin, ranking (rating,
 *    monthly), rewards like MATCH, the state history WAITING..COMPLETED
 *  - a 2-person room after the wait and a 3-person room where one person leaves
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DRAFT_MATCH_STATES,
  RARITIES,
  autoLineup,
  draftMatchAutoPick,
  evaluateHand,
  getCatalog,
  groupNeeds,
  groupOf,
  matchRewardFor,
  poolQuota,
  type DraftMatchServerMessage,
  type DraftMatchSnapshot,
  type FormationId,
  type Player,
} from '@fd/shared';

const API = process.env.FD_API_URL ?? 'http://127.0.0.1:8787';
const WS = API.replace(/^http/, 'ws');
const RUN = Math.random().toString(36).slice(2, 8);
const HERE = dirname(fileURLToPath(import.meta.url));
const catalog = getCatalog();
const byId = new Map(catalog.map((p) => [p.id, p]));
let failures = 0;

function check(cond: unknown, label: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  return { username, token: r.data.token, id: r.data.user.id, name };
}

async function waitFor(fn: () => boolean, label: string, timeoutMs = 120_000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(50);
  }
}

type User = Awaited<ReturnType<typeof register>>;

/** a player on a WebSocket; `auto` decides what the player does by itself */
class Client {
  ws: WebSocket | null = null;
  snap: DraftMatchSnapshot | null = null;
  errors: string[] = [];
  players = new Map<string, Player>();
  auto = { formation: null as FormationId | null, throw: true, pick: true, ready: true };
  /** what was already sent (a snapshot arrives often; send each action once) */
  sent = new Set<string>();
  constructor(
    public user: User,
    public roomId: string,
  ) {}

  async connect() {
    const t = await api<{ ticket: string }>(`/api/draft-match/${this.roomId}/ticket`, { token: this.user.token, body: {} });
    const ws = new WebSocket(`${WS}/api/draft-match/${this.roomId}/ws?ticket=${encodeURIComponent(t.data.ticket)}`);
    this.ws = ws;
    ws.addEventListener('message', (ev) => this.onMessage(JSON.parse(String(ev.data)) as DraftMatchServerMessage));
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error(`${this.user.name} ws error`)));
    });
    await waitFor(() => !!this.snap, `${this.user.name} snapshot`);
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }

  send(msg: unknown) {
    this.ws?.send(JSON.stringify(msg));
  }

  get seat() {
    return this.snap?.you ?? null;
  }

  onMessage(msg: DraftMatchServerMessage) {
    if (msg.type === 'snapshot') {
      this.snap = msg.state;
      this.act();
    } else if (msg.type === 'players') for (const p of msg.players) this.players.set(p.id, p);
    else if (msg.type === 'error') this.errors.push(msg.code);
  }

  act() {
    const s = this.snap!;
    const me = s.you;
    if (me === null) return;
    const once = (key: string, msg: unknown) => {
      if (this.sent.has(key)) return;
      this.sent.add(key);
      this.send(msg);
    };
    if (s.status === 'FORMATION_SELECTION' && this.auto.formation && !s.seats.find((x) => x.seat === me)?.formationChosen) once('formation', { type: 'formation', formation: this.auto.formation });
    const cur = s.chinchiro?.current;
    if (s.status === 'CHINCHIRO' && this.auto.throw && cur?.seats.includes(me) && !cur.thrown.includes(me)) once(`throw:${cur.round}:${cur.throwNo}`, { type: 'throw' });
    if (s.status === 'PLAYER_DRAFT' && this.auto.pick && s.draft?.currentSeat === me && this.players.size) {
      const formation = s.seats.find((x) => x.seat === me)!.formation!;
      const id = draftMatchAutoPick({ order: s.draft.order, picks: s.draft.picks, pool: s.pool! }, me, formation, this.players);
      once(`pick:${s.draft.picks.length}`, { type: 'pick', playerId: id });
    }
    if (s.status === 'TEAM_CONFIRMATION' && this.auto.ready && !s.lineupReady[me]) once(`ready:${s.matchday}`, { type: 'ready', ready: true });
  }
}

const FAST = { matchingSeconds: 2, lateJoinSeconds: 1, formationSeconds: 4, throwSeconds: 2, revealMs: 300, orderSeconds: 0.5, pickSeconds: 2.5, confirmSeconds: 8, betweenSeconds: 1, playbackSeconds: 1 };

async function main() {
  console.log(`DRAFT MATCH E2E against ${API} (run ${RUN})`);
  const users = await Promise.all(['dm_a', 'dm_b', 'dm_c', 'dm_d', 'dm_e'].map(register));
  const [a, b, c, d, e] = users;
  const tag = `e2e-${RUN}`;
  const settings = { ...FAST, queueTag: tag };

  // ------------------------------------------------------------ matching
  console.log('\n[matching]');
  const qa = await api('/api/draft-match/queue', { token: a.token, body: { settings } });
  const roomId = qa.data.roomId as string;
  check(qa.status === 201 && roomId, 'A opens a new room');
  const s0 = (await api<DraftMatchSnapshot>(`/api/draft-match/${roomId}`, { token: a.token })).data;
  check(s0.status === 'WAITING' && s0.seats.length === 1, 'one person: WAITING');
  const again = await api('/api/draft-match/queue', { token: a.token, body: { settings } });
  check(again.data.roomId === roomId && again.data.rejoined === true, "queueing again returns one's own room");
  check((await api(`/api/draft-match/${roomId}/ticket`, { token: b.token, body: {} })).status === 403, 'no ticket for people outside the room');
  const qb = await api('/api/draft-match/queue', { token: b.token, body: { settings } });
  check(qb.data.roomId === roomId, 'B is matched into the same room');
  const s1 = (await api<DraftMatchSnapshot>(`/api/draft-match/${roomId}`, { token: a.token })).data;
  check(s1.status === 'MATCHING' && s1.deadline !== null, '2 people: MATCHING with a deadline');
  const ca = new Client(a, roomId);
  const cb = new Client(b, roomId);
  await Promise.all([ca.connect(), cb.connect()]);
  ca.auto = { formation: null, throw: false, pick: false, ready: false };
  cb.auto = { formation: '3-5-2', throw: true, pick: true, ready: true };
  await Promise.all(
    [c, d].map((u) => api('/api/draft-match/queue', { token: u.token, body: { settings } })),
  );
  const cc = new Client(c, roomId);
  const cd = new Client(d, roomId);
  await Promise.all([cc.connect(), cd.connect()]);
  cc.auto = { formation: '4-2-3-1', throw: true, pick: true, ready: true };
  cd.auto = { formation: null, throw: false, pick: false, ready: true };
  await waitFor(() => ca.snap?.status === 'FORMATION_SELECTION', 'formation selection');
  check(ca.snap!.seats.length === 4 && ca.snap!.seats.map((x) => x.seat).join() === '0,1,2,3', '4 people: the room starts at once (seats 0-3)');
  const qe = await api('/api/draft-match/queue', { token: e.token, body: { settings } });
  check(qe.status === 201 && qe.data.roomId !== roomId, 'a started room is not joined: E gets a new room');
  check((await api(`/api/draft-match/${qe.data.roomId}/leave`, { token: e.token, body: {} })).status === 200, 'E leaves the waiting room');
  const se = d1<{ status: string }>(`SELECT status FROM draft_rooms WHERE id = '${qe.data.roomId}'`)[0];
  check(se?.status === 'CANCELLED', 'an empty waiting room is CANCELLED');

  // ------------------------------------------------------------ formations
  console.log('\n[formations]');
  ca.send({ type: 'formation', formation: '9-9-9' });
  await waitFor(() => ca.errors.includes('INVALID_FORMATION'), 'invalid formation refused');
  check(true, 'an unknown formation is refused');
  ca.send({ type: 'formation', formation: '4-4-2' });
  await waitFor(() => cb.snap!.seats.find((x) => x.seat === ca.seat)!.formationChosen, 'A chose');
  const bView = cb.snap!.seats.find((x) => x.seat === ca.seat)!;
  check(bView.formationChosen && bView.formation === null, "other people's formations are hidden until everybody chose");
  // D chooses nothing: 4-3-3 when the time runs out
  await waitFor(() => ca.snap?.status === 'CHINCHIRO', 'チンチロ', 30_000);
  const forms = Object.fromEntries(ca.snap!.seats.map((x) => [x.seat, x.formation]));
  check(forms[cd.seat!] === '4-3-3' && forms[ca.seat!] === '4-4-2' && forms[cb.seat!] === '3-5-2' && forms[cc.seat!] === '4-2-3-1', `formations shown to all (D ran out of time: ${forms[cd.seat!]})`);

  // ------------------------------------------------------------ pool
  console.log('\n[common pool]');
  const pool = ca.snap!.pool!;
  const fs = ca.snap!.seats.map((x) => x.formation!) as FormationId[];
  check(pool.length === 56 && new Set(pool).size === 56, 'pool: 11 x 4 + 12 = 56 different cards');
  check(JSON.stringify(cb.snap!.pool) === JSON.stringify(pool), 'everybody sees exactly the same cards');
  const quota = poolQuota(fs);
  check((['GK', 'DF', 'MF', 'FW'] as const).every((g) => pool.filter((id) => groupOf(byId.get(id)!) === g).length === quota[g]), `positions cover the formations + spares (${JSON.stringify(quota)})`);
  check(RARITIES.every((r) => pool.some((id) => byId.get(id)!.rarity === r)), 'every rarity is in the pool');
  check(d1<{ n: number }>(`SELECT COUNT(*) AS n FROM draft_card_pools WHERE room_id = '${roomId}'`)[0].n === 56, 'draft_card_pools has the 56 cards');

  // ------------------------------------------------------------ チンチロ
  console.log('\n[チンチロ]');
  const cur = ca.snap!.chinchiro!.current!;
  check(cur.round === 1 && cur.throwNo === 1 && cur.seats.length === 4, 'round 1: everybody throws');
  // C has thrown automatically by now; A throws twice / D (not tapping) is thrown automatically
  await waitFor(() => !!cb.snap?.chinchiro?.current?.thrown.includes(cb.seat!) || !!cb.snap?.chinchiro?.rounds[0]?.throws[cb.seat!]?.length, 'B threw');
  const hiddenView = ca.snap!.chinchiro!;
  check(JSON.stringify(hiddenView.rounds[0].throws[cb.seat!] ?? []) === '[]' || hiddenView.current === null, 'dice stay hidden until everybody threw');
  ca.send({ type: 'throw' });
  await sleep(150);
  ca.send({ type: 'throw' });
  await waitFor(() => ca.errors.includes('ALREADY_THROWN') || ca.errors.includes('NOT_YOUR_THROW') || ca.errors.includes('NOT_THROWING_NOW'), 'second throw refused');
  check(true, 'throwing twice is refused');
  ca.auto.throw = true;
  cd.auto.throw = false;
  await waitFor(() => ca.snap?.status === 'DRAFT_ORDER' || ca.snap?.status === 'PLAYER_DRAFT', 'draft order', 120_000);
  const ch = ca.snap!.chinchiro!;
  const positions = ca.snap!.draftPositions!;
  check(positions.length === 4 && new Set(positions).size === 4, `draft order decided: ${positions.map((s) => ca.snap!.seats[s].displayName).join(' → ')}`);
  const r1 = ch.rounds[0];
  const last = (seat: number) => r1.throws[seat][r1.throws[seat].length - 1];
  const strength = (seat: number) => evaluateHand(last(seat).dice).strength;
  let consistent = true;
  for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) if (strength(positions[i]) < strength(positions[j])) consistent = false;
  check(consistent, 'the order follows the hands of round 1 (equal hands decided by re-matches)');
  check(
    r1.seats.every((s) => {
      const t = r1.throws[s];
      return t.length >= 1 && t.length <= 3 && t.slice(0, -1).every((x) => x.hand.kind === 'none');
    }),
    'each player threw until a hand (at most 3 times)',
  );
  const autoThrows = r1.throws[cd.seat!].filter((t) => t.auto).length;
  check(autoThrows === r1.throws[cd.seat!].length, `D did not tap: the server threw (${autoThrows} automatic throw(s))`);
  check(ch.rounds.slice(1).every((r) => r.rematch && r.seats.length >= 2), `re-matches only for equal results (${ch.rounds.length - 1} re-match round(s))`);
  const totalThrows = ch.rounds.reduce((s, r) => s + Object.values(r.throws).reduce((x, t) => x + t.length, 0), 0);
  const diceRows = d1<{ n: number; bad: number }>(`SELECT COUNT(*) AS n, SUM(die1 NOT BETWEEN 1 AND 6 OR die2 NOT BETWEEN 1 AND 6 OR die3 NOT BETWEEN 1 AND 6) AS bad FROM draft_dice_results WHERE room_id = '${roomId}'`)[0];
  check(diceRows.n === totalThrows && !diceRows.bad, `every throw recorded in draft_dice_results (${diceRows.n})`);
  check(
    d1<{ draft_position: number; seat: number }>(`SELECT seat, draft_position FROM draft_participants WHERE room_id = '${roomId}' ORDER BY draft_position`)
      .map((r) => r.seat)
      .join() === positions.join(),
    'draft positions stored',
  );

  // ------------------------------------------------------------ draft
  console.log('\n[snake draft]');
  await waitFor(() => ca.snap?.status === 'PLAYER_DRAFT', 'draft started');
  const order = ca.snap!.draft!.order;
  check(order.length === 44 && order.slice(0, 4).join() === positions.join() && order.slice(4, 8).join() === [...positions].reverse().join(), 'snake order: 1→4, then 4→1');
  // a player who is not on turn
  const notTurn = [ca, cb, cc, cd].find((x) => x.seat !== ca.snap!.draft!.currentSeat)!;
  const free = () => pool.filter((id) => !ca.snap!.draft!.picks.some((p) => p.playerId === id));
  const r = await api(`/api/draft-match/${roomId}/action`, { token: notTurn.user.token, body: { type: 'pick', playerId: free()[0] } });
  check(r.status === 409 && r.data?.error?.code === 'NOT_YOUR_TURN', 'a pick out of turn is refused');
  // A picks by hand when on turn; first a card that does not fit, then the same card twice at the same time
  await waitFor(() => ca.snap?.draft?.currentSeat === ca.seat, "A's turn", 120_000);
  const aForm = forms[ca.seat!] as FormationId;
  const takenId = ca.snap!.draft!.picks[0]?.playerId;
  if (takenId) {
    const t = await api(`/api/draft-match/${roomId}/action`, { token: a.token, body: { type: 'pick', playerId: takenId } });
    check(t.data?.error?.code === 'ALREADY_PICKED', 'a card picked by somebody else is refused');
  } else check(true, '(A picks first: no taken card yet)');
  const choice = draftMatchAutoPick({ order, picks: ca.snap!.draft!.picks, pool }, ca.seat!, aForm, byId);
  const both = await Promise.all([
    api(`/api/draft-match/${roomId}/action`, { token: a.token, body: { type: 'pick', playerId: choice } }),
    api(`/api/draft-match/${roomId}/action`, { token: a.token, body: { type: 'pick', playerId: choice } }),
  ]);
  check(both.filter((x) => x.status === 200).length === 1, 'the same card sent twice at the same time: picked once');
  // A: a second goalkeeper for a formation with one GK
  await waitFor(() => ca.snap?.draft?.currentSeat === ca.seat, "A's 2nd turn", 120_000);
  const aRoster = ca.snap!.draft!.picks.filter((p) => p.seat === ca.seat).map((p) => byId.get(p.playerId)!);
  const gkFree = free().filter((id) => byId.get(id)!.primaryPosition === 'GK');
  if (aRoster.some((p) => p.primaryPosition === 'GK') && gkFree.length) {
    const g = await api(`/api/draft-match/${roomId}/action`, { token: a.token, body: { type: 'pick', playerId: gkFree[0] } });
    check(g.data?.error?.code === 'POSITION_FULL', 'a pick for a full position group is refused');
  } else {
    const gk = gkFree[0];
    await api(`/api/draft-match/${roomId}/action`, { token: a.token, body: { type: 'pick', playerId: gk } });
    await waitFor(() => ca.snap?.draft?.currentSeat === ca.seat, "A's 3rd turn", 120_000);
    const g = await api(`/api/draft-match/${roomId}/action`, { token: a.token, body: { type: 'pick', playerId: free().find((id) => byId.get(id)!.primaryPosition === 'GK')! } });
    check(g.data?.error?.code === 'POSITION_FULL', 'a pick for a full position group is refused');
  }
  // reconnect in the middle of the draft
  const before = cb.snap!.draft!.picks.length;
  cb.close();
  await sleep(300);
  await cb.connect();
  check(cb.snap!.status === 'PLAYER_DRAFT' && cb.snap!.draft!.picks.length >= before && cb.snap!.pool!.length === 56, 'reconnecting restores the room (pool, picks, turn)');
  // A lets the time run out from now on, D never picks
  await waitFor(() => ca.snap?.status === 'TEAM_CONFIRMATION', 'draft finished', 240_000);
  const picks = ca.snap!.draft!.picks;
  check(picks.length === 44 && new Set(picks.map((p) => p.playerId)).size === 44, '44 picks, no card twice');
  check(picks.filter((p) => p.seat === cd.seat).every((p) => p.auto), 'D never picked: every pick of D was automatic');
  let fit = true;
  for (const s of ca.snap!.seats) {
    const roster = ca.snap!.rosters[s.seat].map((id) => byId.get(id)!);
    const need = groupNeeds(s.formation!);
    if (roster.length !== 11 || (['GK', 'DF', 'MF', 'FW'] as const).some((g) => roster.filter((p) => groupOf(p) === g).length !== need[g])) fit = false;
  }
  check(fit, 'every team has 11 players matching its formation (GK/DF/MF/FW)');
  // ------------------------------------------------------------ team confirmation
  console.log('\n[team confirmation]');
  const myLineup = ca.snap!.lineups[ca.seat!]!;
  check(myLineup.formation === aForm && myLineup.starters.length === 11 && myLineup.bench.length === 0, 'the lineup: chosen formation, 11 players, no bench');
  const other = (['4-3-3', '4-4-2'] as FormationId[]).find((f) => f !== aForm)!;
  const lf = await api(`/api/draft-match/${roomId}/action`, { token: a.token, body: { type: 'lineup', lineup: { ...autoLineup(ca.snap!.rosters[ca.seat!].map((id) => byId.get(id)!), other), bench: [] } } });
  check(lf.data?.error?.code === 'FORMATION_LOCKED', 'another formation is refused');
  const swapped = { ...myLineup, starters: [...myLineup.starters] };
  [swapped.starters[1], swapped.starters[2]] = [swapped.starters[2], swapped.starters[1]];
  const ok = await api(`/api/draft-match/${roomId}/action`, { token: a.token, body: { type: 'lineup', lineup: { ...swapped, tactics: { ...swapped.tactics, tempo: 'fast' } }, ready: true } });
  check(ok.status === 200, 'positions and tactics can be changed');
  ca.auto.ready = true;

  check(pool.length - picks.length === 12, '12 cards were not picked');
  const dbPicks = d1<{ n: number; u: number }>(`SELECT COUNT(*) AS n, COUNT(DISTINCT player_id) AS u FROM draft_picks WHERE room_id = '${roomId}'`)[0];
  check(dbPicks.n === 44 && dbPicks.u === 44, 'draft_picks: 44 rows, unique cards');
  check(d1<{ n: number }>(`SELECT COUNT(*) AS n FROM draft_teams WHERE room_id = '${roomId}'`)[0].n === 4, 'draft_teams: 4 teams');


  // ------------------------------------------------------------ matches + result
  console.log('\n[matches and result]');
  await waitFor(() => ca.snap?.status === 'COMPLETED', 'completed', 240_000);
  const done = ca.snap!;
  check(done.fixtures.length === 6 && done.fixtures.every((f) => f.homeGoals !== null) && done.matchdays === 3, 'round robin: 3 matchdays, 6 matches');
  check(d1<{ n: number }>(`SELECT COUNT(*) AS n FROM draft_match_results WHERE room_id = '${roomId}'`)[0].n === 6, 'draft_match_results: 6 matches');
  const ranks = done.finalRanks!;
  const ranking = done.outcome!.ranking!;
  const deltas = Object.values(ranking.changes).map((x) => x.delta);
  check(ranking.rated && deltas.length === 4 && Math.abs(deltas.reduce((s, v) => s + v, 0)) <= 2, `ranking: rating changes ${deltas.join(', ')}`);
  const first = Number(Object.entries(ranks).find(([, rk]) => rk === 1)![0]);
  check(ranking.changes[first].delta > 0, '1st place gains rating');
  const rw = done.outcome!.rewards!;
  check(Object.entries(rw).every(([seat, x]) => x.coins === matchRewardFor(ranks[Number(seat)]).total && !x.exchangePoints), 'rewards: COINS by rank like MATCH, no exchange points');
  const board = await api('/api/draft-match/ranking', { token: a.token });
  check(board.status === 200 && [a, b, c, d].every((u) => board.data.items.some((x: any) => x.userId === u.id)), 'the ranking lists the 4 players');
  const me = await api('/api/draft-match/me', { token: a.token });
  check(me.data.games === 1 && me.data.position !== null && me.data.recent[0]?.room_id === roomId, 'my DRAFT MATCH rating, position and recent room');
  const hist = JSON.parse(d1<{ history_json: string }>(`SELECT history_json FROM draft_rooms WHERE id = '${roomId}'`)[0].history_json) as { status: string }[];
  const flow = hist.map((h) => h.status);
  check(
    flow.join() ===
      ['WAITING', 'MATCHING', 'FORMATION_SELECTION', 'POOL_GENERATION', 'CHINCHIRO', 'DRAFT_ORDER', 'PLAYER_DRAFT', 'TEAM_CONFIRMATION', 'SIMULATION', 'TEAM_CONFIRMATION', 'SIMULATION', 'TEAM_CONFIRMATION', 'SIMULATION', 'RESULT', 'COMPLETED'].join(),
    'state history follows the spec: WAITING → … → COMPLETED',
  );
  check(DRAFT_MATCH_STATES.length === 12, 'states of the spec + CANCELLED');
  const audits = d1<{ reason: string }>(`SELECT reason FROM draft_audit_logs WHERE room_id = '${roomId}'`).map((x) => x.reason);
  check(['INVALID_FORMATION', 'NOT_YOUR_TURN', 'POSITION_FULL', 'FORMATION_LOCKED'].every((x) => audits.includes(x)) && audits.some((x) => x === 'ALREADY_THROWN' || x === 'NOT_YOUR_THROW' || x === 'NOT_THROWING_NOW'), `refused operations are in the audit log (${audits.length})`);
  const part = d1<{ n: number }>(`SELECT COUNT(*) AS n FROM draft_participants WHERE room_id = '${roomId}' AND final_rank IS NOT NULL AND rating_after IS NOT NULL`)[0];
  check(part.n === 4, 'draft_participants: final ranks and rating changes');
  for (const x of [ca, cb, cc, cd]) x.close();

  // ------------------------------------------------------------ 2 people after the wait
  console.log('\n[2 people]');
  const [f2, g2] = await Promise.all(['dm_f', 'dm_g'].map(register));
  const tag2 = `${tag}-2`;
  const r2 = await api('/api/draft-match/queue', { token: f2.token, body: { settings: { ...FAST, queueTag: tag2 } } });
  await api('/api/draft-match/queue', { token: g2.token, body: { settings: { ...FAST, queueTag: tag2 } } });
  const cf = new Client(f2, r2.data.roomId);
  const cg = new Client(g2, r2.data.roomId);
  await Promise.all([cf.connect(), cg.connect()]);
  cf.auto = { formation: '4-3-3', throw: true, pick: true, ready: true };
  cg.auto = { formation: null, throw: false, pick: false, ready: false };
  await waitFor(() => cf.snap?.status === 'COMPLETED', '2-person room completed', 240_000);
  check(cf.snap!.seats.length === 2 && cf.snap!.pool!.length === 34 && cf.snap!.fixtures.length === 1, '2 people after the wait: pool 34, 1 match');
  check(Object.keys(cf.snap!.outcome!.ranking!.changes).length === 2, 'ranking for 2 people');
  cf.close();
  cg.close();

  // ------------------------------------------------------------ 3 people, one leaves
  console.log('\n[3 people, one leaves]');
  const [h3, i3, j3] = await Promise.all(['dm_h', 'dm_i', 'dm_j'].map(register));
  const tag3 = `${tag}-3`;
  const r3 = await api('/api/draft-match/queue', { token: h3.token, body: { settings: { ...FAST, queueTag: tag3 } } });
  await api('/api/draft-match/queue', { token: i3.token, body: { settings: { ...FAST, queueTag: tag3 } } });
  await api('/api/draft-match/queue', { token: j3.token, body: { settings: { ...FAST, queueTag: tag3 } } });
  const ch3 = new Client(h3, r3.data.roomId);
  const ci3 = new Client(i3, r3.data.roomId);
  const cj3 = new Client(j3, r3.data.roomId);
  await Promise.all([ch3.connect(), ci3.connect(), cj3.connect()]);
  for (const x of [ch3, ci3, cj3]) x.auto = { formation: '4-4-2', throw: true, pick: true, ready: true };
  await waitFor(() => ch3.snap?.status === 'PLAYER_DRAFT', '3-person draft', 120_000);
  const lv = await api(`/api/draft-match/${r3.data.roomId}/leave`, { token: j3.token, body: {} });
  check(lv.data.autopilot === true, 'leaving after the start: the server plays the seat');
  cj3.close();
  await waitFor(() => ch3.snap?.status === 'COMPLETED', '3-person room completed', 240_000);
  check(ch3.snap!.seats.length === 3 && ch3.snap!.pool!.length === 45 && ch3.snap!.fixtures.length === 3, '3 people: pool 45, 3 matches (one team rests each matchday)');
  check(ch3.snap!.seats.find((x) => x.userId === j3.id)!.left === true && ch3.snap!.rosters[ch3.snap!.seats.find((x) => x.userId === j3.id)!.seat].length === 11, 'the seat of the leaver was completed automatically');
  ch3.close();
  ci3.close();

  // ------------------------------------------------------------ admin
  console.log('\n[admin]');
  const admin = `dm_admin_${RUN}`;
  execFileSync('npx', ['tsx', join(HERE, 'create-admin.ts'), '--local', '--username', admin, '--role', 'viewer', '--no-totp'], {
    env: { ...process.env, FD_ADMIN_PASSWORD: 'admin-password-123' },
    cwd: join(HERE, '..'),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const vt = (await api('/api/admin/auth/login', { body: { username: admin, password: 'admin-password-123' } })).data.token as string;
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const st = await api(`/api/admin/draft-match?from=${today}&to=${today}`, { token: vt });
  check(st.status === 200 && st.data.states.some((x: any) => x.status === 'COMPLETED') && st.data.hands.length > 0 && st.data.audit.byReason.length > 0, 'admin: DRAFT MATCH rooms, チンチロ hands and the audit log');
  check((await api(`/api/admin/draft-match?from=${today}&to=${today}`, { token: a.token })).status === 401, 'admin: a player token is refused');
  const lb = await api(`/api/admin/seasons/${(await api('/api/draft-match/ranking', { token: a.token })).data.season.id}/leaderboard`, { token: vt });
  check(lb.status === 200 && lb.data.items.some((x: any) => x.userId === a.id), 'admin: the season leaderboard is the DRAFT MATCH ranking');

  // ------------------------------------------------------------ season (admin)
  console.log('\n[season]');
  const seasonId = (await api('/api/draft-match/ranking', { token: a.token })).data.season.id;
  check(d1<{ n: number }>(`SELECT COUNT(*) AS n FROM draft_rankings WHERE season_id = '${seasonId}' AND games > 0`)[0].n >= 9, 'draft_rankings: everybody who played this season');

  console.log(failures === 0 ? '\nDRAFT MATCH E2E: all checks passed' : `\nDRAFT MATCH E2E: ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('E2E crashed:', err);
  process.exit(1);
});
