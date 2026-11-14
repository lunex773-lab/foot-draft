/**
 * WebSocket protocol between the game client and the RoomDO (server).
 * The server is authoritative: clients only send intents.
 */
import type { SoloChallenge, TeamLeagueRecord } from './challenges';
import type { DraftPick } from './draft';
import type { StandingRow } from './league';
import type { PoolFilter } from './pool';
import type { MatchResultData } from './sim/types';
import type { Lineup, Player } from './types';

export type RoomMode = 'quick' | 'private' | 'ranked' | 'solo' | 'event' | 'collection';

/** What kind of league the room plays (Phase 3). */
export type RoomVariant =
  | { kind: 'standard' }
  | { kind: 'ranked' }
  | { kind: 'solo'; challenge: SoloChallenge }
  | { kind: 'event'; eventId: string; name: string; description: string; filter: PoolFilter | null; endsAt: number }
  | { kind: 'collection' };

/** rating change of one seat in a ranked league */
export interface SeatRatingChange {
  before: number;
  after: number;
  delta: number;
}

export interface RankedOutcome {
  seasonId: string;
  /** false when fewer than 2 humans played (rating unchanged) */
  rated: boolean;
  /** seat -> change (human seats only) */
  changes: Record<number, SeatRatingChange>;
}

export interface SoloOutcome {
  challengeId: string;
  cleared: boolean;
  record: TeamLeagueRecord;
}

/** currency granted to a seat after the league (Phase 4) */
export interface SeatReward {
  coins: number;
  /** false when the daily league cap was reached */
  matchRewardGiven: boolean;
  /** solo clear / event rank bonus included in coins */
  bonus: number;
  leaguesToday: number;
}

export interface RoomOutcome {
  ranked?: RankedOutcome;
  solo?: SoloOutcome;
  /** seat -> rewards (human seats) */
  rewards?: Record<number, SeatReward>;
}
export type RoomPhase = 'lobby' | 'drafting' | 'lineup' | 'playing' | 'finished' | 'closed';

export interface RoomSettings {
  pickSeconds: number;
  /** fill empty seats with CPU when the host starts */
  fillWithCpu: boolean;
  /** dev/test only: override timings (ignored in production) */
  queueSeconds?: number;
  lineupSecondsFirst?: number;
  lineupSecondsBetween?: number;
  playbackSeconds?: number;
}

export interface SeatInfo {
  seat: number;
  userId: string | null;
  displayName: string;
  isCpu: boolean;
  connected: boolean;
  isHost: boolean;
}

export interface MatchSummary {
  matchId: string;
  matchday: number;
  homeSeat: number;
  awaySeat: number;
  homeGoals: number | null;
  awayGoals: number | null;
}

export interface LiveMatch {
  matchId: string;
  matchday: number;
  homeSeat: number;
  awaySeat: number;
  /** epoch ms when playback starts on all clients */
  startAt: number;
  /** playback length (ms) */
  durationMs: number;
  result: MatchResultData;
}

export interface RoomSnapshot {
  roomId: string;
  code: string;
  mode: RoomMode;
  variant: RoomVariant;
  phase: RoomPhase;
  settings: RoomSettings;
  seats: SeatInfo[];
  /** ranked lobby: when the empty seats are filled with CPU and the draft starts */
  lobbyDeadline: number | null;
  /** server time (ms) to sync timers */
  serverNow: number;
  /** seat index of the receiving client (null = spectator) */
  you: number | null;
  /** draft order of seats (pick positions are randomized) */
  draft: null | {
    draftId: string;
    pool: string[];
    order: number[];
    picks: DraftPick[];
    currentSeat: number | null;
    deadline: number | null;
    /** Collection Draft: reserved player id -> seat */
    reserved: Record<string, number>;
  };
  /** rosters after the draft (seat -> player ids) */
  rosters: Record<number, string[]>;
  /** lineups: own lineup always; others' lineups only after they were used in a match */
  lineups: Record<number, Lineup | null>;
  lineupReady: Record<number, boolean>;
  matchday: number;
  phaseDeadline: number | null;
  fixtures: MatchSummary[];
  live: LiveMatch[];
  standings: StandingRow[];
  finalRanks: Record<number, number> | null;
  /** results decided by the server after the league (rating change, challenge result) */
  outcome: RoomOutcome | null;
}

export type ClientMessage =
  | { type: 'hello' }
  | { type: 'start' }
  | { type: 'pick'; playerId: string }
  | { type: 'lineup'; lineup: Lineup; ready?: boolean }
  | { type: 'ready'; ready: boolean }
  | { type: 'leave' }
  | { type: 'ping'; t: number }
  | { type: 'settings'; settings: Partial<RoomSettings> };

export type ServerMessage =
  | { type: 'snapshot'; state: RoomSnapshot }
  /** player cards of the draft pool (sent once per connection) */
  | { type: 'players'; players: Player[] }
  | { type: 'pick'; pick: DraftPick; nextSeat: number | null; deadline: number | null }
  | { type: 'error'; code: string; message?: string }
  | { type: 'pong'; t: number; serverNow: number };
