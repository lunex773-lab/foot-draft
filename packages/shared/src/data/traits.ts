import type { RoleId, TraitId } from '../types';

export interface TraitInfo {
  id: TraitId;
  /** name used in the player database */
  name: string;
  nameJa: string;
  /** when / how the trait works in the simulation (spec 4-4: conditions must be explicit) */
  effectJa: string;
}

/**
 * The 12 special abilities of the player database v1. The database assigns
 * them as-is; a trait whose condition does not apply to the player's slot
 * simply never activates (e.g. Sweeper Keeper on an outfield player).
 */
export const TRAITS: Record<TraitId, TraitInfo> = {
  engine: { id: 'engine', name: 'Engine', nameJa: 'エンジン', effectJa: 'スタミナの消費が25%減る（全ポジション）。' },
  counter_runner: {
    id: 'counter_runner',
    name: 'Counter Runner',
    nameJa: 'カウンターランナー',
    effectJa: 'FW・MFとして出場中、ボールを奪った時にカウンターになりやすい（1人につき+8%、2人まで）。カウンターの局面でスピード+5。',
  },
  sweeper_keeper: {
    id: 'sweeper_keeper',
    name: 'Sweeper Keeper',
    nameJa: 'スイーパーキーパー',
    effectJa: 'GKとして出場している時だけ発動。相手のカウンター・裏への抜け出しの成功率を下げる（守備ラインが高いほど効果が大きい）。GK以外では効果なし。',
  },
  cross_specialist: {
    id: 'cross_specialist',
    name: 'Cross Specialist',
    nameJa: 'クロススペシャリスト',
    effectJa: 'サイド（左右の枠）で出場中、そのサイドの攻撃でクロスを選びやすくなり、本人のクロスからの決定機のゴール期待値が1.2倍。出場中はCK・FKの質+3。',
  },
  press_resistant: {
    id: 'press_resistant',
    name: 'Press Resistant',
    nameJa: 'プレス耐性',
    effectJa: 'DF・MFとして出場中、相手のプレスを受けるビルドアップで保持力+2（最大+4）、中盤の前進+1（最大+2）。',
  },
  clinical_finisher: {
    id: 'clinical_finisher',
    name: 'Clinical Finisher',
    nameJa: 'クリニカルフィニッシャー',
    effectJa: '本人がシュートを打つ時（ミドルシュート・ヘディング以外）、ゴール期待値が1.15倍。GKとして出場中は効果なし。',
  },
  leader: {
    id: 'leader',
    name: 'Leader',
    nameJa: 'リーダー',
    effectJa: '出場中、チームのケミストリー+3（2人まで）。負けている時の終盤に全員の能力が少し下がりにくい。',
  },
  long_shot: {
    id: 'long_shot',
    name: 'Long Shot',
    nameJa: 'ロングシュート',
    effectJa: 'ペナルティエリア外からのシュートと直接FKのゴール期待値が1.5倍。ミドルシュートを任されやすい。GKとして出場中は効果なし。',
  },
  aerial_threat: {
    id: 'aerial_threat',
    name: 'Aerial Threat',
    nameJa: 'エアリアルスレット',
    effectJa: 'クロス・セットプレーの空中戦で+8（攻撃・守備とも）。本人のヘディングシュートのゴール期待値が1.4倍。',
  },
  ball_winner: {
    id: 'ball_winner',
    name: 'Ball Winner',
    nameJa: 'ボールウィナー',
    effectJa: 'DF・MFとして出場中、中盤の守備+2（最大+4）・プレス+1（最大+3）。タックル・インターセプトの記録に絡みやすい。',
  },
  speedster: { id: 'speedster', name: 'Speedster', nameJa: 'スピードスター', effectJa: 'カウンター・裏への抜け出しの局面だけ、スピードに+8の補正（2人まで）。' },
  playmaker: {
    id: 'playmaker',
    name: 'Playmaker',
    nameJa: 'プレーメーカー',
    effectJa: 'MF・FWとして出場中、中盤の前進成功率が上がる（+2、2人まで）。本人のパスから生まれた決定機のゴール期待値が1.15倍。',
  },
};

export const TRAIT_IDS = Object.keys(TRAITS) as TraitId[];

/** "Counter Runner" -> "counter_runner" */
export const TRAIT_BY_NAME: Record<string, TraitId> = Object.fromEntries(TRAIT_IDS.map((t) => [TRAITS[t].name, t]));

export interface RoleInfo {
  id: RoleId;
  name: string;
  nameJa: string;
  descriptionJa: string;
}

export const ROLES: Record<RoleId, RoleInfo> = {
  keeper_classic: { id: 'keeper_classic', name: 'Classic Keeper', nameJa: 'クラシックキーパー', descriptionJa: 'ゴールマウスを守るタイプ。低い守備ラインと相性が良い。' },
  keeper_libero: { id: 'keeper_libero', name: 'Libero Keeper', nameJa: 'リベロキーパー', descriptionJa: '足元がうまく前に出るタイプ。ポゼッション・高いラインと相性が良い。' },
  stopper: { id: 'stopper', name: 'Stopper', nameJa: 'ストッパー', descriptionJa: '対人と空中戦に強いCB。' },
  ball_playing_cb: { id: 'ball_playing_cb', name: 'Ball-Playing Defender', nameJa: 'ビルドアップCB', descriptionJa: '後方から組み立てるCB。' },
  cover_cb: { id: 'cover_cb', name: 'Cover Defender', nameJa: 'カバーリングCB', descriptionJa: 'スピードで背後をカバーするCB。' },
  fullback: { id: 'fullback', name: 'Full-Back', nameJa: 'フルバック', descriptionJa: '守備重視のサイドバック。' },
  wingback: { id: 'wingback', name: 'Wing-Back', nameJa: 'ウイングバック', descriptionJa: '攻撃参加の多いサイドバック。' },
  anchor: { id: 'anchor', name: 'Anchor', nameJa: 'アンカー', descriptionJa: '中盤の底で守備を固める。' },
  deep_playmaker: { id: 'deep_playmaker', name: 'Deep-Lying Playmaker', nameJa: 'レジスタ', descriptionJa: '中盤の底からゲームを作る。' },
  box_to_box: { id: 'box_to_box', name: 'Box-to-Box', nameJa: 'ボックス・トゥ・ボックス', descriptionJa: '攻守に走り回る。' },
  advanced_playmaker: { id: 'advanced_playmaker', name: 'Advanced Playmaker', nameJa: '司令塔', descriptionJa: '前線にラストパスを送る。' },
  shadow_striker: { id: 'shadow_striker', name: 'Shadow Striker', nameJa: 'シャドーストライカー', descriptionJa: '2列目から得点を狙う。' },
  wide_midfielder: { id: 'wide_midfielder', name: 'Wide Midfielder', nameJa: 'ワイドMF', descriptionJa: 'サイドで攻守にバランスを取る。クロスが得意。' },
  winger: { id: 'winger', name: 'Winger', nameJa: 'ウインガー', descriptionJa: '縦に突破してクロスを上げる。' },
  inside_forward: { id: 'inside_forward', name: 'Inside Forward', nameJa: 'インサイドフォワード', descriptionJa: '中に切り込んでシュートを狙う。' },
  poacher: { id: 'poacher', name: 'Poacher', nameJa: 'ポーチャー', descriptionJa: 'ゴール前で仕留める点取り屋。' },
  target_man: { id: 'target_man', name: 'Target Man', nameJa: 'ターゲットマン', descriptionJa: '前線でボールを収め、空中戦に強い。' },
  false_nine: { id: 'false_nine', name: 'False Nine', nameJa: 'フォルスナイン', descriptionJa: '下がってボールを受け、組み立てに加わる。' },
  complete_forward: { id: 'complete_forward', name: 'Complete Forward', nameJa: 'コンプリートFW', descriptionJa: '何でもこなす万能型FW。' },
};
