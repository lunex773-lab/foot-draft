/**
 * Missions (spec 10, decision 40). Provisional definitions; progress is
 * counted on the server (league end, solo, gacha) and rewards are claimed.
 */
import { jstDateKey } from '../ranked';
import type { Currency } from './config';

export type MissionPeriod = 'daily' | 'weekly' | 'beginner';

export type MissionMetric =
  | 'league_completed'
  | 'match_won'
  | 'manual_pick'
  | 'league_won'
  | 'ranked_or_event_league'
  | 'ranked_league'
  | 'solo_attempt'
  | 'gacha_draw'
  | 'collection_draft_league';

export interface MissionDef {
  id: string;
  period: MissionPeriod;
  metric: MissionMetric;
  target: number;
  reward: { currency: Currency; amount: number };
  titleJa: string;
}

/** provisional: daily 300 COINS, weekly 1,500 COINS, beginner 300 FREE GEMS (spec 10-1, 10-2) */
export const MISSIONS: MissionDef[] = [
  { id: 'd-league', period: 'daily', metric: 'league_completed', target: 1, reward: { currency: 'COINS', amount: 100 }, titleJa: 'リーグを1回完走する' },
  { id: 'd-wins', period: 'daily', metric: 'match_won', target: 2, reward: { currency: 'COINS', amount: 100 }, titleJa: '試合で2勝する' },
  { id: 'd-picks', period: 'daily', metric: 'manual_pick', target: 10, reward: { currency: 'COINS', amount: 100 }, titleJa: 'ドラフトで自分で10回指名する' },
  { id: 'w-leagues', period: 'weekly', metric: 'league_completed', target: 10, reward: { currency: 'COINS', amount: 500 }, titleJa: 'リーグを10回完走する' },
  { id: 'w-firsts', period: 'weekly', metric: 'league_won', target: 3, reward: { currency: 'COINS', amount: 500 }, titleJa: 'リーグで3回1位になる' },
  { id: 'w-competitive', period: 'weekly', metric: 'ranked_or_event_league', target: 5, reward: { currency: 'COINS', amount: 500 }, titleJa: 'ランク戦かイベントに5回参加する' },
  { id: 'b-first-league', period: 'beginner', metric: 'league_completed', target: 1, reward: { currency: 'GEMS_FREE', amount: 50 }, titleJa: '初めてのリーグを完走する' },
  { id: 'b-first-win', period: 'beginner', metric: 'league_won', target: 1, reward: { currency: 'GEMS_FREE', amount: 50 }, titleJa: 'リーグで初めて1位になる' },
  { id: 'b-ranked', period: 'beginner', metric: 'ranked_league', target: 1, reward: { currency: 'GEMS_FREE', amount: 50 }, titleJa: 'ランク戦に参加する' },
  { id: 'b-solo', period: 'beginner', metric: 'solo_attempt', target: 1, reward: { currency: 'GEMS_FREE', amount: 50 }, titleJa: 'ソロ課題に挑戦する' },
  { id: 'b-gacha', period: 'beginner', metric: 'gacha_draw', target: 1, reward: { currency: 'GEMS_FREE', amount: 50 }, titleJa: 'ガシャを引く' },
  { id: 'b-collection', period: 'beginner', metric: 'collection_draft_league', target: 1, reward: { currency: 'GEMS_FREE', amount: 50 }, titleJa: 'Collection Draft で遊ぶ' },
];

export const MISSION_BY_ID: Record<string, MissionDef> = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));

const JST_MS = 9 * 60 * 60 * 1000;

/** Monday (Japan time) of the week containing `time`, e.g. "W2026-11-09" */
export function jstWeekKey(time: number): string {
  const d = new Date(time + JST_MS);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow));
  return `W${monday.toISOString().slice(0, 10)}`;
}

export function periodKey(period: MissionPeriod, time: number): string {
  if (period === 'daily') return jstDateKey(time);
  if (period === 'weekly') return jstWeekKey(time);
  return 'once';
}

/** progress increments from one finished league of a human player */
export function leagueMetrics(input: {
  mode: string;
  rank: number;
  matchWins: number;
  manualPicks: number;
}): Partial<Record<MissionMetric, number>> {
  const m: Partial<Record<MissionMetric, number>> = {
    league_completed: 1,
    match_won: input.matchWins,
    manual_pick: input.manualPicks,
    league_won: input.rank === 1 ? 1 : 0,
  };
  if (input.mode === 'ranked' || input.mode === 'event') m.ranked_or_event_league = 1;
  if (input.mode === 'ranked') m.ranked_league = 1;
  if (input.mode === 'collection') m.collection_draft_league = 1;
  if (input.mode === 'solo') m.solo_attempt = 1;
  return m;
}
