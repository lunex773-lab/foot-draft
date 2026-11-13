import type { Formation, FormationId, FormationSlot, Position, Tactics } from '../types';

const BACK4: FormationSlot[] = [
  { id: 'GK', pos: 'GK', x: 50, y: 5 },
  { id: 'LB', pos: 'LB', x: 14, y: 26 },
  { id: 'CB1', pos: 'CB', x: 37, y: 21 },
  { id: 'CB2', pos: 'CB', x: 63, y: 21 },
  { id: 'RB', pos: 'RB', x: 86, y: 26 },
];

const BACK3: FormationSlot[] = [
  { id: 'GK', pos: 'GK', x: 50, y: 5 },
  { id: 'CB1', pos: 'CB', x: 27, y: 22 },
  { id: 'CB2', pos: 'CB', x: 50, y: 19 },
  { id: 'CB3', pos: 'CB', x: 73, y: 22 },
];

const s = (id: string, pos: Position, x: number, y: number): FormationSlot => ({ id, pos, x, y });

export const FORMATIONS: Record<FormationId, Formation> = {
  '4-3-3': {
    id: '4-3-3',
    slots: [...BACK4, s('CM1', 'CM', 30, 48), s('CDM', 'CDM', 50, 40), s('CM2', 'CM', 70, 48), s('LW', 'LW', 17, 75), s('ST', 'ST', 50, 83), s('RW', 'RW', 83, 75)],
  },
  '4-4-2': {
    id: '4-4-2',
    slots: [...BACK4, s('LM', 'LM', 14, 54), s('CM1', 'CM', 38, 47), s('CM2', 'CM', 62, 47), s('RM', 'RM', 86, 54), s('ST1', 'ST', 38, 80), s('ST2', 'ST', 62, 80)],
  },
  '4-2-3-1': {
    id: '4-2-3-1',
    slots: [...BACK4, s('CDM1', 'CDM', 38, 40), s('CDM2', 'CDM', 62, 40), s('LM', 'LM', 17, 65), s('CAM', 'CAM', 50, 62), s('RM', 'RM', 83, 65), s('ST', 'ST', 50, 85)],
  },
  '3-5-2': {
    id: '3-5-2',
    slots: [...BACK3, s('LM', 'LM', 11, 52), s('CDM1', 'CDM', 38, 41), s('CDM2', 'CDM', 62, 41), s('RM', 'RM', 89, 52), s('CAM', 'CAM', 50, 63), s('ST1', 'ST', 38, 83), s('ST2', 'ST', 62, 83)],
  },
  '3-4-3': {
    id: '3-4-3',
    slots: [...BACK3, s('LM', 'LM', 13, 52), s('CM1', 'CM', 38, 47), s('CM2', 'CM', 62, 47), s('RM', 'RM', 87, 52), s('LW', 'LW', 20, 77), s('ST', 'ST', 50, 83), s('RW', 'RW', 80, 77)],
  },
  '5-3-2': {
    id: '5-3-2',
    slots: [
      { id: 'GK', pos: 'GK', x: 50, y: 5 },
      s('LB', 'LB', 9, 33),
      s('CB1', 'CB', 30, 20),
      s('CB2', 'CB', 50, 18),
      s('CB3', 'CB', 70, 20),
      s('RB', 'RB', 91, 33),
      s('CM1', 'CM', 30, 50),
      s('CM2', 'CM', 50, 45),
      s('CM3', 'CM', 70, 50),
      s('ST1', 'ST', 38, 80),
      s('ST2', 'ST', 62, 80),
    ],
  },
  '4-1-4-1': {
    id: '4-1-4-1',
    slots: [...BACK4, s('CDM', 'CDM', 50, 38), s('LM', 'LM', 14, 58), s('CM1', 'CM', 38, 55), s('CM2', 'CM', 62, 55), s('RM', 'RM', 86, 58), s('ST', 'ST', 50, 83)],
  },
  '4-3-2-1': {
    id: '4-3-2-1',
    slots: [...BACK4, s('CM1', 'CM', 30, 46), s('CM2', 'CM', 50, 42), s('CM3', 'CM', 70, 46), s('CAM1', 'CAM', 36, 68), s('CAM2', 'CAM', 64, 68), s('ST', 'ST', 50, 85)],
  },
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

export const DEFAULT_TACTICS: Tactics = {
  offense: 'possession',
  defense: 'mid_block',
  attackSide: 'balanced',
  defensiveLine: 'normal',
  tempo: 'normal',
  passing: 'mixed',
  pressIntensity: 'normal',
  whenLosing: 'attack',
  whenWinning: 'keep',
};

export const TACTIC_LABELS_JA = {
  offense: { possession: 'ポゼッション', counter: 'カウンター', long_ball: 'ロングボール' },
  defense: { high_press: 'ハイプレス', mid_block: 'ミドルブロック', low_block: 'ローブロック' },
  attackSide: { balanced: 'バランス', left: '左サイド', center: '中央', right: '右サイド' },
  defensiveLine: { deep: '低い', normal: '標準', high: '高い' },
  tempo: { slow: '遅い', normal: '標準', fast: '速い' },
  passing: { short: 'ショート', mixed: 'ミックス', direct: 'ダイレクト' },
  pressIntensity: { low: '弱い', normal: '標準', high: '強い' },
  whenLosing: { keep: 'そのまま', attack: '攻撃的に' },
  whenWinning: { keep: 'そのまま', defend: '守備的に' },
} as const;

export const TACTIC_FIELD_LABELS_JA: Record<keyof Tactics, string> = {
  offense: '攻撃戦術',
  defense: '守備戦術',
  attackSide: '攻撃方向',
  defensiveLine: '守備ライン',
  tempo: 'テンポ',
  passing: 'パス傾向',
  pressIntensity: 'プレス強度',
  whenLosing: '負けている終盤',
  whenWinning: '勝っている終盤',
};

export function isValidTactics(t: unknown): t is Tactics {
  if (!t || typeof t !== 'object') return false;
  const o = t as Record<string, unknown>;
  for (const key of Object.keys(TACTIC_LABELS_JA) as (keyof Tactics)[]) {
    const allowed = Object.keys(TACTIC_LABELS_JA[key]);
    if (typeof o[key] !== 'string' || !allowed.includes(o[key] as string)) return false;
  }
  return true;
}
