import {
  GAME_CONFIG,
  ROUND_ROBIN_4,
  Rng,
  applyPick,
  autoLineup,
  buildDraftPool,
  chooseAutoPick,
  computeChemistry,
  computeStandings,
  cpuLineup,
  createDraftState,
  currentSeat,
  isDraftComplete,
  rosterOf,
  simulateMatch,
  snakeOrder,
  validateLineup,
  validatePick,
  eloFromRanks,
  evaluateGoal,
  teamRecord,
  CPU_NAMES,
  RANKED_CONFIG,
  type ClientMessage,
  type DraftState,
  type FixtureResult,
  type FormationId,
  type Lineup,
  type LiveMatch,
  type MatchSummary,
  type Player,
  type RoomMode,
  type RoomOutcome,
  type RoomPhase,
  type RoomVariant,
  type RankedOutcome,
  type RoomSettings,
  type RoomSnapshot,
  type SeatReward,
  type ServerMessage,
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

const ROOM_MODES: RoomMode[] = ['quick', 'private', 'ranked', 'solo', 'event', 'collection'];

/**
 * RoomDO — one Durable Object per room. It is the single authority for the
 * room: membership, draft order and picks (incl. timeouts / auto picks),
 * lineups, match simulation and standings (spec 0-4 / 18-3).
 *
 * Game state lives in Durable Object storage so a room survives restarts and
 * hibernation. D1 receives a durable record of everything for history,
 * analytics and the admin site.
 */

interface SeatState {
  seat: number;
  userId: string | null;
  displayName: string;
  isCpu: boolean;
  joinedAt: number;
  /** Premium Membership badge (decision 55); missing in rooms created before */
  member?: boolean;
}

interface DraftRuntime {
  draftId: string;
  seed: string;
  state: DraftState;
  turnStartedAt: number;
  /** deadline for a human pick */
  deadline: number | null;
  /** when the CPU will pick */
  cpuDueAt: number | null;
}

interface RoomState {
  version: 1;
  roomId: string;
  code: string;
  mode: RoomMode;
  phase: RoomPhase;
  settings: RoomSettings;
  environment: string;
  allowTestTimings: boolean;
  hostUserId: string | null;
  seed: string;
  createdAt: number;
  seats: (SeatState | null)[];
  draft: DraftRuntime | null;
  rosters: Record<number, string[]>;
  lineups: Record<number, Lineup | null>;
  lineupReady: Record<number, boolean>;
  usedLineups: Record<number, Lineup | null>;
  matchday: number;
  phaseDeadline: number | null;
  fixtures: (MatchSummary & { seed: string })[];
  liveIds: string[];
  playbackEndsAt: number | null;
  results: FixtureResult[];
  finalRanks: Record<number, number> | null;
  /** Phase 3 (missing in rooms created before): league variant, ranked lobby deadline, outcome */
  variant?: RoomVariant;
  lobbyDeadline?: number | null;
  outcome?: RoomOutcome | null;
}

interface WsAttachment {
  userId: string;
}

type HttpResult = { ok: true; [k: string]: unknown } | { ok: false; code: string; message: string; status: number };

const fail = (code: string, message: string, status = 400): HttpResult => ({ ok: false, code, message, status });

export class RoomDO extends DurableObject<Env> {
  private state: RoomState | null = null;
  private players = new Map<string, Player>();
  private live = new Map<string, LiveMatch>();
  private dbQueue: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<RoomState>('state')) ?? null;
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

  private async save() {
    if (this.state) await this.ctx.storage.put('state', this.state);
  }

  /** queue D1 writes so they run in order without blocking game flow */
  private db(fn: () => Promise<unknown>) {
    this.dbQueue = this.dbQueue.then(fn).then(
      () => undefined,
      (err) => console.error('RoomDO D1 write failed', err),
    );
    return this.dbQueue;
  }

  private analytics(events: AnalyticsInput[]) {
    if (events.length === 0) return;
    this.db(() => this.env.DB.batch(events.map((e) => analyticsStatement(this.env, e))));
  }

  private seatOf(userId: string | null | undefined): number | null {
    if (!userId || !this.state) return null;
    const s = this.state.seats.find((x) => x && x.userId === userId);
    return s ? s.seat : null;
  }

  private humanSeats(): SeatState[] {
    return (this.state?.seats.filter((s) => s && !s.isCpu && s.userId) ?? []) as SeatState[];
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

  private timing(key: 'lineupSecondsFirst' | 'lineupSecondsBetween' | 'playbackSeconds'): number {
    const s = this.state!;
    const defaults = {
      lineupSecondsFirst: GAME_CONFIG.lineupSecondsFirst,
      lineupSecondsBetween: GAME_CONFIG.lineupSecondsBetween,
      playbackSeconds: GAME_CONFIG.matchPlaybackSeconds,
    };
    const override = s.allowTestTimings ? s.settings[key] : undefined;
    return (typeof override === 'number' && override > 0 ? override : defaults[key]) * 1000;
  }

  private roomStatusSql(phase: RoomPhase) {
    return this.env.DB.prepare('UPDATE rooms SET status = ? WHERE id = ?').bind(phase, this.state!.roomId);
  }

  private variant(): RoomVariant {
    return this.state?.variant ?? { kind: 'standard' };
  }

  /** Solo Challenge rule "formation fixed" (human seats only) */
  private lockedFormation(seat: number): FormationId | null {
    const v = this.variant();
    if (v.kind !== 'solo' || v.challenge.rule.type !== 'fixed_formation') return null;
    return this.state!.seats[seat]?.isCpu ? null : v.challenge.rule.formation;
  }

  /** modes whose rooms start by themselves when 4 humans are in */
  private autoStartsWhenFull(): boolean {
    const m = this.state!.mode;
    return m === 'quick' || m === 'ranked' || m === 'event' || m === 'collection';
  }

  // -------------------------------------------------------------- snapshot

  private snapshotFor(userId: string | null, exclude?: WebSocket): RoomSnapshot {
    const s = this.state!;
    const you = this.seatOf(userId);
    const connected = this.connectedUsers(exclude);
    const lineups: Record<number, Lineup | null> = {};
    for (let seat = 0; seat < GAME_CONFIG.maxPlayers; seat++) {
      lineups[seat] = seat === you ? s.lineups[seat] ?? null : s.usedLineups[seat] ?? null;
    }
    const draft = s.draft
      ? {
          draftId: s.draft.draftId,
          pool: s.draft.state.pool,
          order: s.draft.state.order,
          picks: s.draft.state.picks,
          currentSeat: currentSeat(s.draft.state),
          deadline: s.draft.deadline ?? s.draft.cpuDueAt,
          reserved: s.draft.state.reserved ?? {},
        }
      : null;
    return {
      roomId: s.roomId,
      code: s.code,
      mode: s.mode,
      variant: this.variant(),
      phase: s.phase,
      settings: s.settings,
      lobbyDeadline: s.phase === 'lobby' ? s.lobbyDeadline ?? null : null,
      seats: s.seats.map((x, seat) =>
        x
          ? {
              seat,
              userId: x.userId,
              displayName: x.displayName,
              isCpu: x.isCpu,
              connected: x.isCpu || (!!x.userId && connected.has(x.userId)),
              isHost: !!x.userId && x.userId === s.hostUserId,
              member: !!x.member,
            }
          : { seat, userId: null, displayName: '', isCpu: false, connected: false, isHost: false },
      ),
      serverNow: this.now(),
      you,
      draft,
      rosters: s.rosters,
      lineups,
      lineupReady: s.lineupReady,
      matchday: s.matchday,
      phaseDeadline: s.phaseDeadline,
      fixtures: s.fixtures.map(({ seed: _seed, ...f }) => f),
      live: s.phase === 'playing' ? s.liveIds.map((id) => this.live.get(id)).filter((m): m is LiveMatch => !!m) : [],
      standings: this.standings(),
      finalRanks: s.finalRanks,
      outcome: s.outcome ?? null,
    };
  }

  private standings(): StandingRow[] {
    return computeStandings(GAME_CONFIG.maxPlayers, this.state!.results, this.state!.seed);
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already closed */
    }
  }

  /**
   * @param skip   socket that should not receive this broadcast
   * @param closed socket that is closing (its user is shown as disconnected)
   */
  private broadcastSnapshot(skip?: WebSocket, closed?: WebSocket) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === skip || ws === closed) continue;
      const a = ws.deserializeAttachment() as WsAttachment | null;
      this.send(ws, { type: 'snapshot', state: this.snapshotFor(a?.userId ?? null, closed) });
    }
  }

  private broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        /* ignore */
      }
    }
  }

  private sendPlayers(ws?: WebSocket) {
    if (this.players.size === 0) return;
    const msg: ServerMessage = { type: 'players', players: [...this.players.values()] };
    if (ws) this.send(ws, msg);
    else this.broadcast(msg);
  }

  // ------------------------------------------------------------------ alarm

  private async scheduleAlarm() {
    const s = this.state;
    let due: number | null = null;
    if (s?.phase === 'lobby') due = s.lobbyDeadline ?? null;
    else if (s?.phase === 'drafting' && s.draft) due = s.draft.cpuDueAt ?? s.draft.deadline;
    else if (s?.phase === 'lineup') due = s.phaseDeadline;
    else if (s?.phase === 'playing') due = s.playbackEndsAt;
    if (due) await this.ctx.storage.setAlarm(due);
    else await this.ctx.storage.deleteAlarm();
  }

  override async alarm() {
    const s = this.state;
    if (!s) return;
    const now = this.now();
    if (s.phase === 'lobby' && s.lobbyDeadline && s.lobbyDeadline <= now + 25) {
      // ranked: nobody else came within the queue time -> CPU fill and start
      if (this.humanSeats().length > 0) await this.startDraft();
    } else if (s.phase === 'drafting' && s.draft) {
      const due = s.draft.cpuDueAt ?? s.draft.deadline;
      if (due !== null && due <= now + 25) {
        const seat = currentSeat(s.draft.state);
        if (seat !== null) {
          const seatInfo = s.seats[seat];
          const isCpu = !!seatInfo?.isCpu;
          const rng = new Rng(`${s.seed}:cpu:${s.draft.state.picks.length}`);
          const v = this.variant();
          // Solo Challenge "strong CPU": CPU picks the best player without randomness
          const noise = isCpu ? (v.kind === 'solo' && v.challenge.rule.type === 'strong_cpu' ? 0 : 2) : 0;
          const playerId = chooseAutoPick(s.draft.state, seat, this.players, isCpu && noise > 0 ? rng : undefined, noise);
          await this.doPick(seat, playerId, true, !isCpu);
        }
      }
    } else if (s.phase === 'lineup' && s.phaseDeadline !== null && s.phaseDeadline <= now + 25) {
      await this.startMatchday();
    } else if (s.phase === 'playing' && s.playbackEndsAt !== null && s.playbackEndsAt <= now + 25) {
      await this.finishMatchday();
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
        case '/start':
          result = await this.start(String(body.userId));
          break;
        case '/pick':
          result = await this.pickByUser(String(body.userId), String(body.playerId));
          break;
        case '/lineup':
          result = await this.submitLineup(String(body.userId), body.lineup as Lineup, body.ready === true);
          break;
        default:
          result = fail('NOT_FOUND', 'unknown room endpoint', 404);
      }
    } catch (err) {
      console.error('RoomDO error', err);
      result = fail('INTERNAL', 'internal error', 500);
    }
    if (this.state) await this.scheduleAlarm();
    await this.dbQueue;
    if (result.ok) return Response.json(result);
    return Response.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  }

  private async init(body: Record<string, unknown>): Promise<HttpResult> {
    if (this.state) return fail('CONFLICT', 'room already initialised', 409);
    const mode = ROOM_MODES.includes(body.mode as RoomMode) ? (body.mode as RoomMode) : 'quick';
    const settings = body.settings as RoomSettings;
    const allowTestTimings = body.allowTestTimings === true;
    const queueSeconds = allowTestTimings && settings.queueSeconds ? settings.queueSeconds : RANKED_CONFIG.queueSeconds;
    this.state = {
      version: 1,
      roomId: String(body.roomId),
      code: String(body.code),
      mode,
      variant: (body.variant as RoomVariant | undefined) ?? { kind: 'standard' },
      lobbyDeadline: mode === 'ranked' ? this.now() + queueSeconds * 1000 : null,
      outcome: null,
      phase: 'lobby',
      settings,
      environment: String(body.environment),
      allowTestTimings,
      hostUserId: null,
      seed: randomId(16),
      createdAt: this.now(),
      seats: [null, null, null, null],
      draft: null,
      rosters: {},
      lineups: {},
      lineupReady: {},
      usedLineups: {},
      matchday: 0,
      phaseDeadline: null,
      fixtures: [],
      liveIds: [],
      playbackEndsAt: null,
      results: [],
      finalRanks: null,
    };
    await this.save();
    return { ok: true };
  }

  private async join(userId: string, displayName: string): Promise<HttpResult> {
    const s = this.state;
    if (!s) return fail('NOT_FOUND', 'room not found', 404);
    const existing = this.seatOf(userId);
    if (existing !== null) return { ok: true, seat: existing, rejoined: true };
    if (s.phase !== 'lobby') return fail('ROOM_NOT_JOINABLE', 'the draft has already started', 409);
    // the badge only: membership never changes anything in the game (decision 55).
    // Looked up before a seat is chosen: other joins may run while this waits.
    const member = await membershipOf(this.env, userId)
      .then((m) => m.active)
      .catch(() => false);
    const again = this.seatOf(userId);
    if (again !== null) return { ok: true, seat: again, rejoined: true };
    if (s.phase !== 'lobby') return fail('ROOM_NOT_JOINABLE', 'the draft has already started', 409);
    const seat = s.seats.findIndex((x) => x === null);
    if (seat < 0 || (s.mode === 'solo' && this.humanSeats().length > 0)) return fail('ROOM_FULL', 'room is full', 409);
    const now = this.now();
    s.seats[seat] = { seat, userId, displayName: displayName.slice(0, 24), isCpu: false, joinedAt: now, member };
    if (!s.hostUserId) s.hostUserId = userId;
    await this.save();
    const count = s.seats.filter(Boolean).length;
    this.db(() =>
      this.env.DB.batch([
        this.env.DB.prepare('INSERT OR REPLACE INTO room_members (room_id, seat, user_id, display_name, is_cpu, joined_at) VALUES (?,?,?,?,0,?)').bind(s.roomId, seat, userId, displayName.slice(0, 24), now),
        this.env.DB.prepare('UPDATE rooms SET member_count = ?, host_user_id = ? WHERE id = ?').bind(count, s.hostUserId, s.roomId),
        analyticsStatement(this.env, { name: 'room_joined', userId, properties: { roomId: s.roomId, mode: s.mode, seat } }),
      ]),
    );
    this.broadcastSnapshot();
    // a full quick / ranked / event room starts automatically; a solo room starts right away
    if ((this.autoStartsWhenFull() && this.humanSeats().length === GAME_CONFIG.maxPlayers) || s.mode === 'solo') await this.startDraft();
    return { ok: true, seat, rejoined: false };
  }

  private async leave(userId: string): Promise<HttpResult> {
    const s = this.state;
    if (!s) return fail('NOT_FOUND', 'room not found', 404);
    const seat = this.seatOf(userId);
    if (seat === null) return { ok: true };
    if (s.phase !== 'lobby') {
      // after the draft started the seat stays; the server plays it automatically
      return { ok: true, autopilot: true };
    }
    s.seats[seat] = null;
    if (s.hostUserId === userId) s.hostUserId = this.humanSeats()[0]?.userId ?? null;
    const remaining = this.humanSeats().length;
    if (remaining === 0) s.phase = 'closed';
    await this.save();
    this.db(() =>
      this.env.DB.batch([
        this.env.DB.prepare('DELETE FROM room_members WHERE room_id = ? AND seat = ?').bind(s.roomId, seat),
        this.env.DB.prepare('UPDATE rooms SET member_count = ?, host_user_id = ?, status = ? WHERE id = ?').bind(remaining, s.hostUserId, s.phase, s.roomId),
        analyticsStatement(this.env, { name: 'room_left', userId, properties: { roomId: s.roomId, phase: 'lobby' } }),
      ]),
    );
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as WsAttachment | null;
      if (a?.userId === userId) ws.close(1000, 'left');
    }
    this.broadcastSnapshot();
    return { ok: true };
  }

  private async start(userId: string): Promise<HttpResult> {
    const s = this.state;
    if (!s) return fail('NOT_FOUND', 'room not found', 404);
    if (s.phase !== 'lobby') return fail('CONFLICT', 'already started', 409);
    if (s.mode === 'ranked' || s.mode === 'solo') return fail('FORBIDDEN', 'this room starts automatically', 403);
    if (s.hostUserId !== userId) return fail('FORBIDDEN', 'only the host can start', 403);
    const humans = this.humanSeats().length;
    if (!s.settings.fillWithCpu && humans < GAME_CONFIG.maxPlayers) return fail('CONFLICT', '4 players are required (CPU fill is off)', 409);
    await this.startDraft();
    return { ok: true };
  }

  // ------------------------------------------------------------------ draft

  private async startDraft() {
    const s = this.state!;
    if (s.phase !== 'lobby') return;
    const now = this.now();
    // fill empty seats with CPU
    let cpuIdx = 0;
    const cpuNames = new Rng(`${s.seed}:cpu-names`).shuffle(CPU_NAMES);
    for (let seat = 0; seat < GAME_CONFIG.maxPlayers; seat++) {
      if (!s.seats[seat]) s.seats[seat] = { seat, userId: null, displayName: cpuNames[cpuIdx++ % cpuNames.length], isCpu: true, joinedAt: now };
    }
    const catalog = await loadCatalog(this.env);
    if (s.phase !== 'lobby') return; // another event started it meanwhile
    const rng = new Rng(`${s.seed}:draft`);
    const v = this.variant();
    const filter = v.kind === 'solo' ? v.challenge.pool.filter : v.kind === 'event' ? v.filter : null;
    const byId = new Map(catalog.map((p) => [p.id, p]));
    // Collection Draft (decision 36): each human's registered cards join the pool, reserved for their owners
    const reserved = v.kind === 'collection' ? await this.collectionReservations(byId) : {};
    if (s.phase !== 'lobby') return;
    const reservedIds = Object.keys(reserved);
    const common = buildDraftPool(reservedIds.length ? catalog.filter((p) => !reserved[p.id]) : catalog, rng.fork('pool'), GAME_CONFIG.pool, filter);
    const pool = [...common, ...reservedIds.sort()];
    this.players = new Map(pool.map((id) => [id, byId.get(id)!]));
    const state = createDraftState(pool);
    if (reservedIds.length) state.reserved = reserved;
    // randomize draft positions, then apply the snake order to them
    let perm = rng.fork('order').shuffle([0, 1, 2, 3]);
    if (v.kind === 'solo' && v.challenge.rule.type === 'last_pick') {
      // Solo Challenge rule: the player picks 4th (last) in the first round
      const human = this.humanSeats()[0]?.seat ?? 0;
      perm = [...perm.filter((x) => x !== human), human];
    }
    state.order = snakeOrder(GAME_CONFIG.maxPlayers, GAME_CONFIG.picksPerPlayer).map((i) => perm[i]);
    s.draft = { draftId: randomId(), seed: rng.seed, state, turnStartedAt: now, deadline: null, cpuDueAt: null };
    s.phase = 'drafting';
    this.setTurnTimer(now);
    await this.ctx.storage.put('players', [...this.players.values()]);
    await this.save();

    const cpuSeats = s.seats.filter((x) => x?.isCpu) as SeatState[];
    this.db(() =>
      this.env.DB.batch([
        this.env.DB.prepare("UPDATE rooms SET status = 'drafting', started_at = ? WHERE id = ?").bind(now, s.roomId),
        ...cpuSeats.map((c) => this.env.DB.prepare('INSERT OR REPLACE INTO room_members (room_id, seat, user_id, display_name, is_cpu, joined_at) VALUES (?,?,NULL,?,1,?)').bind(s.roomId, c.seat, c.displayName, now)),
        this.env.DB.prepare("INSERT INTO drafts (id, room_id, seed, pool_json, pick_seconds, status, started_at) VALUES (?,?,?,?,?,'active',?)").bind(
          s.draft!.draftId,
          s.roomId,
          s.draft!.seed,
          JSON.stringify(pool),
          s.settings.pickSeconds,
          now,
        ),
        this.env.DB.prepare('UPDATE rooms SET member_count = 4 WHERE id = ?').bind(s.roomId),
      ]),
    );
    this.analytics(this.humanSeats().map((h) => ({ name: 'draft_started', userId: h.userId, properties: { roomId: s.roomId, draftId: s.draft!.draftId, mode: s.mode, humans: this.humanSeats().length } })));
    this.sendPlayers();
    this.broadcastSnapshot();
    await this.scheduleAlarm();
  }

  /** registered Collection Draft cards of the human seats: player id -> owner seats */
  private async collectionReservations(byId: Map<string, Player>): Promise<Record<string, number[]>> {
    const humans = this.humanSeats();
    if (humans.length === 0) return {};
    const rows = await this.env.DB.prepare(
      `SELECT r.user_id, r.player_id FROM collection_draft_rosters r
         JOIN user_collections uc ON uc.user_id = r.user_id AND uc.player_id = r.player_id
        WHERE r.user_id IN (${humans.map(() => '?').join(',')}) ORDER BY r.user_id, r.slot`,
    )
      .bind(...humans.map((h) => h.userId))
      .all<{ user_id: string; player_id: string }>();
    const out: Record<string, number[]> = {};
    for (const r of rows.results) {
      const seat = this.seatOf(r.user_id);
      if (seat === null || !byId.has(r.player_id)) continue;
      (out[r.player_id] ??= []).push(seat);
    }
    return out;
  }

  private setTurnTimer(now: number) {
    const s = this.state!;
    const d = s.draft!;
    const seat = currentSeat(d.state);
    d.turnStartedAt = now;
    if (seat === null) {
      d.deadline = null;
      d.cpuDueAt = null;
    } else if (s.seats[seat]?.isCpu) {
      d.deadline = null;
      d.cpuDueAt = now + GAME_CONFIG.cpuPickDelayMs;
    } else {
      d.cpuDueAt = null;
      d.deadline = now + s.settings.pickSeconds * 1000;
    }
  }

  private async pickByUser(userId: string, playerId: string): Promise<HttpResult> {
    const s = this.state;
    if (!s) return fail('NOT_FOUND', 'room not found', 404);
    if (s.phase !== 'drafting' || !s.draft) return fail('CONFLICT', 'not drafting', 409);
    const seat = this.seatOf(userId);
    if (seat === null) return fail('FORBIDDEN', 'not a member of this room', 403);
    const err = validatePick(s.draft.state, seat, playerId, this.players);
    if (err) return fail(err, err, 409);
    await this.doPick(seat, playerId, false, false);
    await this.scheduleAlarm();
    return { ok: true };
  }

  private async doPick(seat: number, playerId: string, auto: boolean, timeout: boolean) {
    const s = this.state!;
    const d = s.draft!;
    const pick = applyPick(d.state, seat, playerId, auto, this.players);
    const now = this.now();
    this.setTurnTimer(now);
    await this.save();
    const seatInfo = s.seats[seat]!;
    const p = this.players.get(playerId)!;
    this.db(() =>
      this.env.DB.batch([
        this.env.DB.prepare('INSERT INTO draft_picks (draft_id, pick_no, seat, user_id, player_id, is_auto, picked_at) VALUES (?,?,?,?,?,?,?)').bind(d.draftId, pick.pickNo, seat, seatInfo.userId, playerId, auto ? 1 : 0, now),
        ...(seatInfo.isCpu
          ? []
          : [
              analyticsStatement(this.env, {
                name: timeout ? 'draft_timeout' : 'draft_pick_completed',
                userId: seatInfo.userId,
                properties: { draftId: d.draftId, pickNo: pick.pickNo, playerId, rarity: p.rarity, position: p.primaryPosition, auto, ms: now - (d.turnStartedAt || now) },
              }),
            ]),
      ]),
    );
    this.broadcast({ type: 'pick', pick, nextSeat: currentSeat(d.state), deadline: d.deadline ?? d.cpuDueAt });
    if (isDraftComplete(d.state)) await this.finishDraft();
  }

  private async finishDraft() {
    const s = this.state!;
    const d = s.draft!;
    const now = this.now();
    for (let seat = 0; seat < GAME_CONFIG.maxPlayers; seat++) s.rosters[seat] = rosterOf(d.state, seat);
    // schedule: fixtures with pre-assigned ids & seeds
    s.fixtures = [];
    ROUND_ROBIN_4.forEach((md, i) => {
      for (const [home, away] of md) {
        s.fixtures.push({ matchId: randomId(), matchday: i + 1, homeSeat: home, awaySeat: away, homeGoals: null, awayGoals: null, seed: `${s.seed}:md${i + 1}:${home}-${away}` });
      }
    });
    s.matchday = 1;
    for (let seat = 0; seat < GAME_CONFIG.maxPlayers; seat++) {
      const roster = this.roster(seat);
      if (s.seats[seat]!.isCpu) {
        s.lineups[seat] = cpuLineup(roster, new Rng(`${s.seed}:cpu-lineup:${seat}:1`), this.roster(this.opponentOf(seat, 1)));
        s.lineupReady[seat] = true;
      } else {
        s.lineups[seat] = autoLineup(roster, this.lockedFormation(seat) ?? undefined);
        s.lineupReady[seat] = false;
      }
    }
    s.phase = 'lineup';
    s.phaseDeadline = now + this.timing('lineupSecondsFirst');
    await this.save();
    this.db(() =>
      this.env.DB.batch([
        this.env.DB.prepare("UPDATE drafts SET status = 'completed', completed_at = ? WHERE id = ?").bind(now, d.draftId),
        this.roomStatusSql('lineup'),
        ...this.humanSeats().map((h) => analyticsStatement(this.env, { name: 'draft_completed', userId: h.userId, properties: { draftId: d.draftId, roomId: s.roomId } })),
      ]),
    );
    this.broadcastSnapshot();
  }

  private roster(seat: number): Player[] {
    return (this.state!.rosters[seat] ?? []).map((id) => this.players.get(id)!).filter(Boolean);
  }

  private opponentOf(seat: number, matchday: number): number {
    const pair = ROUND_ROBIN_4[matchday - 1].find(([h, a]) => h === seat || a === seat)!;
    return pair[0] === seat ? pair[1] : pair[0];
  }

  // ---------------------------------------------------------------- lineups

  private async submitLineup(userId: string, lineup: Lineup, ready: boolean): Promise<HttpResult> {
    const s = this.state;
    if (!s) return fail('NOT_FOUND', 'room not found', 404);
    if (s.phase !== 'lineup') return fail('CONFLICT', 'lineups are locked', 409);
    const seat = this.seatOf(userId);
    if (seat === null) return fail('FORBIDDEN', 'not a member of this room', 403);
    const err = validateLineup(lineup, s.rosters[seat], this.lockedFormation(seat));
    if (err) return fail(err, err, 400);
    s.lineups[seat] = { formation: lineup.formation, starters: [...lineup.starters], bench: [...lineup.bench], tactics: { ...lineup.tactics } };
    s.lineupReady[seat] = ready;
    await this.save();
    if (this.humanSeats().every((h) => s.lineupReady[h.seat])) {
      await this.startMatchday();
      await this.scheduleAlarm();
    } else {
      this.broadcastSnapshot();
    }
    return { ok: true };
  }

  private async setReady(userId: string, ready: boolean) {
    const s = this.state!;
    const seat = this.seatOf(userId);
    if (seat === null || s.phase !== 'lineup') return;
    s.lineupReady[seat] = ready;
    await this.save();
    if (this.humanSeats().every((h) => s.lineupReady[h.seat])) {
      await this.startMatchday();
      await this.scheduleAlarm();
    } else this.broadcastSnapshot();
  }

  // ---------------------------------------------------------------- matches

  private async startMatchday() {
    const s = this.state!;
    if (s.phase !== 'lineup') return;
    const now = this.now();
    const md = s.matchday;
    const fixtures = s.fixtures.filter((f) => f.matchday === md);
    // CPU teams adapt to their opponent each matchday
    for (const seat of [0, 1, 2, 3]) {
      if (s.seats[seat]!.isCpu && md > 1) {
        s.lineups[seat] = cpuLineup(this.roster(seat), new Rng(`${s.seed}:cpu-lineup:${seat}:${md}`), this.roster(this.opponentOf(seat, md)));
      }
    }
    const startAt = now + 2500;
    const durationMs = this.timing('playbackSeconds');
    const writes: D1PreparedStatement[] = [];
    this.live.clear();
    for (const f of fixtures) {
      const team = (seat: number) => ({ seat, name: s.seats[seat]!.displayName, players: this.roster(seat), lineup: s.lineups[seat] ?? autoLineup(this.roster(seat)) });
      const home = team(f.homeSeat);
      const away = team(f.awaySeat);
      const result = simulateMatch({ seed: f.seed, home, away });
      const live: LiveMatch = { matchId: f.matchId, matchday: md, homeSeat: f.homeSeat, awaySeat: f.awaySeat, startAt, durationMs, result };
      this.live.set(f.matchId, live);
      await this.ctx.storage.put(`live:${f.matchId}`, live);
      s.usedLineups[f.homeSeat] = home.lineup;
      s.usedLineups[f.awaySeat] = away.lineup;
      const homeUser = s.seats[f.homeSeat]!.userId;
      const awayUser = s.seats[f.awaySeat]!.userId;
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
          homeUser,
          awayUser,
          now,
          startAt,
        ),
        ...(['home', 'away'] as const).map((side) => {
          const t = side === 'home' ? home : away;
          return this.env.DB.prepare('INSERT INTO match_teams (match_id, side, seat, user_id, team_name, lineup_json, players_json, chemistry) VALUES (?,?,?,?,?,?,?,?)').bind(
            f.matchId,
            side,
            t.seat,
            s.seats[t.seat]!.userId,
            t.name,
            JSON.stringify(t.lineup),
            JSON.stringify(t.players),
            chem(t),
          );
        }),
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
        ...[homeUser, awayUser].filter(Boolean).map((u) => analyticsStatement(this.env, { name: 'match_started', userId: u, properties: { matchId: f.matchId, roomId: s.roomId, matchday: md } })),
      );
    }
    s.liveIds = fixtures.map((f) => f.matchId);
    s.phase = 'playing';
    s.phaseDeadline = null;
    s.playbackEndsAt = startAt + durationMs + 1500;
    await this.save();
    this.db(() => this.env.DB.batch([...writes, this.roomStatusSql('playing')]));
    this.broadcastSnapshot();
  }

  private async finishMatchday() {
    const s = this.state!;
    if (s.phase !== 'playing') return;
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
        const u = s.seats[seat]!.userId;
        if (u) {
          const gf = seat === m.homeSeat ? f.homeGoals : f.awayGoals;
          const ga = seat === m.homeSeat ? f.awayGoals : f.homeGoals;
          writes.push(analyticsStatement(this.env, { name: 'match_completed', userId: u, properties: { matchId: id, roomId: s.roomId, result: gf > ga ? 'win' : gf < ga ? 'loss' : 'draw', gf, ga } }));
        }
      }
    }
    for (const id of s.liveIds) await this.ctx.storage.delete(`live:${id}`);
    s.liveIds = [];
    this.live.clear();
    s.playbackEndsAt = null;
    if (s.matchday < ROUND_ROBIN_4.length) {
      s.matchday += 1;
      s.phase = 'lineup';
      s.phaseDeadline = now + this.timing('lineupSecondsBetween');
      for (const seat of [0, 1, 2, 3]) s.lineupReady[seat] = !!s.seats[seat]!.isCpu;
      writes.push(this.roomStatusSql('lineup'));
    } else {
      s.phase = 'finished';
      s.phaseDeadline = null;
      const table = this.standings();
      s.finalRanks = Object.fromEntries(table.map((r) => [r.seat, r.rank]));
      writes.push(this.env.DB.prepare("UPDATE rooms SET status = 'finished', finished_at = ? WHERE id = ?").bind(now, s.roomId));
      for (const r of table) {
        writes.push(this.env.DB.prepare('UPDATE room_members SET final_rank = ?, points = ?, goals_for = ?, goals_against = ? WHERE room_id = ? AND seat = ?').bind(r.rank, r.points, r.goalsFor, r.goalsAgainst, s.roomId, r.seat));
      }
      s.outcome = await this.leagueOutcome(table, now, writes);
    }
    await this.save();
    this.db(() => this.env.DB.batch(writes));
    this.broadcastSnapshot();
  }

  // --------------------------------------------------------------- outcomes

  /** results decided after the league: ranked rating changes, Solo Challenge goal, rewards */
  private async leagueOutcome(table: StandingRow[], now: number, writes: D1PreparedStatement[]): Promise<RoomOutcome | null> {
    const s = this.state!;
    const v = this.variant();
    const outcome: RoomOutcome = {};
    if (s.mode === 'ranked') {
      try {
        outcome.ranked = await this.applyRanked(table, now);
      } catch (err) {
        console.error('ranked rating update failed', err);
      }
    }
    let soloCleared: string | null = null;
    if (v.kind === 'solo') {
      const human = this.humanSeats()[0];
      if (human) {
        const record = teamRecord(human.seat, table, s.results);
        const cleared = evaluateGoal(v.challenge.goal, record);
        if (cleared) soloCleared = v.challenge.id;
        writes.push(
          this.env.DB.prepare('UPDATE solo_attempts SET status = ?, result_json = ?, finished_at = ? WHERE room_id = ?').bind(cleared ? 'cleared' : 'failed', JSON.stringify(record), now, s.roomId),
          analyticsStatement(this.env, { name: 'solo_challenge_completed', userId: human.userId, properties: { challengeId: v.challenge.id, roomId: s.roomId, cleared, rank: record.rank } }),
        );
        outcome.solo = { challengeId: v.challenge.id, cleared, record };
      }
    }
    try {
      outcome.rewards = await this.applyRewards(table, now, soloCleared);
    } catch (err) {
      // not lost: pending solo / event rewards are paid later by the wallet endpoint
      console.error('league rewards failed', err);
    }
    return Object.keys(outcome).length ? outcome : null;
  }

  /** match rewards, bonuses and mission progress of the human seats (Phase 4) */
  private async applyRewards(table: StandingRow[], now: number, soloCleared: string | null): Promise<Record<number, SeatReward>> {
    const s = this.state!;
    const humans = this.humanSeats();
    const picks = s.draft?.state.picks ?? [];
    const inputs: LeagueRewardInput[] = humans.map((h) => ({
      userId: h.userId!,
      rank: table.find((r) => r.seat === h.seat)!.rank,
      matchWins: s.results.filter((r) => (r.home === h.seat && r.homeGoals > r.awayGoals) || (r.away === h.seat && r.awayGoals > r.homeGoals)).length,
      manualPicks: picks.filter((p) => p.seat === h.seat && !p.auto).length,
      soloClearedChallengeId: soloCleared,
    }));
    const granted = await grantLeagueRewards(this.env, s.roomId, s.mode, inputs, now);
    const out: Record<number, SeatReward> = {};
    for (const h of humans) {
      const r = granted.get(h.userId!);
      if (r) out[h.seat] = r;
    }
    return out;
  }

  /**
   * Elo from the final ranks of the human players (decisions 25-26). Written
   * in one D1 batch; rating_changes(room_id, user_id) is UNIQUE, so a league
   * can never be applied twice.
   */
  private async applyRanked(table: StandingRow[], now: number): Promise<RankedOutcome> {
    const s = this.state!;
    const season = await ensureCurrentSeason(this.env, now);
    const humans = this.humanSeats();
    const rankOf = (seat: number) => table.find((r) => r.seat === seat)!.rank;
    const current = new Map<string, { rating: number; exists: boolean }>();
    for (const h of humans) current.set(h.userId!, await ratingOf(this.env, season.id, h.userId!));
    const rated = humans.length >= 2;
    const changes = eloFromRanks(
      humans.map((h) => ({ id: h.userId!, rating: current.get(h.userId!)!.rating, rank: rankOf(h.seat) })),
    );
    const outcome: RankedOutcome = { seasonId: season.id, rated, changes: {} };
    const stmts: D1PreparedStatement[] = [];
    for (const h of humans) {
      const c = changes.find((x) => x.id === h.userId)!;
      const delta = rated ? c.delta : 0;
      const before = c.before;
      outcome.changes[h.seat] = { before, after: before + delta, delta };
      stmts.push(
        this.env.DB.prepare(
          'INSERT INTO rating_changes (id, season_id, room_id, user_id, final_rank, humans, rated, rating_before, rating_after, delta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(randomId(), season.id, s.roomId, h.userId, rankOf(h.seat), humans.length, rated ? 1 : 0, before, before + delta, delta, now),
      );
      if (rated) {
        stmts.push(
          this.env.DB.prepare(
            'INSERT INTO ranked_ratings (season_id, user_id, rating, initial_rating, peak_rating, games, wins, created_at, updated_at) VALUES (?,?,?,?,?,0,0,?,?) ON CONFLICT(season_id, user_id) DO NOTHING',
          ).bind(season.id, h.userId, before, before, before, now, now),
          this.env.DB.prepare(
            'UPDATE ranked_ratings SET rating = rating + ?, peak_rating = MAX(peak_rating, rating + ?), games = games + 1, wins = wins + ?, updated_at = ? WHERE season_id = ? AND user_id = ?',
          ).bind(delta, delta, rankOf(h.seat) === 1 ? 1 : 0, now, season.id, h.userId),
          analyticsStatement(this.env, { name: 'rating_updated', userId: h.userId, properties: { roomId: s.roomId, seasonId: season.id, before, after: before + delta, delta, rank: rankOf(h.seat), humans: humans.length } }),
        );
      }
    }
    try {
      await this.env.DB.batch(stmts);
    } catch (err) {
      // already applied (e.g. retried after a restart): report what was stored
      const rows = await this.env.DB.prepare('SELECT user_id, rating_before, rating_after, delta, rated FROM rating_changes WHERE room_id = ?')
        .bind(s.roomId)
        .all<{ user_id: string; rating_before: number; rating_after: number; delta: number; rated: number }>();
      if (rows.results.length === 0) throw err;
      outcome.changes = {};
      for (const r of rows.results) {
        const seat = this.seatOf(r.user_id);
        if (seat !== null) outcome.changes[seat] = { before: r.rating_before, after: r.rating_after, delta: r.delta };
        outcome.rated = r.rated === 1;
      }
    }
    return outcome;
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
    this.sendPlayers(server);
    this.send(server, { type: 'snapshot', state: this.snapshotFor(userId) });
    this.broadcastSnapshot(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const a = ws.deserializeAttachment() as WsAttachment | null;
    if (!a?.userId || !this.state) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as ClientMessage;
    } catch {
      this.send(ws, { type: 'error', code: 'BAD_MESSAGE' });
      return;
    }
    let result: HttpResult | null = null;
    switch (msg.type) {
      case 'ping':
        this.send(ws, { type: 'pong', t: msg.t, serverNow: this.now() });
        return;
      case 'hello':
        this.send(ws, { type: 'snapshot', state: this.snapshotFor(a.userId) });
        return;
      case 'start':
        result = await this.start(a.userId);
        break;
      case 'pick':
        result = await this.pickByUser(a.userId, String(msg.playerId));
        break;
      case 'lineup':
        result = await this.submitLineup(a.userId, msg.lineup, msg.ready === true);
        break;
      case 'ready':
        await this.setReady(a.userId, msg.ready === true);
        break;
      case 'leave':
        result = await this.leave(a.userId);
        break;
      case 'settings':
        result = await this.updateSettings(a.userId, msg.settings);
        break;
      default:
        this.send(ws, { type: 'error', code: 'UNKNOWN_MESSAGE' });
    }
    if (result && !result.ok) this.send(ws, { type: 'error', code: result.code, message: result.message });
    await this.scheduleAlarm();
    await this.dbQueue;
  }

  private async updateSettings(userId: string, patch: Partial<RoomSettings>): Promise<HttpResult> {
    const s = this.state!;
    if (s.phase !== 'lobby') return fail('CONFLICT', 'settings are locked', 409);
    if (s.mode !== 'quick' && s.mode !== 'private') return fail('FORBIDDEN', 'settings are fixed in this mode', 403);
    if (s.hostUserId !== userId) return fail('FORBIDDEN', 'only the host can change settings', 403);
    const next = sanitizeSettings({ ...s.settings, ...patch }, s.allowTestTimings);
    s.settings = next;
    await this.save();
    this.db(() => this.env.DB.prepare('UPDATE rooms SET settings_json = ? WHERE id = ?').bind(JSON.stringify(next), s.roomId).run());
    this.broadcastSnapshot();
    return { ok: true };
  }

  override async webSocketClose(ws: WebSocket) {
    this.broadcastSnapshot(undefined, ws);
  }

  override async webSocketError(ws: WebSocket) {
    this.broadcastSnapshot(undefined, ws);
  }
}

export function sanitizeSettings(input: Partial<RoomSettings>, allowTestTimings: boolean): RoomSettings {
  const pick = Number(input.pickSeconds);
  const out: RoomSettings = {
    pickSeconds: GAME_CONFIG.pickSecondsOptions.includes(pick) ? pick : allowTestTimings && pick >= 1 && pick <= 60 ? pick : GAME_CONFIG.pickSeconds,
    fillWithCpu: input.fillWithCpu !== false,
  };
  if (allowTestTimings) {
    for (const k of ['queueSeconds', 'lineupSecondsFirst', 'lineupSecondsBetween', 'playbackSeconds'] as const) {
      const v = Number(input[k]);
      if (Number.isFinite(v) && v >= 1 && v <= 600) out[k] = v;
    }
  }
  return out;
}
