import type { Rarity } from '@fd/shared';
import { GOAL } from './stadium';

/**
 * SHOOT GACHA plan (spec "SHOOT GACHA" 2-3). The rarity comes from the
 * server's draw result; the drag only changes the motion: how far the leg
 * swings, the speed of the ball and where it goes. Every shot is a goal.
 */

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'icon'];

export function bestRarity(list: { rarity: Rarity }[]): Rarity {
  return list.reduce<Rarity>((best, r) => (RARITY_ORDER.indexOf(r.rarity) > RARITY_ORDER.indexOf(best) ? r.rarity : best), 'common');
}

export interface Aim {
  /** 0..1 how far the ball was pulled */
  power: number;
  /** where the ball crosses the goal line (always inside the goal) */
  target: { x: number; y: number };
}

/** the shot never goes straight at the keeper: at least this far from the middle */
const MIN_SIDE = 1.35;

/**
 * Pull-and-release: pulling down-right sends the ball up-left and so on.
 * dx / dy are the drag in screen pixels (down = +dy), `scale` the screen height.
 */
export function aimFromDrag(dx: number, dy: number, scale: number): Aim {
  const power = Math.max(0, Math.min(1, dy / (scale * 0.26)));
  const side = Math.max(-1, Math.min(1, -dx / (scale * 0.18)));
  const x = Math.sign(side || 0.0001) * (MIN_SIDE + Math.abs(side) * (GOAL.halfWidth - 0.45 - MIN_SIDE));
  // a gentle pull goes low, a strong pull towards the top corner
  const y = 0.35 + power * (GOAL.height - 0.75);
  return { power, target: { x, y } };
}

export interface KeeperPlan {
  /** seconds after the kick when the keeper moves */
  reactAt: number;
  /** distance between the glove and the ball where it crosses the line (m) */
  miss: number;
  /** the glove touches the ball (Epic): the ball is deflected a little but goes in */
  touch: boolean;
  /** slow motion around the moment the ball passes the keeper */
  slowmo: { scale: number; from: number; to: number } | null;
  /** Icon: the time stops for a moment, the screen goes dark, rainbow */
  freeze: number;
  /** the colour of the effects */
  color: number;
  rainbow: boolean;
  label: string;
}

/** spec 3: the five rarities */
export function keeperPlan(rarity: Rarity): KeeperPlan {
  switch (rarity) {
    case 'rare':
      return { reactAt: 0.05, miss: 0.38, touch: false, slowmo: null, freeze: 0, color: 0x3aa0ff, rainbow: false, label: 'RARE' };
    case 'epic':
      return { reactAt: 0.04, miss: 0.045, touch: true, slowmo: { scale: 0.22, from: -0.12, to: 0.1 }, freeze: 0, color: 0xb45cff, rainbow: false, label: 'EPIC' };
    case 'legendary':
      return { reactAt: 0.0, miss: 0.13, touch: false, slowmo: { scale: 0.12, from: -0.16, to: 0.12 }, freeze: 0, color: 0xffc83a, rainbow: false, label: 'LEGENDARY' };
    case 'icon':
      return { reactAt: 0.0, miss: 0.16, touch: false, slowmo: { scale: 0.18, from: -0.1, to: 0.1 }, freeze: 1.15, color: 0xffffff, rainbow: true, label: 'ICON' };
    default:
      return { reactAt: 0.17, miss: 0.78, touch: false, slowmo: null, freeze: 0, color: 0xe8f0ff, rainbow: false, label: 'COMMON' };
  }
}

/** flight time to the goal line: a harder pull is a faster shot (about 23-31 m/s) */
export function flightTime(power: number): number {
  return 11 / (23 + 8 * power);
}
