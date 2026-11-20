import type { RoleId, TraitId } from '../types';

export interface TraitInfo {
  id: TraitId;
  /** English name (the player database v1 uses these names) */
  name: string;
  nameJa: string;
  /** when / how the trait works in the simulation (spec 4-4: conditions must be explicit) */
  effectJa: string;
  /** only ICON cards have it (decision 120) */
  iconOnly?: boolean;
}

/**
 * The special abilities (decisions 118-120, docs/15-abilities-rarity-plan.md):
 * ICON cards have two (one ICON-only + one shared), EPIC / LEGENDARY one,
 * COMMON / RARE none. Every effect works only under its condition (spec 4-4).
 * The numbers are the ones of SIM_TRAITS in sim/engine.ts.
 */
export const TRAITS: Record<TraitId, TraitInfo> = {
  engine: { id: 'engine', name: 'Engine', nameJa: 'エンジン', effectJa: 'スタミナの消費が40%減る（全ポジション）。' },
  counter_runner: {
    id: 'counter_runner',
    name: 'Counter Runner',
    nameJa: 'カウンターランナー',
    effectJa: 'FW・MFとして出場中、ボールを奪った時にカウンターになりやすい（1人につき+15%、2人まで）。カウンターの攻撃+8（1人につき、2人まで）。',
  },
  sweeper_keeper: {
    id: 'sweeper_keeper',
    name: 'Sweeper Keeper',
    nameJa: 'スイーパーキーパー',
    effectJa: 'GKとして出場している時だけ発動。相手のカウンター・裏への抜け出しへの守備+7（守備ラインが高い時は+10）。',
  },
  cross_specialist: {
    id: 'cross_specialist',
    name: 'Cross Specialist',
    nameJa: 'クロススペシャリスト',
    effectJa: '左右の枠で出場中、そのサイドの攻撃でクロスを選ぶ確率+15%、本人のクロスからのシュートのゴール期待値1.35倍。出場中はCK・FKの空中戦+5。',
  },
  press_resistant: {
    id: 'press_resistant',
    name: 'Press Resistant',
    nameJa: 'プレス耐性',
    effectJa: 'DF・MFとして出場中、ビルドアップ+3（最大+6）、中盤の前進+2（最大+4）。',
  },
  clinical_finisher: {
    id: 'clinical_finisher',
    name: 'Clinical Finisher',
    nameJa: 'クリニカルフィニッシャー',
    effectJa: '本人がシュートを打つ時（ミドルシュート・ヘディング以外）、ゴール期待値が1.3倍。GKとして出場中は効果なし。',
  },
  leader: {
    id: 'leader',
    name: 'Leader',
    nameJa: 'リーダー',
    effectJa: '出場中、チームのケミストリー+5（2人まで）。70分以降に負けている時、味方全員の能力+3%。',
  },
  long_shot: {
    id: 'long_shot',
    name: 'Long Shot',
    nameJa: 'ロングシュート',
    effectJa: 'ペナルティエリア外からのシュートと直接FKのゴール期待値が1.8倍。ミドルシュートを任されやすい。GKとして出場中は効果なし。',
  },
  aerial_threat: {
    id: 'aerial_threat',
    name: 'Aerial Threat',
    nameJa: 'エアリアルスレット',
    effectJa: 'クロス・セットプレーの空中戦で+12（攻撃・守備とも）。本人のヘディングシュートのゴール期待値が1.6倍。',
  },
  ball_winner: {
    id: 'ball_winner',
    name: 'Ball Winner',
    nameJa: 'ボールウィナー',
    effectJa: 'DF・MFとして出場中、中盤の守備+3（最大+6）・プレス+2（最大+4）。タックル・インターセプトの記録に絡みやすい。',
  },
  speedster: {
    id: 'speedster',
    name: 'Speedster',
    nameJa: 'スピードスター',
    effectJa: 'カウンター・裏への抜け出しの局面だけ発動。FW・MFは攻撃+6（1人につき、2人まで）、DFは守備+5（1人につき、2人まで）。',
  },
  playmaker: {
    id: 'playmaker',
    name: 'Playmaker',
    nameJa: 'プレーメーカー',
    effectJa: 'MF・FWとして出場中、中盤の前進+3（1人につき、2人まで）。本人のパスから生まれたシュートのゴール期待値が1.3倍。',
  },
  shot_stopper: {
    id: 'shot_stopper',
    name: 'Shot Stopper',
    nameJa: 'シュートストッパー',
    effectJa: 'GKとして出場している時だけ発動。セーブ力+6、PKを決められる確率0.85倍。',
  },
  iron_wall: {
    id: 'iron_wall',
    name: 'Iron Wall',
    nameJa: '鉄壁',
    effectJa: 'DFの中央の枠で出場中、中央からの攻撃への守備+4（1人につき、2人まで）。',
  },
  man_marker: {
    id: 'man_marker',
    name: 'Man Marker',
    nameJa: 'マンマーカー',
    effectJa: 'DF・守備的MF（CDM）として出場中、相手のシュートのゴール期待値が0.93倍（1人につき、2人まで）。',
  },
  dribbler: {
    id: 'dribbler',
    name: 'Dribbler',
    nameJa: 'ドリブラー',
    effectJa: 'FW・MFとして出場中、本人のいるサイドの攻撃（チャンスメイク）+3、中央でドリブル突破を選ぶ確率+15%、本人のドリブル突破からのシュートのゴール期待値1.25倍。',
  },
  fox_in_box: {
    id: 'fox_in_box',
    name: 'Fox in the Box',
    nameJa: 'ゴール前の嗅覚',
    effectJa: 'FWとして出場中、ゴール前の決定機（スルーパス・折り返し・こぼれ球・高い位置での奪取）でシュートを打つ選手に選ばれやすい（1.6倍）、そのシュートのゴール期待値1.15倍。',
  },
  clutch: {
    id: 'clutch',
    name: 'Clutch',
    nameJa: '勝負強さ',
    effectJa: '75分以降に同点か負けている時、本人のシュートのゴール期待値が1.4倍。',
  },
  long_feed: {
    id: 'long_feed',
    name: 'Long Feed',
    nameJa: 'ロングフィード',
    effectJa: 'GK・DF・MFとして出場中、ロングボールの攻撃+5（1人まで）、ボールを奪った時のカウンター発生+5%（1人まで）。',
  },
  overlap: {
    id: 'overlap',
    name: 'Overlap',
    nameJa: 'オーバーラップ',
    effectJa: '左右のDFの枠で出場中、本人のサイドの攻撃（チャンスメイク）+3、本人のクロスがアシストになりやすい。',
  },
  legend_aura: {
    id: 'legend_aura',
    name: 'Legend Aura',
    nameJa: 'レジェンドオーラ',
    effectJa: '【ICON専用】出場中、味方全員（本人も）の能力+3%（チームに2人いても重ならない）。',
    iconOnly: true,
  },
  the_zone: {
    id: 'the_zone',
    name: 'The Zone',
    nameJa: 'ゾーン',
    effectJa: '【ICON専用】70分以降、本人の能力+10%、本人のシュートのゴール期待値1.4倍。',
    iconOnly: true,
  },
  fantasista: {
    id: 'fantasista',
    name: 'Fantasista',
    nameJa: 'ファンタジスタ',
    effectJa: '【ICON専用】出場中、本人のいるサイド（中央の選手は中央）の攻撃+5、本人のパスから生まれたシュートのゴール期待値1.35倍、中央でドリブル突破を選ぶ確率+20%。',
    iconOnly: true,
  },
  last_line: {
    id: 'last_line',
    name: 'Last Line',
    nameJa: 'ラストライン',
    effectJa: '【ICON専用】出場中、相手のすべてのシュートのゴール期待値が0.88倍（チームに2人いても重ならない）。',
    iconOnly: true,
  },
  inexhaustible: {
    id: 'inexhaustible',
    name: 'Inexhaustible',
    nameJa: '無尽蔵',
    effectJa: '【ICON専用】出場中、本人のスタミナが減らない。本人のいるサイドの攻撃+4・守備+4。',
    iconOnly: true,
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
