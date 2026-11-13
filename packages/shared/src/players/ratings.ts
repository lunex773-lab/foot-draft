import { POSITION_WEIGHTS, positionFamiliarity } from '../data/positions';
import type { AttributeKey, DisplayStatKey, DisplayStats, InternalAttributes, Player, Position } from '../types';

export const ATTRIBUTE_KEYS: AttributeKey[] = [
  'acceleration',
  'sprintSpeed',
  'shotAccuracy',
  'shotPower',
  'finishing',
  'shortPassing',
  'longPassing',
  'vision',
  'ballControl',
  'dribbling',
  'tackling',
  'interception',
  'positioning',
  'stamina',
  'strength',
  'jumping',
  'gkReflexes',
  'gkHandling',
  'gkPositioning',
];

export const ATTRIBUTE_LABELS_JA: Record<AttributeKey, string> = {
  acceleration: '加速',
  sprintSpeed: 'スプリント速度',
  shotAccuracy: 'シュート精度',
  shotPower: 'シュート力',
  finishing: '決定力',
  shortPassing: 'ショートパス',
  longPassing: 'ロングパス',
  vision: '視野',
  ballControl: 'ボールコントロール',
  dribbling: 'ドリブル',
  tackling: 'タックル',
  interception: 'インターセプト',
  positioning: 'ポジショニング',
  stamina: 'スタミナ',
  strength: 'フィジカル強度',
  jumping: 'ジャンプ',
  gkReflexes: 'GK反応',
  gkHandling: 'GKキャッチング',
  gkPositioning: 'GKポジショニング',
};

/** How the 6 displayed stats are derived from internal attributes (spec 4-2). */
export const DISPLAY_FORMULA: Record<DisplayStatKey, Partial<Record<AttributeKey, number>>> = {
  pac: { acceleration: 0.45, sprintSpeed: 0.55 },
  sho: { finishing: 0.4, shotAccuracy: 0.2, shotPower: 0.2, positioning: 0.2 },
  pas: { shortPassing: 0.45, vision: 0.3, longPassing: 0.25 },
  dri: { dribbling: 0.55, ballControl: 0.45 },
  def: { tackling: 0.5, interception: 0.5 },
  phy: { strength: 0.4, stamina: 0.35, jumping: 0.25 },
};

export const DISPLAY_KEYS: DisplayStatKey[] = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];

export const DISPLAY_LABELS: Record<DisplayStatKey, string> = {
  pac: 'PAC',
  sho: 'SHO',
  pas: 'PAS',
  dri: 'DRI',
  def: 'DEF',
  phy: 'PHY',
};

export const DISPLAY_LABELS_JA: Record<DisplayStatKey, string> = {
  pac: 'スピード',
  sho: 'シュート',
  pas: 'パス',
  dri: 'ドリブル',
  def: '守備',
  phy: 'フィジカル',
};

function weighted(attrs: InternalAttributes, weights: Partial<Record<AttributeKey, number>>): number {
  let sum = 0;
  for (const k in weights) {
    const key = k as AttributeKey;
    sum += attrs[key] * (weights[key] ?? 0);
  }
  return sum;
}

export function computeDisplayStats(attrs: InternalAttributes): DisplayStats {
  return {
    pac: Math.round(weighted(attrs, DISPLAY_FORMULA.pac)),
    sho: Math.round(weighted(attrs, DISPLAY_FORMULA.sho)),
    pas: Math.round(weighted(attrs, DISPLAY_FORMULA.pas)),
    dri: Math.round(weighted(attrs, DISPLAY_FORMULA.dri)),
    def: Math.round(weighted(attrs, DISPLAY_FORMULA.def)),
    phy: Math.round(weighted(attrs, DISPLAY_FORMULA.phy)),
  };
}

/** Raw rating (no familiarity penalty), unrounded. */
export function rawPositionRating(attrs: InternalAttributes, pos: Position): number {
  return weighted(attrs, POSITION_WEIGHTS[pos]);
}

/** Rating of a player when played at `pos`, including the out-of-position penalty. */
export function ratingAt(player: Pick<Player, 'attributes' | 'positions'>, pos: Position): number {
  return Math.round(rawPositionRating(player.attributes, pos) * positionFamiliarity(player.positions, pos));
}

export function computeOvr(attrs: InternalAttributes, primary: Position): number {
  return Math.round(rawPositionRating(attrs, primary));
}
