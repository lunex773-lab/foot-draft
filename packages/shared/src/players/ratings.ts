import { POSITION_WEIGHTS, positionFamiliarity } from '../data/positions';
import type { AttributeKey, DisplayStatKey, InternalAttributes, Player, Position } from '../types';

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

/** Raw rating (no familiarity penalty, not calibrated), unrounded. */
export function rawPositionRating(attrs: InternalAttributes, pos: Position): number {
  const weights = POSITION_WEIGHTS[pos];
  let sum = 0;
  for (const k in weights) sum += attrs[k as AttributeKey] * (weights[k as AttributeKey] ?? 0);
  return sum;
}

/**
 * Rating of a player when played at `pos`. Calibrated so that the rating at
 * the primary position equals the card OVR from the database; other
 * positions keep their relative strength and the out-of-position penalty.
 */
export function ratingAt(player: Pick<Player, 'attributes' | 'positions' | 'primaryPosition' | 'ovr'>, pos: Position): number {
  const base = rawPositionRating(player.attributes, player.primaryPosition);
  const scale = base > 0 ? player.ovr / base : 1;
  const rating = rawPositionRating(player.attributes, pos) * scale * positionFamiliarity(player.positions, pos);
  return Math.max(1, Math.min(99, Math.round(rating)));
}
