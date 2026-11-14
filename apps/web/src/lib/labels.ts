import type { ChanceType, MatchEventType, TacticNote } from '@fd/shared';

export const EVENT_LABEL: Record<MatchEventType, string> = {
  kickoff: 'キックオフ',
  half_time: 'ハーフタイム',
  full_time: '試合終了',
  goal: 'ゴール',
  save: 'セーブ',
  miss: 'シュートは枠外',
  block: 'シュートブロック',
  corner: 'コーナーキック',
  free_kick: 'フリーキック',
  penalty: 'PK獲得',
  foul: 'ファウル',
  yellow: '警告',
  red: '退場',
  sub: '交代',
  tactic: '戦術変更',
  counter: 'カウンター',
  press_win: 'プレスでボール奪取',
};

export const CHANCE_LABEL: Record<ChanceType, string> = {
  through_ball: 'スルーパス',
  cutback: '折り返し',
  dribble: 'ドリブル突破',
  cross: 'クロス',
  long_shot: 'ミドルシュート',
  counter: 'カウンター',
  press_win: 'ショートカウンター',
  set_piece: 'セットプレー',
  direct_fk: '直接FK',
  penalty: 'PK',
  knock_down: 'ロングボールの落とし',
};

export function noteText(n: TacticNote): string {
  const v = n.values;
  switch (n.key) {
    case 'possession':
      return `ポゼッション：支配率 ${v.possession}%`;
    case 'press_wins':
      return `ハイプレス：相手陣でボール奪取 ${v.count}回`;
    case 'counters':
      return `カウンター：${v.count}回（シュート ${v.shots}本）`;
    case 'long_balls':
      return `ロングボール：成功 ${v.won} / ${v.total}`;
    case 'low_block':
      return `ローブロック：相手のシュート ${v.oppShots}本・xG ${v.oppXg}`;
    case 'chemistry':
      return `ケミストリー：${v.score}`;
    case 'subs':
      return `交代：${v.count}人`;
    case 'late_change':
      return `終盤に${v.mode === 'attack' ? '攻撃的' : '守備的'}な戦術へ切り替え`;
  }
}

export const ERROR_TEXT: Record<string, string> = {
  NOT_YOUR_TURN: 'あなたの指名順ではありません',
  ALREADY_PICKED: 'その選手は指名済みです',
  GK_LIMIT: 'GKは3人までしか指名できません',
  NOT_IN_POOL: 'その選手は候補にいません',
  DRAFT_FINISHED: 'ドラフトは終了しています',
  INVALID_STARTERS: 'スタメンは11人必要です',
  INVALID_BENCH: '控えは3人必要です',
  DUPLICATE_PLAYER: '同じ選手が重複しています',
  INVALID_TACTICS: '戦術の設定が正しくありません',
  INVALID_FORMATION: 'フォーメーションが正しくありません',
  ROOM_FULL: 'ルームが満員です',
  ROOM_NOT_JOINABLE: 'このルームには参加できません（ドラフト開始済み、または招待コードで参加できないモード）',
  FORMATION_LOCKED: 'この課題ではフォーメーションを変更できません',
  RESERVED: 'そのカードは別のプレイヤーの専用枠です',
  INSUFFICIENT_FUNDS: '残高が足りません',
  EVENT_CLOSED: 'このイベントは開催期間外です',
  NOT_FOUND: '見つかりません',
  FORBIDDEN: '権限がありません',
  CONFLICT: 'この操作は今は行えません',
  UNAUTHORIZED: 'ユーザー名またはパスワードが違います',
  RATE_LIMITED: '試行回数が多すぎます。しばらくしてから試してください',
};

export function errorText(code: string, fallback?: string) {
  return ERROR_TEXT[code] ?? fallback ?? code;
}

export function seatColor(seat: number): string {
  return ['#4fc3f7', '#ff8a65', '#aed581', '#ce93d8'][seat] ?? '#ccc';
}

export const MODE_LABEL: Record<string, string> = {
  quick: 'クイック',
  private: 'プライベート',
  ranked: 'ランク戦',
  solo: 'ソロ課題',
  event: 'イベント',
  collection: 'Collection Draft',
};

export function modeLabel(mode: string): string {
  return MODE_LABEL[mode] ?? mode;
}

/** official dates (gacha periods) are shown in Japan time */
export function formatJst(ms: number): string {
  return `${new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}（日本時間）`;
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
