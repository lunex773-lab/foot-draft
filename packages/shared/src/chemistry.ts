import { FORMATIONS } from './data/formations';
import { positionFamiliarity } from './data/positions';
import type { DefenseStyle, FormationId, OffenseStyle, Player, RoleId, Tactics } from './types';

/**
 * Team chemistry (spec 5-5).
 * Based on play styles / roles, position fit and tactic fit.
 * Nationality / club links are intentionally NOT used.
 */

type Pair = [RoleId, RoleId, number];

/** Synergy between two roles when they play near each other. */
const ROLE_SYNERGY: Pair[] = [
  ['advanced_playmaker', 'poacher', 3],
  ['advanced_playmaker', 'complete_forward', 2],
  ['advanced_playmaker', 'inside_forward', 2],
  ['deep_playmaker', 'box_to_box', 3],
  ['anchor', 'box_to_box', 2],
  ['anchor', 'advanced_playmaker', 2],
  ['anchor', 'deep_playmaker', 2],
  ['target_man', 'winger', 3],
  ['target_man', 'wide_midfielder', 3],
  ['target_man', 'shadow_striker', 2],
  ['false_nine', 'inside_forward', 3],
  ['false_nine', 'shadow_striker', 1],
  ['wingback', 'inside_forward', 3],
  ['wingback', 'false_nine', 1],
  ['fullback', 'winger', 2],
  ['fullback', 'wide_midfielder', 2],
  ['ball_playing_cb', 'deep_playmaker', 2],
  ['ball_playing_cb', 'keeper_libero', 2],
  ['stopper', 'cover_cb', 3],
  ['stopper', 'ball_playing_cb', 1],
  ['cover_cb', 'keeper_libero', 2],
  ['poacher', 'complete_forward', 1],
  ['poacher', 'target_man', 2],
  // conflicts
  ['advanced_playmaker', 'advanced_playmaker', -3],
  ['target_man', 'target_man', -2],
  ['deep_playmaker', 'deep_playmaker', -2],
  ['false_nine', 'false_nine', -3],
  ['poacher', 'poacher', -1],
  ['wingback', 'wingback', 0],
];

const SYNERGY = new Map<string, number>();
for (const [a, b, v] of ROLE_SYNERGY) {
  SYNERGY.set(`${a}|${b}`, v);
  SYNERGY.set(`${b}|${a}`, v);
}

export function roleSynergy(a: RoleId, b: RoleId): number {
  return SYNERGY.get(`${a}|${b}`) ?? 0;
}

const OFFENSE_FIT: Record<OffenseStyle, Partial<Record<RoleId, number>>> = {
  possession: { deep_playmaker: 2, advanced_playmaker: 2, ball_playing_cb: 1.5, false_nine: 2, keeper_libero: 1.5, wingback: 1, target_man: -2, stopper: -0.5 },
  counter: { inside_forward: 2, poacher: 2, winger: 1.5, box_to_box: 1, cover_cb: 1, complete_forward: 1, deep_playmaker: -0.5, false_nine: -1 },
  long_ball: { target_man: 3, stopper: 1, wide_midfielder: 1, keeper_classic: 1, complete_forward: 1, false_nine: -2, advanced_playmaker: -1 },
};

const DEFENSE_FIT: Record<DefenseStyle, Partial<Record<RoleId, number>>> = {
  high_press: { box_to_box: 2, complete_forward: 1.5, cover_cb: 1.5, keeper_libero: 1.5, wingback: 1, anchor: -0.5, stopper: -1, keeper_classic: -1 },
  mid_block: { box_to_box: 0.5, anchor: 0.5, fullback: 0.5 },
  low_block: { anchor: 2, stopper: 2, fullback: 1.5, keeper_classic: 1.5, wingback: -1, cover_cb: -0.5 },
};

export interface ChemistryResult {
  /** 0..100 */
  score: number;
  positionFit: number;
  links: number;
  tacticFit: number;
  balance: number;
  /** per starter 0..10 */
  perPlayer: number[];
  /** SIM multiplier (spec 6-3) */
  modifier: number;
}

/**
 * @param starters players in formation slot order (11, may include undefined for empty slots)
 */
export function computeChemistry(starters: readonly (Player | undefined)[], formation: FormationId, tactics: Tactics): ChemistryResult {
  const slots = FORMATIONS[formation].slots;
  const perPlayer = new Array<number>(slots.length).fill(0);

  // 1. position fit (0..40)
  let fitSum = 0;
  slots.forEach((slot, i) => {
    const p = starters[i];
    if (!p) return;
    const fam = positionFamiliarity(p.positions, slot.pos);
    fitSum += fam;
    perPlayer[i] += fam >= 1 ? 4 : fam >= 0.93 ? 2.5 : fam >= 0.88 ? 1 : 0;
  });
  const positionFit = (Math.max(0, fitSum - slots.length * 0.8) / (slots.length * 0.2)) * 40;

  // 2. links between neighbouring players (0..25)
  let linkSum = 0;
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = starters[i];
      const b = starters[j];
      if (!a || !b) continue;
      const dx = slots[i].x - slots[j].x;
      const dy = slots[i].y - slots[j].y;
      if (Math.sqrt(dx * dx + dy * dy) > 34) continue;
      const v = roleSynergy(a.role, b.role);
      linkSum += v;
      perPlayer[i] += v * 0.5;
      perPlayer[j] += v * 0.5;
    }
  }
  const links = Math.max(0, Math.min(25, 10 + linkSum * 1.2));

  // 3. tactic fit (0..25)
  let tacticSum = 0;
  starters.forEach((p, i) => {
    if (!p) return;
    const v = (OFFENSE_FIT[tactics.offense][p.role] ?? 0) + (DEFENSE_FIT[tactics.defense][p.role] ?? 0);
    tacticSum += v;
    perPlayer[i] += v * 0.6;
  });
  const tacticFit = Math.max(0, Math.min(25, 10 + tacticSum * 1.1));

  // 4. balance (0..10): needs a defensive midfielder, not too many forwards
  const roles = starters.filter(Boolean).map((p) => (p as Player).role);
  let balance = 10;
  const defensiveMids = roles.filter((r) => r === 'anchor' || r === 'box_to_box' || r === 'deep_playmaker').length;
  if (defensiveMids === 0) balance -= 5;
  const pureAttackers = roles.filter((r) => ['poacher', 'target_man', 'inside_forward', 'winger', 'shadow_striker', 'false_nine', 'complete_forward'].includes(r)).length;
  if (pureAttackers > 5) balance -= (pureAttackers - 5) * 2;
  const leaders = starters.filter((p) => p?.traits.includes('leader')).length;
  balance = Math.max(0, balance) + Math.min(leaders, 2) * 3;

  const score = Math.round(Math.max(0, Math.min(100, positionFit + links + tacticFit + balance)));
  return {
    score,
    positionFit: Math.round(positionFit),
    links: Math.round(links),
    tacticFit: Math.round(tacticFit),
    balance: Math.round(balance),
    perPlayer: perPlayer.map((v) => Math.max(0, Math.min(10, Math.round(v + 3)))),
    modifier: 0.94 + 0.12 * (score / 100),
  };
}
