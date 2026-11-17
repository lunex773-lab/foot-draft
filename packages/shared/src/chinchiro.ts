/**
 * チンチロ (official spec "MATCH / DRAFT MATCH v2.0" 3): decides the draft
 * order of DRAFT MATCH. The server rolls every die (crypto randomness); the
 * client only animates the result.
 *
 *  - 3 dice, every player at the same time, up to 3 throws per round
 *  - a throw with a hand ends the player's turn
 *  - ピンゾロ > シゴロ > other ゾロ目 > 通常役 > ヒフミ > 役なし
 *  - the same hand compares the remaining die (通常役) or the number (ゾロ目)
 *  - completely equal results play again (再勝負) among those players
 *  - no hand after the last throw = last place (役なし)
 */
import type { RandomSource } from './economy/gacha';

export type Dice = [number, number, number];

export type HandKind = 'pinzoro' | 'shigoro' | 'zorome' | 'normal' | 'hifumi' | 'none';

export interface Hand {
  kind: HandKind;
  /** ゾロ目: the number, 通常役: the remaining die (出目), otherwise 0 */
  value: number;
  /** higher is better; equal strength = the same result (re-match) */
  strength: number;
  labelJa: string;
}

export const CHINCHIRO_CONFIG = {
  dice: 3,
  /** throws per round until a hand appears */
  maxThrows: 3,
  /** seconds to tap 振る (then the server throws automatically) */
  throwSeconds: 10,
  /** time the client gets to animate a throw before the next one starts */
  revealMs: 4500,
} as const;

const HAND_BASE: Record<HandKind, number> = { pinzoro: 600, shigoro: 500, zorome: 400, normal: 300, hifumi: 100, none: 0 };

export const HAND_LABEL_JA: Record<HandKind, string> = {
  pinzoro: 'ピンゾロ',
  shigoro: 'シゴロ',
  zorome: 'ゾロ目',
  normal: '通常役',
  hifumi: 'ヒフミ',
  none: '役なし',
};

export function evaluateHand(dice: readonly number[]): Hand {
  if (dice.length !== 3 || dice.some((d) => !Number.isInteger(d) || d < 1 || d > 6)) throw new Error('three dice of 1-6 expected');
  const [a, b, c] = [...dice].sort((x, y) => x - y);
  const hand = (kind: HandKind, value = 0, labelJa = HAND_LABEL_JA[kind]): Hand => ({ kind, value, strength: HAND_BASE[kind] + value, labelJa });
  if (a === b && b === c) return a === 1 ? hand('pinzoro') : hand('zorome', a, `ゾロ目（${a}）`);
  if (a === 4 && b === 5 && c === 6) return hand('shigoro');
  if (a === 1 && b === 2 && c === 3) return hand('hifumi');
  if (a === b) return hand('normal', c, `${c}の目`);
  if (b === c) return hand('normal', a, `${a}の目`);
  return hand('none');
}

export function rollDice(rnd: RandomSource): Dice {
  return [rnd.int(6) + 1, rnd.int(6) + 1, rnd.int(6) + 1];
}

/** a player's turn in a round ends with the first hand or after the last throw */
export function turnFinished(throws: readonly Dice[]): boolean {
  return throws.length >= CHINCHIRO_CONFIG.maxThrows || (throws.length > 0 && evaluateHand(throws[throws.length - 1]).kind !== 'none');
}

/** the result of a player's turn (the last throw; 役なし when no hand appeared) */
export function turnResult(throws: readonly Dice[]): Hand {
  return throws.length ? evaluateHand(throws[throws.length - 1]) : { kind: 'none', value: 0, strength: 0, labelJa: HAND_LABEL_JA.none };
}

/**
 * Orders the players of a finished round: groups from best to worst; a group
 * with more than one player had exactly the same result and plays again.
 */
export function splitByResult<T extends string | number>(players: readonly T[], resultOf: (p: T) => Hand): T[][] {
  const byStrength = new Map<number, T[]>();
  for (const p of players) {
    const s = resultOf(p).strength;
    byStrength.set(s, [...(byStrength.get(s) ?? []), p]);
  }
  return [...byStrength.entries()].sort((x, y) => y[0] - x[0]).map(([, ps]) => ps);
}

/**
 * The order after all rounds: `groups` is the current list of groups (best
 * first); a group of one is decided. Returns the next group that needs a
 * (re-)match, or null when the order is complete.
 */
export function nextTieGroup<T>(groups: readonly T[][]): T[] | null {
  return groups.find((g) => g.length > 1) ?? null;
}

/** replaces a tied group by its ordered sub-groups after its re-match */
export function resolveGroup<T>(groups: readonly T[][], tied: readonly T[], ordered: T[][]): T[][] {
  const i = groups.findIndex((g) => g.length === tied.length && g.every((x) => tied.includes(x)));
  if (i < 0) throw new Error('unknown group');
  return [...groups.slice(0, i), ...ordered, ...groups.slice(i + 1)];
}
