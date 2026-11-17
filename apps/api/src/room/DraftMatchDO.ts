import {
  CHINCHIRO_CONFIG,
  DRAFT_MATCH_CONFIG,
  FORMATIONS,
  GAME_CONFIG,
  autoLineup,
  buildDraftMatchPool,
  canMove,
  computeChemistry,
  computeStandings,
  cryptoRandom,
  dmCurrentSeat,
  dmRoster,
  draftMatchAutoPick,
  draftMatchOrder,
  eloFromRanks,
  evaluateHand,
  groupOf,
  nextTieGroup,
  resolveGroup,
  rollDice,
  roundRobin,
  simulateMatch,
  splitByResult,
  turnFinished,
  turnResult,
  validateDraftMatchPick,
  validateLineup,
  type Dice,
  type DmChinchiroRound,
  type DmSeat,
  type DraftMatchClientMessage,
  type DraftMatchOutcome,
  type DraftMatchServerMessage,
  type DraftMatchSnapshot,
  type DraftMatchStatus,
  type DraftPick,
  type FixtureResult,
  type FormationId,
  type Lineup,
  type LiveMatch,
  type MatchSummary,
  type Player,
  type RankedOutcome,
  type SeatReward,
  type StandingRow,
} from '@fd/shared';
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { analyticsStatement, type AnalyticsInput } from '../lib/analytics';
import { randomId } from '../lib/crypto';
import { loadCatalog } from '../lib/players';
import { membershipOf } from '../lib/purchases';
import { grantLeagueRewards, type LeagueRewardInput } from '../lib/rewards';
import { ensureCurrentSeason, ratingOf } from '../lib/seasons';

/**
 * DraftMatchDO — one Durable Object per DRAFT MATCH room (official spec
 * "MATCH / DRAFT MATCH v2.0", decisions 75-85). The single authority for the
 * room: matching, formations, the common pool, チンチロ (every die is rolled
 * here), the snake draft, lineups, the matches, ranking and rewards.
 *
 * State machine (spec 9): WAITING → MATCHING → FORMATION_SELECTION →
 * POOL_GENERATION → CHINCHIRO → DRAFT_ORDER → PLAYER_DRAFT →
 * TEAM_CONFIRMATION ⇄ SIMULATION (once per matchday) → RESULT → COMPLETED.
 * Everything lives in Durable Object storage, so a reconnecting player gets
 * the current state back; D1 keeps the records (draft_* tables).
 */

interface SeatState {
  seat: number;
  userId: string;
  displayName: string;
  joinedAt: number;
  member: boolean;
  formation: FormationId | null;
  /** left after the start: the server plays the seat automatically */
  left: boolean;
}

interface ThrowStep {
  round: number;
  throwNo: number;
  seats: number[];
  /** dice rolled when the player tapped (hidden until everybody threw) */
  rolled: Record<number, { dice: Dice; auto: boolean }>;
  deadline: number;
}

interface ChinchiroState {
  rounds: DmChinchiroRound[];
  groups: number[][];
  current: ThrowStep | null;
  /** the next throw / the order is decided when the animation of the last throw ended */
  revealUntil: number | null;
}

interface Timings {
  matchingSeconds: number;
  lateJoinSeconds: number;
  formationSeconds: number;
  throwSeconds: number;
  revealMs: number;
  orderSeconds: number;
  pickSeconds: number;
  confirmSeconds: number;
  betweenSeconds: number;
  playbackSeconds: number;
}

interface State {
  version: 1;
  roomId: string;
  status: DraftMatchStatus;
  environment: string;
  timings: Timings;
  seed: string;
  createdAt: number;
  seats: (SeatState | null)[];
  deadline: number | null;
  pool: string[] | null;
  chinchiro: ChinchiroState | null;
  draftPositions: number[] | null;
  draft: { order: number[]; picks: DraftPick[]; turnStartedAt: number; deadline: number | null } | null;
  rosters: Record<number, string[]>;
  lineups: Record<number, Lineup | null>;
  lineupReady: Record<number, boolean>;
  usedLineups: Record<number, Lineup | null>;
  matchday: number;
  fixtures: (MatchSummary & { seed: string })[];
  liveIds: string[];
  playbackEndsAt: number | null;
  results: FixtureResult[];
  finalRanks: Record<number, number> | null;
  outcome: DraftMatchOutcome | null;
  seasonId: string | null;
  history: { status: DraftMatchStatus; at: number }[];
}

interface WsAttachment {
  userId: string;
}

type HttpResult = { ok: true; [k: string]: unknown } | { ok: false; code: string; message: string; status: number };
const fail = (code: string, message: string, status = 400): HttpResult => ({ ok: false, code, message, status });

/** rooms.status (shared with the other modes) for each DRAFT MATCH state */
const ROOM_STATUS: Record<DraftMatchStatus, string> = {
  WAITING: 'lobby',
  MATCHING: 'lobby',
  FORMATION_SELECTION: 'drafting',
  POOL_GENERATION: 'drafting',
  CHINCHIRO: 'drafting',
  DRAFT_ORDER: 'drafting',
  PLAYER_DRAFT: 'drafting',
  TEAM_CONFIRMATION: 'lineup',
  SIMULATION: 'playing',
  RESULT: 'finished',
  COMPLETED: 'finished',
  CANCELLED: 'closed',
};

const DEFAULT_TIMINGS: Timings = {
  matchingSeconds: DRAFT_MATCH_CONFIG.matchingSeconds,
  lateJoinSeconds: DRAFT_MATCH_CONFIG.lateJoinSeconds,
  formationSeconds: DRAFT_MATCH_CONFIG.formationSeconds,
  throwSeconds: CHINCHIRO_CONFIG.throwSeconds,
  revealMs: CHINCHIRO_CONFIG.revealMs,
  orderSeconds: DRAFT_MATCH_CONFIG.orderSeconds,
  pickSeconds: DRAFT_MATCH_CONFIG.pickSeconds,
  confirmSeconds: DRAFT_MATCH_CONFIG.confirmSeconds,
  betweenSeconds: DRAFT_MATCH_CONFIG.betweenSeconds,
  playbackSeconds: GAME_CONFIG.matchPlaybackSeconds,
};

/** test timings (non-production only): each value 0.05-600 (revealMs: ms) */
export function draftMatchTimings(input: Record<string, unknown> | undefined, allowTest: boolean): Timings {
  const t = { ...DEFAULT_TIMINGS };
  if (!allowTest || !input) return t;
  for (const k of Object.keys(t) as (keyof Timings)[]) {
    const v = Number(input[k]);
    if (Number.isFinite(v) && v > 0 && v <= (k === 'revealMs' ? 60_000 : 600)) t[k] = v;
  }
  return t;
}

/** delay before the server plays a seat whose player left */
const AUTOPILOT_MS = 1200;

export class DraftMatchDO extends DurableObject<Env> {
  private state: State | null = null;
  private players = new Map<string, Player>();
  private live = new Map<string, LiveMatch>();
  private dbQueue: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<State>('state')) ?? null;
      const players = await ctx.storage.get<Player[]>('players');
      if (players) for (const p of players) this.players.set(p.id, p);
      if (this.state) {
        for (const id of this.state.liveIds) {
          const m = await ctx.storage.get<LiveMatch>(`live:${id}`);
          if (m) this.live.set(id, m);
        }
      }
    });
  }

  // ------------------------------------------------------------------ util

  private now() {
    return Date.now();
  }

  private ms(k: keyof Timings) {
    const v = this.state!.timings[k];
    return k === 'revealMs' ? v : v * 1000;
  }

  private async save() {
    if (this.state) await this.ctx.storage.put('state', this.state);
  }

  private db(fn: () => Promise<unknown>) {
    this.dbQueue = this.dbQueue.then(fn).then(
      () => undefined,
      (err) => console.error('DraftMatchDO D1 write failed', err),
    );
    return this.dbQueue;
  }

  private analytics(events: AnalyticsInput[]) {
    if (events.length) this.db(() => this.env.DB.batch(events.map((e) => analyticsStatement(this.env, e))));
  }

  /** spec 10: refused / invalid operations are kept in the audit log */
  private audit(userId: string | null, action: string, reason: string, detail?: Record<string, unknown>) {
    const s = this.state!;
    this.db(() =>
      this.env.DB.prepare('INSERT INTO draft_audit_logs (id, room_id, user_id, status, action, reason, detail_json, created_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(randomId(), s.roomId, userId, s.status, action, reason, detail ? JSON.stringify(detail).slice(0, 2000) : null, this.now())
        .run(),
    );
  }

  private seatOf(userId: string | null | undefined): number | null {
    if (!userId || !this.state) return null;
    const x = this.state.seats.find((s) => s && s.userId === userId);
    return x ? x.seat : null;
  }

  private active(): SeatState[] {
    return (this.state?.seats.filter(Boolean) ?? []) as SeatState[];
  }

  private connectedUsers(exclude?: WebSocket): Set<string> {
    const set = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const a = ws.deserializeAttachment() as WsAttachment | null;
      if (a?.userId) set.add(a.userId);
    }
    return set;
  }

  /** moves to the next state (spec 9) and records it */
  private move(to: DraftMatchStatus) {
    const s = this.state!;
    if (!canMove(s.status, to)) throw new Error(`invalid transition ${s.status} -> ${to}`);
    s.status = to;
    s.history.push({ status: to, at: this.now() });
    const history = JSON.stringify(s.history);
    const n = this.active().length;
    this.db(() =>
      this.env.DB.batch([
        this.env.DB.prepare('UPDATE draft_rooms SET status = ?, history_json = ?, players = ? WHERE id = ?').bind(to, history, n, s.roomId),
        this.env.DB.prepare('UPDATE rooms SET status = ?, member_count = ? WHERE id = ?').bind(ROOM_STATUS[to], n, s.roomId),
      ]),
    );
  }

  // -------------------------------------------------------------- snapshot

  private snapshotFor(userId: string | null, exclude?: WebSocket): DraftMatchSnapshot {
    const s = this.state!;
    const you = this.seatOf(userId);
    const connected = this.connectedUsers(exclude);
    const formationsOpen = s.status !== 'WAITING' && s.status !== 'MATCHING' && s.status !== 'FORMATION_SELECTION';
    const seats: DmSeat[] = this.active().map((x) => ({
      seat: x.seat,
      userId: x.userId,
      displayName: x.displayName,
      connected: connected.has(x.userId),
      member: x.member,
      // other people's formations stay hidden until everybody chose
      formation: formationsOpen || x.seat === you ? x.formation : null,
      formationChosen: !!x.formation,
      left: x.left,
    }));
    const c = s.chinchiro;
    const lineups: Record<number, Lineup | null> = {};
    for (const x of this.active()) lineups[x.seat] = x.seat === you ? s.lineups[x.seat] ?? null : s.usedLineups[x.seat] ?? null;
    return {
      roomId: s.roomId,
      status: s.status,
      serverNow: this.now(),
      you,
      seats,
      deadline: this.deadline(),
      pool: s.pool,
      chinchiro: c
        ? {
            rounds: c.rounds,
            current: c.current ? { round: c.current.round, throwNo: c.current.throwNo, seats: c.current.seats, thrown: Object.keys(c.current.rolled).map(Number), deadline: c.current.deadline } : null,
            revealUntil: c.revealUntil,
            groups: c.groups,
          }
        : null,
      draftPositions: s.draftPositions,
      draft: s.draft ? { order: s.draft.order, picks: s.draft.picks, currentSeat: dmCurrentSeat({ ...s.draft, pool: s.pool ?? [] }), deadline: s.draft.deadline } : null,
      rosters: s.rosters,
      lineups,
      lineupReady: s.lineupReady,
      matchday: s.matchday,
      matchdays: s.fixtures.length ? Math.max(...s.fixtures.map((f) => f.matchday)) : 0,
      fixtures: s.fixtures.map(({ seed: _seed, ...f }) => f),
      live: s.status === 'SIMULATION' ? s.liveIds.map((id) => this.live.get(id)).filter((m): m is LiveMatch => !!m) : [],
      standings: this.standings(),
      results: s.results,
      finalRanks: s.finalRanks,
      outcome: s.outcome,
      history: s.history,
    };
  }

  private standings(): StandingRow[] {
    const n = this.active().length;
    return n >= 2 && this.state!.fixtures.length ? computeStandings(n, this.state!.results, this.state!.seed) : [];
  }

  /** the deadline of the current step */
  private deadline(): number | null {
    const s = this.state!;
    switch (s.status) {
      case 'CHINCHIRO':
        return s.chinchiro?.current?.deadline ?? s.chinchiro?.revealUntil ?? null;
      case 'PLAYER_DRAFT':
        return s.draft?.deadline ?? null;
      case 'SIMULATION':
        return s.playbackEndsAt;
      default:
        return s.deadline;
    }
  }

  private send(ws: WebSocket, msg: DraftMatchServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closed */
    }
  }

  private broadcastSnapshot(closed?: WebSocket) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === closed) continue;
      const a = ws.deserializeAttachment() as WsAttachment | null;
      this.send(ws, { type: 'snapshot', state: this.snapshotFor(a?.userId ?? null, closed) });
    }
  }

  private sendPlayers(ws?: WebSocket) {
    if (this.players.size === 0) return;
    const msg: DraftMatchServerMessage = { type: 'players', players: [...this.players.values()] };
    if (ws) this.send(ws, msg);
    else for (const w of this.ctx.getWebSockets()) this.send(w, msg);
  }

  // ------------------------------------------------------------------ alarm

  private async scheduleAlarm() {
    const due = this.state ? this.nextDue() : null;
    if (due) await this.ctx.storage.setAlarm(due);
    else await this.ctx.storage.deleteAlarm();
  }

  private nextDue(): number | null {
    const s = this.state!;
    if (s.status === 'CHINCHIRO') {
      const c = s.chinchiro!;
      if (c.current) {
        // a seat whose player left throws automatically
        const leftWaiting = c.current.seats.some((seat) => s.seats[seat]?.left && !c.current!.rolled[seat]);
        return leftWaiting ? Math.min(c.current.deadline, this.now() + AUTOPILOT_MS) : c.current.deadline;
      }
      return c.revealUntil;
    }
    if (s.status === 'PLAYER_DRAFT') return s.draft?.deadline ?? null;
    if (s.status === 'SIMULATION') return s.playbackEndsAt;
    return s.deadline;
  }

  override async alarm() {
    const s = this.state;
    if (!s) return;
    const now = this.now() + 25;
    try {
      if (s.status === 'MATCHING' && s.deadline && s.deadline <= now) await this.matchingTimeUp();
      else if (s.status === 'FORMATION_SELECTION' && s.deadline && s.deadline <= now) await this.finishFormations();
      else if (s.status === 'CHINCHIRO') await this.chinchiroTick(now);
      else if (s.status === 'DRAFT_ORDER' && s.deadline && s.deadline <= now) await this.startDraft();
      else if (s.status === 'PLAYER_DRAFT' && s.draft?.deadline && s.draft.deadline <= now) await this.autoPick();
      else if (s.status === 'TEAM_CONFIRMATION' && s.deadline && s.deadline <= now) await this.startMatchday();
      else if (s.status === 'SIMULATION' && s.playbackEndsAt && s.playbackEndsAt <= now) await this.finishMatchday();
    } catch (err) {
      console.error('DraftMatchDO alarm failed', err);
    }
    await this.scheduleAlarm();
    await this.dbQueue;
  }

  // ------------------------------------------------------------------ http

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws') return this.acceptWebSocket(request);
    let result: HttpResult;
    try {
      const body = request.method === 'POST' ? ((await request.json()) as Record<string, unknown>) : {};
      switch (url.pathname) {
        case '/init':
          result = await this.init(body);
          break;
        case '/join':
          result = await this.join(String(body.userId), String(body.displayName));
          break;
        case '/leave':
          result = await this.leave(String(body.userId));
          break;
        case '/state':
          result = this.state ? { ok: true, state: this.snapshotFor(url.searchParams.get('userId')) } : fail('NOT_FOUND', 'room not found', 404);
          break;
        case '/action':
          result = await this.action(String(body.userId), body.message as DraftMatchClientMessage);
          break;
        default:
          result = fail('NOT_FOUND', 'unknown endpoint', 404);
      }
    } catch (err) {
      console.error('DraftMatchDO error', err);
      result = fail('INTERNAL', 'internal error', 500);
    }
    if (this.state) await this.scheduleAlarm();
    await this.dbQueue;
    if (result.ok) return Response.json(result);
    return Response.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  }

  private async init(body: Record<string, unknown>): Promise<HttpResult> {
    if (this.state) return fail('CONFLICT', 'room already initialised', 409);
    const now = this.now();
    this.state = {
      version: 1,
      roomId: String(body.roomId),
      status: 'WAITING',
      environment: String(body.environment),
      timings: draftMatchTimings(body.settings as Record<string, unknown> | undefined, body.allowTestTimings === true),
      seed: String(body.seed),
      createdAt: now,
      seats: [null, null, null, null],
      deadline: null,
      pool: null,
      chinchiro: null,
      draftPositions: null,
      draft: null,
      rosters: {},
      lineups: {},
      lineupReady: {},
      usedLineups: {},
      matchday: 0,
      fixtures: [],
      liveIds: [],
      playbackEndsAt: null,
      results: [],
      finalRanks: null,
      outcome: null,
      seasonId: null,
      history: [{ status: 'WAITING', at: now }],
    };
    await this.save();
    return { ok: true };
  }

  // ---------------------------------------------------------------- matching

  private async join(userId: string, displayName: string): Promise<HttpResult> {
    const s = this.state;
    if (!s) return fail('NOT_FOUND', 'room not found', 404);
    const existing = this.seatOf(userId);
    if (existing !== null) return { ok: true, seat: existing, rejoined: true };
    if (s.status !== 'WAITING' && s.status !== 'MATCHING') return fail('ROOM_NOT_JOINABLE', 'the room has already started', 409);
    const member = await membershipOf(this.env, userId)
      .then((m) => m.active)
      .catch(() => false);
    const again = this.seatOf(userId);
    if (again !== null) return { ok: true, seat: again, rejoined: true };
    if (s.status !== 'WAITING' && s.status !== 'MATCHING') return fail('ROOM_NOT_JOINABLE', 'the room has already started', 409);
    const seat = s.seats.findIndex((x) => x === null);
    if (seat < 0) return fail('ROOM_FULL', 'room is full', 409);
    const now = this.now();
    const name = displayName.slice(0, 24);
    s.seats[seat] = { seat, userId, displayName: name, joinedAt: now, member, formation: null, left: false };
    const n = this.active().length;
    this.db(() =>
      this.env.DB.batch([
        this.env.DB.prepare('INSERT OR REPLACE INTO draft_participants (room_id, seat, user_id, display_name, joined_at) VALUES (?,?,?,?,?)').bind(s.roomId, seat, userId, name, now),
        this.env.DB.prepare('INSERT OR REPLACE INTO room_members (room_id, seat, user_id, display_name, is_cpu, joined_at) VALUES (?,?,?,?,0,?)').bind(s.roomId, seat, userId, name, now),
        this.env.DB.prepare('UPDATE draft_rooms SET players = ? WHERE id = ?').bind(n, s.roomId),
        this.env.DB.prepare('UPDATE rooms SET member_count = ? WHERE id = ?').bind(n, s.roomId),
        analyticsStatement(this.env, { name: 'room_joined', userId, properties: { roomId: s.roomId, mode: 'draft_match', seat } }),
      ]),
    );
    if (n >= DRAFT_MATCH_CONFIG.maxPlayers) {
      await this.save();
      await this.startFormations();
    } else {
      if (n >= DRAFT_MATCH_CONFIG.minPlayers && s.status === 'WAITING') {
        // decision 75: matching waits about 60 s from the creation of the room;
        // when the second person comes later, the others still get a short wait
        this.move('MATCHING');
        s.deadline = Math.max(s.createdAt + this.ms('matchingSeconds'), now + this.ms('lateJoinSeconds'));
      }
      await this.save();
      this.broadcastSnapshot();
    }
    return { ok: true, seat, rejoined: false };
  }

  private async leave(userId: string): Promise<HttpResult> {
    const s = this.state;
    if (!s) return fail('NOT_FOUND', 'room not found', 404);
    const seat = this.seatOf(userId);
    if (seat === null) return { ok: true };
    const now = this.now();
    if (s.status !== 'WAITING' && s.status !== 'MATCHING') {
      // after the start the seat stays; the server plays it (auto throws, auto picks, saved lineup)
      if (s.status !== 'COMPLETED' && s.status !== 'RESULT' && !s.seats[seat]!.left) {
        s.seats[seat]!.left = true;
        await this.save();
        this.db(() => this.env.DB.prepare('UPDATE draft_participants SET left_at = ? WHERE room_id = ? AND seat = ?').bind(now, s.roomId, seat).run());
        this.analytics([{ name: 'match_abandoned', userId, properties: { roomId: s.roomId, mode: 'draft_match', status: s.status } }]);
        this.broadcastSnapshot();
      }
      return { ok: true, autopilot: true };
    }
    s.seats[seat] = null;
    const n = this.active().length;
    if (n === 0) {
      this.move('CANCELLED');
      s.deadline = null;
    } else if (n < DRAFT_MATCH_CONFIG.minPlayers && s.status === 'MATCHING') {
      this.move('WAITING');
      s.deadline = null;
    }
    await this.save();
    this.db(() =>
      this.env.DB.batch([
        this.env.DB.prepare('DELETE FROM draft_participants WHERE room_id = ? AND seat = ?').bind(s.roomId, seat),
        this.env.DB.prepare('DELETE FROM room_members WHERE room_id = ? AND seat = ?').bind(s.roomId, seat),
        this.env.DB.prepare('UPDATE rooms SET member_count = ? WHERE id = ?').bind(n, s.roomId),
        this.env.DB.prepare('UPDATE draft_rooms SET players = ? WHERE id = ?').bind(n, s.roomId),
        analyticsStatement(this.env, { name: 'room_left', userId, properties: { roomId: s.roomId, mode: 'draft_match' } }),
      ]),
    );
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as WsAttachment | null;
      if (a?.userId === userId) ws.close(1000, 'left');
    }
    this.broadcastSnapshot();
    return { ok: true };
  }

  private async matchingTimeUp() {
    const s = this.state!;
    if (this.active().length >= DRAFT_MATCH_CONFIG.minPlayers) await this.startFormations();
    else {
      this.move('WAITING');
      s.deadline = null;
      await this.save();
      this.broadcastSnapshot();
    }
  }

  // ---------------------------------------------------------- formations

  private async startFormations() {
    const s = this.state!;
    if (s.status !== 'WAITING' && s.status !== 'MATCHING') return;
    const now = this.now();
    // seats are numbered 0..n-1 in the order people joined
    const people = this.active().sort((a, b) => a.joinedAt - b.joinedAt);
    s.seats = [null, null, null, null];
    people.forEach((p, i) => {
      p.seat = i;
      s.seats[i] = p;
    });
    if (s.status === 'WAITING') this.move('MATCHING');
    this.move('FORMATION_SELECTION');
    s.deadline = now + this.ms('formationSeconds');
    await this.save();
    const n = people.length;
    this.db(() =>
      this.env.DB.batch([
        this.env.DB.prepare('DELETE FROM draft_participants WHERE room_id = ?').bind(s.roomId),
        this.env.DB.prepare('DELETE FROM room_members WHERE room_id = ?').bind(s.roomId),
        ...people.flatMap((p) => [
          this.env.DB.prepare('INSERT INTO draft_participants (room_id, seat, user_id, display_name, joined_at) VALUES (?,?,?,?,?)').bind(s.roomId, p.seat, p.userId, p.displayName, p.joinedAt),
          this.env.DB.prepare('INSERT INTO room_members (room_id, seat, user_id, display_name, is_cpu, joined_at) VALUES (?,?,?,?,0,?)').bind(s.roomId, p.seat, p.userId, p.displayName, p.joinedAt),
        ]),
        this.env.DB.prepare('UPDATE draft_rooms SET players = ?, started_at = ? WHERE id = ?').bind(n, now, s.roomId),
        this.env.DB.prepare('UPDATE rooms SET started_at = ?, member_count = ? WHERE id = ?').bind(now, n, s.roomId),
        ...people.map((p) => analyticsStatement(this.env, { name: 'league_started', userId: p.userId, properties: { roomId: s.roomId, mode: 'draft_match', humans: n } })),
      ]),
    );
    this.broadcastSnapshot();
  }

  private async chooseFormation(userId: string, formation: unknown): Promise<HttpResult> {
    const s = this.state!;
    const seat = this.seatOf(userId)!;
    if (s.status !== 'FORMATION_SELECTION') return this.refuse(userId, 'formation', 'WRONG_PHASE', { formation });
    if (typeof formation !== 'string' || !(formation in FORMATIONS)) return this.refuse(userId, 'formation', 'INVALID_FORMATION', { formation });
    s.seats[seat]!.formation = formation as FormationId;
    await this.save();
    if (this.active().every((x) => x.formation)) await this.finishFormations();
    else this.broadcastSnapshot();
    return { ok: true };
  }

  /** everybody chose (or the time ran out: 4-3-3) -> the pool for these formations -> チンチロ */
  private async finishFormations() {
    const s = this.state!;
    if (s.status !== 'FORMATION_SELECTION') return;
    const now = this.now();
    for (const x of this.active()) if (!x.formation) x.formation = DRAFT_MATCH_CONFIG.defaultFormation;
    this.move('POOL_GENERATION');
    const catalog = await loadCatalog(this.env);
    const people = this.active();
    const pool = buildDraftMatchPool(
      catalog,
      people.map((p) => p.formation!),
      cryptoRandom(),
    );
    const byId = new Map(catalog.map((p) => [p.id, p]));
    s.pool = pool;
    this.players = new Map(pool.map((id) => [id, byId.get(id)!]));
    await this.ctx.storage.put('players', [...this.players.values()]);
    s.deadline = null;
    // チンチロ: everybody throws in round 1
    this.move('CHINCHIRO');
    s.chinchiro = { rounds: [], groups: [people.map((p) => p.seat)], current: null, revealUntil: null };
    this.startRound(people.map((p) => p.seat), now);
    await this.save();
    this.db(() =>
      this.env.DB.batch([
        ...people.map((p) => this.env.DB.prepare('UPDATE draft_participants SET formation = ? WHERE room_id = ? AND seat = ?').bind(p.formation, s.roomId, p.seat)),
        this.env.DB.prepare(
          `INSERT INTO draft_card_pools (room_id, player_id, sort_order, rarity, position_group)
           SELECT ?1, json_extract(j.value, '$.id'), j.key, json_extract(j.value, '$.r'), json_extract(j.value, '$.g') FROM json_each(?2) j`,
        ).bind(s.roomId, JSON.stringify(pool.map((id) => ({ id, r: byId.get(id)!.rarity, g: groupOf(byId.get(id)!) })))),
      ]),
    );
    this.sendPlayers();
    this.broadcastSnapshot();
  }

  // ---------------------------------------------------------------- チンチロ

  private startRound(seats: number[], now: number) {
    const c = this.state!.chinchiro!;
    const no = c.rounds.length + 1;
    c.rounds.push({ no, seats: [...seats], throws: Object.fromEntries(seats.map((x) => [x, []])), rematch: no > 1 });
    c.current = { round: no, throwNo: 1, seats: [...seats], rolled: {}, deadline: now + this.ms('throwSeconds') };
    c.revealUntil = null;
  }

  private async throwDice(userId: string): Promise<HttpResult> {
    const s = this.state!;
    const seat = this.seatOf(userId)!;
    const cur = s.chinchiro?.current;
    if (s.status !== 'CHINCHIRO' || !cur) return this.refuse(userId, 'throw', 'NOT_THROWING_NOW');
    if (!cur.seats.includes(seat)) return this.refuse(userId, 'throw', 'NOT_YOUR_THROW', { round: cur.round, throwNo: cur.throwNo });
    if (cur.rolled[seat]) return this.refuse(userId, 'throw', 'ALREADY_THROWN', { round: cur.round, throwNo: cur.throwNo });
    // the server decides the dice the moment the player taps
    cur.rolled[seat] = { dice: rollDice(cryptoRandom()), auto: false };
    await this.save();
    if (cur.seats.every((x) => cur.rolled[x])) await this.reveal();
    else this.broadcastSnapshot();
    return { ok: true };
  }

  private async chinchiroTick(now: number) {
    const c = this.state!.chinchiro!;
    if (c.current) {
      const cur = c.current;
      const timeUp = cur.deadline <= now;
      let changed = false;
      for (const seat of cur.seats) {
        if (cur.rolled[seat]) continue;
        if (timeUp || this.state!.seats[seat]?.left) {
          cur.rolled[seat] = { dice: rollDice(cryptoRandom()), auto: true };
          changed = true;
        }
      }
      if (cur.seats.every((x) => cur.rolled[x])) await this.reveal();
      else if (changed) {
        await this.save();
        this.broadcastSnapshot();
      }
    } else if (c.revealUntil !== null && c.revealUntil <= now) {
      await this.afterReveal();
    }
  }

  /** everybody threw: the results are shown to all at once */
  private async reveal() {
    const s = this.state!;
    const c = s.chinchiro!;
    const cur = c.current!;
    const round = c.rounds[cur.round - 1];
    const now = this.now();
    const rows: D1PreparedStatement[] = [];
    for (const seat of cur.seats) {
      const r = cur.rolled[seat];
      const hand = evaluateHand(r.dice);
      round.throws[seat].push({ dice: r.dice, hand, auto: r.auto });
      rows.push(
        this.env.DB.prepare(
          'INSERT OR IGNORE INTO draft_dice_results (room_id, round_no, throw_no, seat, user_id, die1, die2, die3, hand, hand_value, strength, is_auto, is_rematch, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(s.roomId, cur.round, cur.throwNo, seat, s.seats[seat]!.userId, r.dice[0], r.dice[1], r.dice[2], hand.kind, hand.value, hand.strength, r.auto ? 1 : 0, round.rematch ? 1 : 0, now),
      );
    }
    c.current = null;
    c.revealUntil = now + this.ms('revealMs');
    await this.save();
    this.db(() => this.env.DB.batch(rows));
    this.broadcastSnapshot();
  }

  /** after the animation: the next throw, a re-match of equal results, or the draft order */
  private async afterReveal() {
    const s = this.state!;
    const c = s.chinchiro!;
    const now = this.now();
    const round = c.rounds[c.rounds.length - 1];
    c.revealUntil = null;
    const again = round.seats.filter((seat) => !turnFinished(round.throws[seat].map((t) => t.dice)));
    if (again.length) {
      // everybody who still has no hand throws again (they all threw the same number of times)
      c.current = { round: round.no, throwNo: round.throws[again[0]].length + 1, seats: again, rolled: {}, deadline: now + this.ms('throwSeconds') };
    } else {
      const ordered = splitByResult(round.seats, (seat) => turnResult(round.throws[seat].map((t) => t.dice)));
      c.groups = resolveGroup(c.groups, round.seats, ordered);
      const tie = nextTieGroup(c.groups);
      if (tie) this.startRound(tie, now);
      else {
        // the order is decided: 1st = first pick
        s.draftPositions = c.groups.flat();
        this.move('DRAFT_ORDER');
        s.deadline = now + this.ms('orderSeconds');
        const positions = s.draftPositions;
        this.db(() =>
          this.env.DB.batch(positions.map((seat, i) => this.env.DB.prepare('UPDATE draft_participants SET draft_position = ? WHERE room_id = ? AND seat = ?').bind(i + 1, s.roomId, seat))),
        );
      }
    }
    await this.save();
    this.broadcastSnapshot();
  }

  // ------------------------------------------------------------------ draft

  private async startDraft() {
    const s = this.state!;
    if (s.status !== 'DRAFT_ORDER') return;
    const now = this.now();
    this.move('PLAYER_DRAFT');
    s.deadline = null;
    s.draft = { order: draftMatchOrder(s.draftPositions!), picks: [], turnStartedAt: now, deadline: null };
    this.setTurnTimer(now);
    await this.save();
    this.db(() => this.env.DB.prepare('UPDATE draft_rooms SET draft_started_at = ? WHERE id = ?').bind(now, s.roomId).run());
    this.analytics(this.active().map((p) => ({ name: 'draft_started', userId: p.userId, properties: { roomId: s.roomId, mode: 'draft_match', humans: this.active().length, pickSeconds: s.timings.pickSeconds } })));
    this.broadcastSnapshot();
  }

  private setTurnTimer(now: number) {
    const s = this.state!;
    const d = s.draft!;
    const seat = dmCurrentSeat({ ...d, pool: s.pool! });
    d.turnStartedAt = now;
    if (seat === null) d.deadline = null;
    else d.deadline = now + (s.seats[seat]!.left ? AUTOPILOT_MS : this.ms('pickSeconds'));
  }

  private async pickByUser(userId: string, playerId: unknown): Promise<HttpResult> {
    const s = this.state!;
    const seat = this.seatOf(userId)!;
    if (s.status !== 'PLAYER_DRAFT' || !s.draft) return this.refuse(userId, 'pick', 'WRONG_PHASE', { playerId });
    const err = validateDraftMatchPick({ ...s.draft, pool: s.pool! }, seat, String(playerId), s.seats[seat]!.formation!, this.players);
    if (err) return this.refuse(userId, 'pick', err, { playerId, pickNo: s.draft.picks.length + 1, currentSeat: dmCurrentSeat({ ...s.draft, pool: s.pool! }) });
    await this.applyPick(seat, String(playerId), false, false);
    return { ok: true };
  }

  /** the time ran out: missing positions first (spec 4) */
  private async autoPick() {
    const s = this.state!;
    const d = s.draft!;
    const seat = dmCurrentSeat({ ...d, pool: s.pool! });
    if (seat === null) return;
    const id = draftMatchAutoPick({ ...d, pool: s.pool! }, seat, s.seats[seat]!.formation!, this.players);
    await this.applyPick(seat, id, true, !s.seats[seat]!.left);
  }

  private async applyPick(seat: number, playerId: string, auto: boolean, timeout: boolean) {
    const s = this.state!;
    const d = s.draft!;
    const now = this.now();
    const pick: DraftPick = { pickNo: d.picks.length + 1, seat, playerId, auto };
    d.picks.push(pick);
    const ms = now - d.turnStartedAt;
    this.setTurnTimer(now);
    await this.save();
    const info = s.seats[seat]!;
    const p = this.players.get(playerId)!;
    const n = this.active().length;
    this.db(() =>
      this.env.DB.batch([
        // UNIQUE (room_id, player_id): the database also refuses the same card twice
        this.env.DB.prepare('INSERT INTO draft_picks (room_id, pick_no, round_no, seat, user_id, player_id, is_auto, ms, picked_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(
          s.roomId,
          pick.pickNo,
          Math.ceil(pick.pickNo / n),
          seat,
          info.userId,
          playerId,
          auto ? 1 : 0,
          ms,
          now,
        ),
        analyticsStatement(this.env, {
          name: timeout ? 'draft_timeout' : 'draft_pick_completed',
          userId: info.userId,
          properties: { roomId: s.roomId, mode: 'draft_match', pickNo: pick.pickNo, playerId, rarity: p.rarity, position: p.primaryPosition, auto, ms },
        }),
      ]),
    );
    if (d.picks.length >= d.order.length) await this.finishDraft();
    else this.broadcastSnapshot();
  }

  /** team confirmation: 11 players in the chosen formation, no bench (spec 6) */
  private async finishDraft() {
    const s = this.state!;
    const d = s.draft!;
    const now = this.now();
    const people = this.active();
    for (const p of people) s.rosters[p.seat] = dmRoster({ ...d, pool: s.pool! }, p.seat);
    s.fixtures = [];
    roundRobin(people.length).forEach((md, i) => {
      for (const [home, away] of md) s.fixtures.push({ matchId: randomId(), matchday: i + 1, homeSeat: home, awaySeat: away, homeGoals: null, awayGoals: null, seed: `${s.seed}:md${i + 1}:${home}-${away}` });
    });
    s.matchday = 1;
    for (const p of people) {
      s.lineups[p.seat] = autoLineup(this.roster(p.seat), p.formation!);
      s.lineupReady[p.seat] = p.left;
    }
    this.move('TEAM_CONFIRMATION');
    s.deadline = now + this.ms('confirmSeconds');
    await this.save();
    this.db(() =>
      this.env.DB.batch([
        ...people.map((p) =>
          this.env.DB.prepare('INSERT OR REPLACE INTO draft_teams (room_id, seat, user_id, formation, roster_json, lineup_json, updated_at) VALUES (?,?,?,?,?,?,?)').bind(
            s.roomId,
            p.seat,
            p.userId,
            p.formation,
            JSON.stringify(s.rosters[p.seat]),
            JSON.stringify(s.lineups[p.seat]),
            now,
          ),
        ),
        ...people.map((p) => analyticsStatement(this.env, { name: 'draft_completed', userId: p.userId, properties: { roomId: s.roomId, mode: 'draft_match', pickSeconds: s.timings.pickSeconds } })),
      ]),
    );
    this.broadcastSnapshot();
  }

  private roster(seat: number): Player[] {
    return (this.state!.rosters[seat] ?? []).map((id) => this.players.get(id)!).filter(Boolean);
  }

  // ---------------------------------------------------------------- lineups

  private async submitLineup(userId: string, lineup: unknown, ready: boolean): Promise<HttpResult> {
    const s = this.state!;
    const seat = this.seatOf(userId)!;
    if (s.status !== 'TEAM_CONFIRMATION') return this.refuse(userId, 'lineup', 'WRONG_PHASE');
    // the formation chosen before the draft stays (decision 83)
    const err = validateLineup(lineup, s.rosters[seat], s.seats[seat]!.formation);
    if (err) return this.refuse(userId, 'lineup', err);
    const l = lineup as Lineup;
    s.lineups[seat] = { formation: l.formation, starters: [...l.starters], bench: [], tactics: { ...l.tactics } };
    s.lineupReady[seat] = ready;
    await this.save();
    this.db(() => this.env.DB.prepare('UPDATE draft_teams SET lineup_json = ?, updated_at = ? WHERE room_id = ? AND seat = ?').bind(JSON.stringify(s.lineups[seat]), this.now(), s.roomId, seat).run());
    await this.afterReady();
    return { ok: true };
  }

  private async setReady(userId: string, ready: boolean): Promise<HttpResult> {
    const s = this.state!;
    const seat = this.seatOf(userId)!;
    if (s.status !== 'TEAM_CONFIRMATION') return this.refuse(userId, 'ready', 'WRONG_PHASE');
    s.lineupReady[seat] = ready;
    await this.save();
    await this.afterReady();
    return { ok: true };
  }

  private async afterReady() {
    const s = this.state!;
    if (this.active().every((p) => s.lineupReady[p.seat] || p.left)) await this.startMatchday();
    else this.broadcastSnapshot();
  }

  // ---------------------------------------------------------------- matches

  private async startMatchday() {
    const s = this.state!;
    if (s.status !== 'TEAM_CONFIRMATION') return;
    const now = this.now();
    const md = s.matchday;
    const fixtures = s.fixtures.filter((f) => f.matchday === md);
    const startAt = now + 2500;
    const durationMs = this.ms('playbackSeconds');
    const writes: D1PreparedStatement[] = [];
    this.live.clear();
    for (const f of fixtures) {
      const team = (seat: number) => ({ seat, name: s.seats[seat]!.displayName, players: this.roster(seat), lineup: s.lineups[seat] ?? autoLineup(this.roster(seat), s.seats[seat]!.formation!) });
      const home = team(f.homeSeat);
      const away = team(f.awaySeat);
      // spec 7: the server decides the result (no strengthening in DRAFT MATCH)
      const result = simulateMatch({ seed: f.seed, home, away });
      const live: LiveMatch = { matchId: f.matchId, matchday: md, homeSeat: f.homeSeat, awaySeat: f.awaySeat, startAt, durationMs, result };
      this.live.set(f.matchId, live);
      await this.ctx.storage.put(`live:${f.matchId}`, live);
      s.usedLineups[f.homeSeat] = home.lineup;
      s.usedLineups[f.awaySeat] = away.lineup;
      const chem = (t: typeof home) => computeChemistry(t.lineup.starters.map((id) => this.players.get(id)), t.lineup.formation, t.lineup.tactics).score;
      writes.push(
        this.env.DB.prepare("INSERT INTO matches (id, room_id, matchday, seed, sim_version, home_seat, away_seat, home_user_id, away_user_id, status, created_at, playback_start_at) VALUES (?,?,?,?,?,?,?,?,?,'simulated',?,?)").bind(
          f.matchId,
          s.roomId,
          md,
          f.seed,
          result.simVersion,
          f.homeSeat,
          f.awaySeat,
          s.seats[f.homeSeat]!.userId,
          s.seats[f.awaySeat]!.userId,
          now,
          startAt,
        ),
        ...[home, away].map((t, i) =>
          this.env.DB.prepare('INSERT INTO match_teams (match_id, side, seat, user_id, team_name, lineup_json, players_json, chemistry) VALUES (?,?,?,?,?,?,?,?)').bind(
            f.matchId,
            i === 0 ? 'home' : 'away',
            t.seat,
            s.seats[t.seat]!.userId,
            t.name,
            JSON.stringify(t.lineup),
            JSON.stringify(t.players),
            chem(t),
          ),
        ),
        this.env.DB.prepare('INSERT INTO match_events (match_id, events_json, track_json) VALUES (?,?,?)').bind(f.matchId, JSON.stringify(result.events), JSON.stringify(result.track)),
        ...(['home', 'away'] as const).map((side) =>
          this.env.DB.prepare('INSERT INTO match_statistics (match_id, side, stats_json, players_json, notes_json) VALUES (?,?,?,?,?)').bind(
            f.matchId,
            side,
            JSON.stringify(result.stats[side]),
            JSON.stringify(result.players.filter((p) => p.side === side)),
            JSON.stringify(result.notes[side]),
          ),
        ),
        this.env.DB.prepare('INSERT INTO match_results (match_id, home_goals, away_goals, winner_seat, mvp_player_id, created_at) VALUES (?,?,?,?,?,?)').bind(
          f.matchId,
          result.score.home,
          result.score.away,
          result.score.home > result.score.away ? f.homeSeat : result.score.away > result.score.home ? f.awaySeat : null,
          result.mvpId,
          now,
        ),
        this.env.DB.prepare('INSERT INTO draft_match_results (match_id, room_id, matchday, home_seat, away_seat, home_goals, away_goals, winner_seat, created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(
          f.matchId,
          s.roomId,
          md,
          f.homeSeat,
          f.awaySeat,
          result.score.home,
          result.score.away,
          result.score.home > result.score.away ? f.homeSeat : result.score.away > result.score.home ? f.awaySeat : null,
          now,
        ),
        ...[f.homeSeat, f.awaySeat].map((seat) => analyticsStatement(this.env, { name: 'match_started', userId: s.seats[seat]!.userId, properties: { matchId: f.matchId, roomId: s.roomId, matchday: md, mode: 'draft_match' } })),
      );
    }
    s.liveIds = fixtures.map((f) => f.matchId);
    this.move('SIMULATION');
    s.deadline = null;
    s.playbackEndsAt = startAt + durationMs + 1500;
    await this.save();
    this.db(() => this.env.DB.batch(writes));
    this.broadcastSnapshot();
  }

  private async finishMatchday() {
    const s = this.state!;
    if (s.status !== 'SIMULATION') return;
    const now = this.now();
    const writes: D1PreparedStatement[] = [];
    for (const id of s.liveIds) {
      const m = this.live.get(id);
      if (!m) continue;
      const f = s.fixtures.find((x) => x.matchId === id)!;
      f.homeGoals = m.result.score.home;
      f.awayGoals = m.result.score.away;
      s.results.push({ matchday: m.matchday, home: m.homeSeat, away: m.awaySeat, homeGoals: f.homeGoals, awayGoals: f.awayGoals });
      writes.push(this.env.DB.prepare("UPDATE matches SET status = 'completed', completed_at = ? WHERE id = ?").bind(now, id));
      for (const seat of [m.homeSeat, m.awaySeat]) {
        const gf = seat === m.homeSeat ? f.homeGoals : f.awayGoals;
        const ga = seat === m.homeSeat ? f.awayGoals : f.homeGoals;
        writes.push(analyticsStatement(this.env, { name: 'match_completed', userId: s.seats[seat]!.userId, properties: { matchId: id, roomId: s.roomId, mode: 'draft_match', result: gf > ga ? 'win' : gf < ga ? 'loss' : 'draw', gf, ga } }));
      }
    }
    for (const id of s.liveIds) await this.ctx.storage.delete(`live:${id}`);
    s.liveIds = [];
    this.live.clear();
    s.playbackEndsAt = null;
    const last = Math.max(...s.fixtures.map((f) => f.matchday));
    if (s.matchday < last) {
      s.matchday += 1;
      this.move('TEAM_CONFIRMATION');
      s.deadline = now + this.ms('betweenSeconds');
      for (const p of this.active()) s.lineupReady[p.seat] = p.left;
      await this.save();
      this.db(() => this.env.DB.batch(writes));
      this.broadcastSnapshot();
      return;
    }
    await this.save();
    this.db(() => this.env.DB.batch(writes));
    await this.finishLeague();
  }

  // ---------------------------------------------------------------- result

  private async finishLeague() {
    const s = this.state!;
    const now = this.now();
    this.move('RESULT');
    const table = this.standings();
    s.finalRanks = Object.fromEntries(table.map((r) => [r.seat, r.rank]));
    await this.save();
    const writes: D1PreparedStatement[] = [];
    for (const r of table) {
      writes.push(
        this.env.DB.prepare('UPDATE draft_participants SET final_rank = ?, points = ?, goals_for = ?, goals_against = ? WHERE room_id = ? AND seat = ?').bind(r.rank, r.points, r.goalsFor, r.goalsAgainst, s.roomId, r.seat),
        this.env.DB.prepare('UPDATE room_members SET final_rank = ?, points = ?, goals_for = ?, goals_against = ? WHERE room_id = ? AND seat = ?').bind(r.rank, r.points, r.goalsFor, r.goalsAgainst, s.roomId, r.seat),
      );
    }
    const here = this.connectedUsers();
    for (const p of this.active()) {
      if (!here.has(p.userId) && !p.left) writes.push(analyticsStatement(this.env, { name: 'match_abandoned', userId: p.userId, properties: { roomId: s.roomId, mode: 'draft_match' } }));
    }
    this.db(() => this.env.DB.batch(writes));
    await this.dbQueue;
    const outcome: DraftMatchOutcome = {};
    try {
      outcome.ranking = await this.applyRanking(table, now);
    } catch (err) {
      console.error('DRAFT MATCH ranking failed', err);
    }
    try {
      outcome.rewards = await this.applyRewards(table, now);
    } catch (err) {
      console.error('DRAFT MATCH rewards failed', err);
    }
    s.outcome = outcome;
    this.move('COMPLETED');
    await this.save();
    this.db(() =>
      this.env.DB.batch([
        this.env.DB.prepare('UPDATE draft_rooms SET completed_at = ?, season_id = ? WHERE id = ?').bind(now, s.seasonId, s.roomId),
        this.env.DB.prepare('UPDATE rooms SET finished_at = ? WHERE id = ?').bind(now, s.roomId),
      ]),
    );
    this.broadcastSnapshot();
  }

  /**
   * DRAFT MATCH ranking (decision 77): rating from the final ranks of the
   * people, monthly season. Written in one batch; a participant row with a
   * rating already set is never applied again.
   */
  private async applyRanking(table: StandingRow[], now: number): Promise<RankedOutcome> {
    const s = this.state!;
    const season = await ensureCurrentSeason(this.env, now);
    s.seasonId = season.id;
    const people = this.active();
    const rankOf = (seat: number) => table.find((r) => r.seat === seat)!.rank;
    const stored = await this.env.DB.prepare('SELECT seat, rating_before, rating_after, rating_delta FROM draft_participants WHERE room_id = ? AND rating_after IS NOT NULL')
      .bind(s.roomId)
      .all<{ seat: number; rating_before: number; rating_after: number; rating_delta: number }>();
    if (stored.results.length) {
      return { seasonId: season.id, rated: true, changes: Object.fromEntries(stored.results.map((r) => [r.seat, { before: r.rating_before, after: r.rating_after, delta: r.rating_delta }])) };
    }
    const current = new Map<string, number>();
    for (const p of people) current.set(p.userId, (await ratingOf(this.env, season.id, p.userId, 'draft_rankings')).rating);
    const changes = eloFromRanks(people.map((p) => ({ id: p.userId, rating: current.get(p.userId)!, rank: rankOf(p.seat) })));
    const outcome: RankedOutcome = { seasonId: season.id, rated: people.length >= 2, changes: {} };
    const stmts: D1PreparedStatement[] = [];
    for (const p of people) {
      const c = changes.find((x) => x.id === p.userId)!;
      outcome.changes[p.seat] = { before: c.before, after: c.after, delta: c.delta };
      const notYet = 'EXISTS (SELECT 1 FROM draft_participants WHERE room_id = ? AND seat = ? AND rating_after IS NULL)';
      stmts.push(
        this.env.DB.prepare(
          `INSERT INTO draft_rankings (season_id, user_id, rating, initial_rating, peak_rating, games, wins, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, 0, 0, ?, ? WHERE ${notYet} ON CONFLICT(season_id, user_id) DO NOTHING`,
        ).bind(season.id, p.userId, c.before, c.before, c.before, now, now, s.roomId, p.seat),
        this.env.DB.prepare(
          `UPDATE draft_rankings SET rating = rating + ?, peak_rating = MAX(peak_rating, rating + ?), games = games + 1, wins = wins + ?, updated_at = ?
            WHERE season_id = ? AND user_id = ? AND ${notYet}`,
        ).bind(c.delta, c.delta, rankOf(p.seat) === 1 ? 1 : 0, now, season.id, p.userId, s.roomId, p.seat),
        this.env.DB.prepare('UPDATE draft_participants SET rating_before = ?, rating_after = ?, rating_delta = ? WHERE room_id = ? AND seat = ? AND rating_after IS NULL').bind(
          c.before,
          c.after,
          c.delta,
          s.roomId,
          p.seat,
        ),
        analyticsStatement(this.env, { name: 'rating_updated', userId: p.userId, properties: { roomId: s.roomId, mode: 'draft_match', seasonId: season.id, before: c.before, after: c.after, delta: c.delta, rank: rankOf(p.seat), humans: people.length } }),
      );
    }
    await this.env.DB.batch(stmts);
    return outcome;
  }

  /** decision 78: the same rewards as MATCH (COINS by rank within the daily cap, missions, Season Pass) */
  private async applyRewards(table: StandingRow[], now: number): Promise<Record<number, SeatReward>> {
    const s = this.state!;
    const people = this.active();
    const picks = s.draft?.picks ?? [];
    const inputs: LeagueRewardInput[] = people.map((p) => ({
      userId: p.userId,
      rank: table.find((r) => r.seat === p.seat)!.rank,
      matchWins: s.results.filter((r) => (r.home === p.seat && r.homeGoals > r.awayGoals) || (r.away === p.seat && r.awayGoals > r.homeGoals)).length,
      manualPicks: picks.filter((x) => x.seat === p.seat && !x.auto).length,
      goals: s.results.reduce((sum, r) => sum + (r.home === p.seat ? r.homeGoals : r.away === p.seat ? r.awayGoals : 0), 0),
    }));
    const granted = await grantLeagueRewards(this.env, s.roomId, 'draft_match', inputs, now);
    const out: Record<number, SeatReward> = {};
    for (const p of people) {
      const r = granted.get(p.userId);
      if (r) out[p.seat] = r;
    }
    return out;
  }

  // -------------------------------------------------------------- actions

  /** a refused action: error to the player and a row in the audit log (spec 10) */
  private refuse(userId: string | null, action: string, reason: string, detail?: Record<string, unknown>): HttpResult {
    this.audit(userId, action, reason, detail);
    return fail(reason, reason, 409);
  }

  private async action(userId: string, msg: DraftMatchClientMessage | undefined): Promise<HttpResult> {
    const s = this.state;
    if (!s) return fail('NOT_FOUND', 'room not found', 404);
    if (this.seatOf(userId) === null) return this.refuse(userId, String(msg?.type ?? 'unknown'), 'NOT_A_MEMBER');
    switch (msg?.type) {
      case 'formation':
        return this.chooseFormation(userId, msg.formation);
      case 'throw':
        return this.throwDice(userId);
      case 'pick':
        return this.pickByUser(userId, msg.playerId);
      case 'lineup':
        return this.submitLineup(userId, msg.lineup, msg.ready === true);
      case 'ready':
        return this.setReady(userId, msg.ready === true);
      case 'leave':
        return this.leave(userId);
      default:
        return this.refuse(userId, String((msg as { type?: unknown } | undefined)?.type ?? 'unknown'), 'UNKNOWN_MESSAGE');
    }
  }

  // -------------------------------------------------------------- websocket

  private acceptWebSocket(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const userId = request.headers.get('X-User-Id');
    if (!this.state || !userId || this.seatOf(userId) === null) return new Response('not a member', { status: 403 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId } satisfies WsAttachment);
    // reconnecting: the whole current state (spec 10)
    this.sendPlayers(server);
    this.send(server, { type: 'snapshot', state: this.snapshotFor(userId) });
    this.broadcastSnapshot();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const a = ws.deserializeAttachment() as WsAttachment | null;
    if (!a?.userId || !this.state) return;
    let msg: DraftMatchClientMessage;
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as DraftMatchClientMessage;
    } catch {
      this.audit(a.userId, 'message', 'BAD_MESSAGE');
      this.send(ws, { type: 'error', code: 'BAD_MESSAGE' });
      return;
    }
    if (msg.type === 'ping') {
      this.send(ws, { type: 'pong', t: msg.t, serverNow: this.now() });
      return;
    }
    if (msg.type === 'hello') {
      this.send(ws, { type: 'snapshot', state: this.snapshotFor(a.userId) });
      return;
    }
    let result: HttpResult;
    try {
      result = await this.action(a.userId, msg);
    } catch (err) {
      console.error('DraftMatchDO action failed', err);
      result = fail('INTERNAL', 'internal error', 500);
    }
    if (!result.ok) this.send(ws, { type: 'error', code: result.code, message: result.message });
    await this.scheduleAlarm();
    await this.dbQueue;
  }

  override async webSocketClose(ws: WebSocket) {
    this.broadcastSnapshot(ws);
  }

  override async webSocketError(ws: WebSocket) {
    this.broadcastSnapshot(ws);
  }
}
