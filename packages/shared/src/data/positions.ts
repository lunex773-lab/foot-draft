import type { AttributeKey, Position, PositionGroup } from '../types';

export const POSITIONS: Position[] = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST'];

export const POSITION_GROUP: Record<Position, PositionGroup> = {
  GK: 'GK',
  CB: 'DF',
  LB: 'DF',
  RB: 'DF',
  LWB: 'DF',
  RWB: 'DF',
  CDM: 'MF',
  CM: 'MF',
  CAM: 'MF',
  LM: 'MF',
  RM: 'MF',
  LW: 'FW',
  RW: 'FW',
  CF: 'FW',
  ST: 'FW',
};

export const POSITION_LABEL_JA: Record<Position, string> = {
  GK: 'ゴールキーパー',
  CB: 'センターバック',
  LB: '左サイドバック',
  RB: '右サイドバック',
  LWB: '左ウイングバック',
  RWB: '右ウイングバック',
  CDM: '守備的MF',
  CM: 'セントラルMF',
  CAM: '攻撃的MF',
  LM: '左サイドMF',
  RM: '右サイドMF',
  LW: '左ウイング',
  RW: '右ウイング',
  CF: 'センターフォワード',
  ST: 'ストライカー',
};

export const GROUP_LABEL_JA: Record<PositionGroup, string> = {
  GK: 'GK',
  DF: 'DF',
  MF: 'MF',
  FW: 'FW',
};

const FULLBACK: Partial<Record<AttributeKey, number>> = {
  acceleration: 0.1,
  sprintSpeed: 0.12,
  tackling: 0.17,
  interception: 0.15,
  stamina: 0.12,
  shortPassing: 0.1,
  longPassing: 0.06,
  ballControl: 0.06,
  dribbling: 0.05,
  strength: 0.07,
};

const WINGBACK: Partial<Record<AttributeKey, number>> = {
  acceleration: 0.12,
  sprintSpeed: 0.13,
  tackling: 0.12,
  interception: 0.11,
  stamina: 0.15,
  shortPassing: 0.1,
  longPassing: 0.09,
  ballControl: 0.07,
  dribbling: 0.08,
  strength: 0.03,
};

const WIDE_MID: Partial<Record<AttributeKey, number>> = {
  acceleration: 0.1,
  sprintSpeed: 0.1,
  shortPassing: 0.12,
  longPassing: 0.08,
  dribbling: 0.14,
  ballControl: 0.13,
  vision: 0.1,
  stamina: 0.1,
  finishing: 0.05,
  positioning: 0.08,
};

const WINGER: Partial<Record<AttributeKey, number>> = {
  acceleration: 0.12,
  sprintSpeed: 0.12,
  dribbling: 0.17,
  ballControl: 0.14,
  finishing: 0.1,
  shotAccuracy: 0.06,
  shortPassing: 0.09,
  vision: 0.08,
  positioning: 0.07,
  shotPower: 0.05,
};

/**
 * Attribute weights used to compute a player's rating at a position
 * (relative strength between positions). Each row sums to 1.
 */
export const POSITION_WEIGHTS: Record<Position, Partial<Record<AttributeKey, number>>> = {
  GK: { gkReflexes: 0.32, gkHandling: 0.25, gkPositioning: 0.28, longPassing: 0.05, jumping: 0.05, acceleration: 0.05 },
  CB: {
    tackling: 0.22,
    interception: 0.22,
    strength: 0.15,
    jumping: 0.12,
    sprintSpeed: 0.06,
    shortPassing: 0.07,
    ballControl: 0.05,
    longPassing: 0.04,
    acceleration: 0.03,
    stamina: 0.04,
  },
  LB: FULLBACK,
  RB: FULLBACK,
  LWB: WINGBACK,
  RWB: WINGBACK,
  CDM: {
    interception: 0.17,
    tackling: 0.17,
    shortPassing: 0.13,
    longPassing: 0.08,
    ballControl: 0.08,
    strength: 0.1,
    stamina: 0.1,
    vision: 0.07,
    jumping: 0.05,
    positioning: 0.05,
  },
  CM: {
    shortPassing: 0.17,
    longPassing: 0.12,
    vision: 0.12,
    ballControl: 0.13,
    dribbling: 0.07,
    interception: 0.08,
    tackling: 0.07,
    stamina: 0.09,
    positioning: 0.05,
    strength: 0.05,
    shotPower: 0.05,
  },
  CAM: {
    vision: 0.16,
    shortPassing: 0.16,
    ballControl: 0.15,
    dribbling: 0.13,
    positioning: 0.08,
    finishing: 0.08,
    shotAccuracy: 0.07,
    longPassing: 0.07,
    acceleration: 0.05,
    shotPower: 0.05,
  },
  LM: WIDE_MID,
  RM: WIDE_MID,
  LW: WINGER,
  RW: WINGER,
  CF: {
    finishing: 0.16,
    positioning: 0.12,
    ballControl: 0.13,
    dribbling: 0.1,
    vision: 0.1,
    shortPassing: 0.1,
    shotAccuracy: 0.1,
    shotPower: 0.07,
    acceleration: 0.06,
    strength: 0.06,
  },
  ST: {
    finishing: 0.22,
    positioning: 0.14,
    shotPower: 0.1,
    shotAccuracy: 0.12,
    ballControl: 0.1,
    dribbling: 0.08,
    acceleration: 0.07,
    sprintSpeed: 0.07,
    strength: 0.05,
    jumping: 0.05,
  },
};

/**
 * Positions that count as natural for a formation slot
 * (CF plays the ST slot, wing-backs play the full-back slots).
 */
const EQUIVALENT: Partial<Record<Position, Position[]>> = {
  CF: ['ST'],
  LWB: ['LB'],
  RWB: ['RB'],
};

/** Neighbouring positions (smaller penalty). */
const RELATED: Record<Position, Position[]> = {
  GK: [],
  CB: ['CDM', 'LB', 'RB'],
  LB: ['LWB', 'LM', 'CB', 'RB'],
  RB: ['RWB', 'RM', 'CB', 'LB'],
  LWB: ['LB', 'LM', 'LW'],
  RWB: ['RB', 'RM', 'RW'],
  CDM: ['CM', 'CB'],
  CM: ['CDM', 'CAM', 'LM', 'RM'],
  CAM: ['CM', 'CF', 'ST', 'LW', 'RW'],
  LM: ['LW', 'LB', 'LWB', 'CM', 'RM'],
  RM: ['RW', 'RB', 'RWB', 'CM', 'LM'],
  LW: ['LM', 'ST', 'CF', 'RW', 'CAM'],
  RW: ['RM', 'ST', 'CF', 'LW', 'CAM'],
  CF: ['ST', 'CAM', 'LW', 'RW'],
  ST: ['CF', 'CAM', 'LW', 'RW'],
};

/**
 * Familiarity between positions (spec 4-5 適性外ポジションのペナルティ).
 * 1.0 when the player lists the position (or an equivalent one).
 */
export function positionFamiliarity(listed: readonly Position[], target: Position): number {
  if (listed.includes(target)) return 1;
  if (listed.some((p) => EQUIVALENT[p]?.includes(target))) return 1;
  if (target === 'GK') return 0.4;
  if (listed.length === 1 && listed[0] === 'GK') return 0.5;
  const related = listed.some((p) => RELATED[p].includes(target));
  if (related) return 0.93;
  const sameGroup = listed.some((p) => POSITION_GROUP[p] === POSITION_GROUP[target]);
  if (sameGroup) return 0.88;
  return 0.8;
}

export function relatedPositions(pos: Position): Position[] {
  return RELATED[pos];
}
