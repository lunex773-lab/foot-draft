import type { ChemistryResult } from '../chemistry';
import type { FormationId, Lineup, Player, Tactics } from '../types';

export type Side = 'home' | 'away';

export interface SimTeamInput {
  seat: number;
  name: string;
  /** full roster (14). Starters / bench are referenced by id in lineup. */
  players: Player[];
  lineup: Lineup;
}

export interface SimInput {
  seed: string;
  home: SimTeamInput;
  away: SimTeamInput;
}

export type ChanceType =
  | 'through_ball'
  | 'cutback'
  | 'dribble'
  | 'cross'
  | 'long_shot'
  | 'counter'
  | 'press_win'
  | 'set_piece'
  | 'direct_fk'
  | 'penalty'
  | 'knock_down';

export type MatchEventType =
  | 'kickoff'
  | 'half_time'
  | 'full_time'
  | 'goal'
  | 'save'
  | 'miss'
  | 'block'
  | 'corner'
  | 'free_kick'
  | 'penalty'
  | 'foul'
  | 'yellow'
  | 'red'
  | 'sub'
  | 'tactic'
  | 'counter'
  | 'press_win';

export interface MatchEvent {
  /** match minute (float, 0..90) */
  minute: number;
  type: MatchEventType;
  side: Side;
  playerId?: string;
  /** assist provider / player coming off / fouled player */
  otherId?: string;
  chance?: ChanceType;
  xg?: number;
  /** ball position, absolute pitch coords (home attacks towards y=100) */
  x: number;
  y: number;
  /** score after the event */
  score: [number, number];
  /** tactic change description key */
  detail?: string;
}

export interface TrackPoint {
  /** minute */
  t: number;
  x: number;
  y: number;
  /** side in possession: 0 home, 1 away */
  s: 0 | 1;
}

export interface TeamStats {
  goals: number;
  shots: number;
  shotsOnTarget: number;
  xg: number;
  possession: number;
  passes: number;
  passesCompleted: number;
  corners: number;
  fouls: number;
  yellow: number;
  red: number;
  saves: number;
  tackles: number;
  interceptions: number;
  counters: number;
  counterShots: number;
  pressWins: number;
  longBalls: number;
  longBallsWon: number;
  bigChances: number;
}

export interface PlayerMatchStats {
  playerId: string;
  side: Side;
  started: boolean;
  minutes: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  keyPasses: number;
  tackles: number;
  interceptions: number;
  saves: number;
  yellow: number;
  red: number;
  rating: number;
  staminaEnd: number;
}

export interface TacticNote {
  key: 'possession' | 'press_wins' | 'counters' | 'long_balls' | 'low_block' | 'chemistry' | 'subs' | 'late_change';
  values: Record<string, number | string>;
}

export interface MatchResultData {
  seed: string;
  simVersion: string;
  score: { home: number; away: number };
  events: MatchEvent[];
  track: TrackPoint[];
  stats: { home: TeamStats; away: TeamStats };
  players: PlayerMatchStats[];
  mvpId: string;
  chemistry: { home: Pick<ChemistryResult, 'score' | 'modifier'>; away: Pick<ChemistryResult, 'score' | 'modifier'> };
  tactics: { home: Tactics; away: Tactics };
  formations: { home: FormationId; away: FormationId };
  notes: { home: TacticNote[]; away: TacticNote[] };
}
