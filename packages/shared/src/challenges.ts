/**
 * Solo Challenge (spec 2-6): one daily challenge (Japan date), generated
 * deterministically from the date (decision 29). You + 3 CPU teams play the
 * usual draft and round-robin league; the challenge combines
 *   - a draft condition (candidate pool),
 *   - a special rule,
 *   - a goal.
 * Rewards are recorded only until currencies exist (Phase 4).
 */
import { FORMATION_IDS } from './data/formations';
import type { FixtureResult, StandingRow } from './league';
import type { PoolFilter } from './pool';
import { Rng } from './rng';
import type { FormationId } from './types';

export type ChallengeRule =
  | { type: 'none' }
  | { type: 'fixed_formation'; formation: FormationId }
  | { type: 'last_pick' }
  | { type: 'strong_cpu' };

export type ChallengeGoal =
  | { type: 'rank1' }
  | { type: 'unbeaten' }
  | { type: 'all_wins' }
  | { type: 'goals'; min: number }
  | { type: 'clean_sheets'; min: number };

export interface ChallengePool {
  id: string;
  labelJa: string;
  filter: PoolFilter | null;
}

export interface SoloChallenge {
  /** "daily-YYYY-MM-DD" */
  id: string;
  /** Japan date */
  dateKey: string;
  titleJa: string;
  pool: ChallengePool;
  rule: ChallengeRule;
  ruleJa: string;
  goal: ChallengeGoal;
  goalJa: string;
  /** 1 (easy) .. 3 (hard), for display */
  difficulty: 1 | 2 | 3;
}

/**
 * Draft conditions. Every condition is "pure": the target players alone can
 * fill the whole 84-player pool (checked by the unit tests).
 */
export const CHALLENGE_POOLS: readonly (ChallengePool & { weight: number; hard: number })[] = [
  { id: 'standard', labelJa: '通常の候補', filter: null, weight: 3, hard: 0 },
  { id: 'common_rare', labelJa: 'Common・Rare だけ', filter: { rarities: ['common', 'rare'] }, weight: 1, hard: 1 },
  { id: 'no_stars', labelJa: 'Legendary・Icon なし', filter: { rarities: ['common', 'rare', 'epic'] }, weight: 1, hard: 0 },
  { id: 'ovr80', labelJa: 'OVR 80 以下だけ', filter: { maxOvr: 80 }, weight: 1, hard: 0 },
  { id: 'veterans', labelJa: '26歳以上だけ', filter: { minAge: 26 }, weight: 1, hard: 0 },
  { id: 'ovr75', labelJa: 'OVR 75 以下だけ', filter: { maxOvr: 75 }, weight: 1, hard: 1 },
];

const RULES: readonly { rule: (rng: Rng) => ChallengeRule; weight: number; hard: number }[] = [
  { rule: () => ({ type: 'none' }), weight: 2, hard: 0 },
  { rule: (rng) => ({ type: 'fixed_formation', formation: rng.pick(FORMATION_IDS) }), weight: 2, hard: 1 },
  { rule: () => ({ type: 'last_pick' }), weight: 1, hard: 1 },
  { rule: () => ({ type: 'strong_cpu' }), weight: 1, hard: 1 },
];

const GOALS: readonly { goal: ChallengeGoal; weight: number; hard: number }[] = [
  { goal: { type: 'rank1' }, weight: 3, hard: 1 },
  { goal: { type: 'unbeaten' }, weight: 2, hard: 1 },
  { goal: { type: 'all_wins' }, weight: 1, hard: 2 },
  { goal: { type: 'goals', min: 7 }, weight: 2, hard: 1 },
  { goal: { type: 'clean_sheets', min: 2 }, weight: 1, hard: 1 },
];

export function ruleText(rule: ChallengeRule): string {
  switch (rule.type) {
    case 'none':
      return '特別ルールなし';
    case 'fixed_formation':
      return `フォーメーションは ${rule.formation} 固定`;
    case 'last_pick':
      return 'あなたの指名順は4番目（最後）';
    case 'strong_cpu':
      return 'CPUが本気（迷わず最善の選手を指名）';
  }
}

/** short label used in the title */
function ruleShort(rule: ChallengeRule): string | null {
  switch (rule.type) {
    case 'none':
      return null;
    case 'fixed_formation':
      return `${rule.formation}固定`;
    case 'last_pick':
      return '指名順4番目';
    case 'strong_cpu':
      return '本気のCPU';
  }
}

export function goalText(goal: ChallengeGoal): string {
  switch (goal.type) {
    case 'rank1':
      return 'リーグ1位';
    case 'unbeaten':
      return '3試合負けなし';
    case 'all_wins':
      return '3戦全勝';
    case 'goals':
      return `3試合で${goal.min}得点以上`;
    case 'clean_sheets':
      return `無失点の試合を${goal.min}試合以上`;
  }
}

export function dailyChallenge(dateKey: string): SoloChallenge {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error(`invalid date key: ${dateKey}`);
  const rng = new Rng(`solo-daily:${dateKey}`);
  const pool = rng.weighted(CHALLENGE_POOLS, CHALLENGE_POOLS.map((p) => p.weight));
  const r = rng.weighted(RULES, RULES.map((x) => x.weight));
  const rule = r.rule(rng.fork('rule'));
  const g = rng.weighted(GOALS, GOALS.map((x) => x.weight));
  const hard = pool.hard + r.hard + g.hard;
  const ruleJa = ruleText(rule);
  const goalJa = goalText(g.goal);
  const conditions = [pool.filter ? pool.labelJa : null, ruleShort(rule)].filter(Boolean).join('・');
  return {
    id: `daily-${dateKey}`,
    dateKey,
    titleJa: conditions ? `${conditions} ― ${goalJa}` : goalJa,
    pool: { id: pool.id, labelJa: pool.labelJa, filter: pool.filter },
    rule,
    ruleJa,
    goal: g.goal,
    goalJa,
    difficulty: hard <= 1 ? 1 : hard <= 3 ? 2 : 3,
  };
}

export interface TeamLeagueRecord {
  rank: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
  points: number;
}

export function teamRecord(seat: number, standings: readonly StandingRow[], results: readonly FixtureResult[]): TeamLeagueRecord {
  const row = standings.find((r) => r.seat === seat);
  let cleanSheets = 0;
  for (const r of results) {
    if (r.home === seat && r.awayGoals === 0) cleanSheets++;
    if (r.away === seat && r.homeGoals === 0) cleanSheets++;
  }
  return {
    rank: row?.rank ?? 0,
    played: row?.played ?? 0,
    won: row?.won ?? 0,
    drawn: row?.drawn ?? 0,
    lost: row?.lost ?? 0,
    goalsFor: row?.goalsFor ?? 0,
    goalsAgainst: row?.goalsAgainst ?? 0,
    cleanSheets,
    points: row?.points ?? 0,
  };
}

export function evaluateGoal(goal: ChallengeGoal, rec: TeamLeagueRecord): boolean {
  switch (goal.type) {
    case 'rank1':
      return rec.rank === 1;
    case 'unbeaten':
      return rec.played > 0 && rec.lost === 0;
    case 'all_wins':
      return rec.played > 0 && rec.won === rec.played;
    case 'goals':
      return rec.goalsFor >= goal.min;
    case 'clean_sheets':
      return rec.cleanSheets >= goal.min;
  }
}
