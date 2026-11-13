/**
 * WebSocket protocol between the game client and the RoomDO (server).
 * The server is authoritative: clients only send intents.
 */
import type { DraftPick } from './draft';
import type { StandingRow } from './league';
import type { MatchResultData } from './sim/types';
import type { Lineup, Player } from './types';

export type RoomMode = 'quick' | 'private';
export type RoomPhase = 'lobby' | 'drafting' | 'lineup' | 'playing' | 'finished' | 'closed';

export interface RoomSettings {
  pickSeconds: number;
  /** fill empty seats with CPU when the host starts */
  fillWithCpu: boolean;
  /** dev/test only: override timings (ignored in production) */
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
  phase: RoomPhase;
  settings: RoomSettings;
  seats: SeatInfo[];
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
