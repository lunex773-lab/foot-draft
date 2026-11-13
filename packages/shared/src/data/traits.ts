import type { RoleId, TraitId } from '../types';

export interface TraitInfo {
  id: TraitId;
  name: string;
  nameJa: string;
  /** when / how the trait works in the simulation (spec 4-4: conditions must be explicit) */
  effectJa: string;
  gkOnly?: boolean;
}

export const TRAITS: Record<TraitId, TraitInfo> = {
  sniper: {
    id: 'sniper',
    name: 'Sniper',
    nameJa: 'スナイパー',
    effectJa: 'ペナルティエリア外からのシュートと直接FKのゴール期待値が1.5倍。ミドルシュートを選びやすくなる。',
  },
  playmaker: {
    id: 'playmaker',
    name: 'Playmaker',
    nameJa: 'プレーメーカー',
    effectJa: '出場中、中盤の前進成功率が上がる。本人のパスから生まれた決定機のゴール期待値が1.15倍。',
  },
  speedster: {
    id: 'speedster',
    name: 'Speedster',
    nameJa: 'スピードスター',
    effectJa: 'カウンター・裏への抜け出しの局面だけ、スピードに+8の補正。',
  },
  wall: {
    id: 'wall',
    name: 'Wall',
    nameJa: 'ウォール',
    effectJa: '自陣ゴール前で守備をしている時、守備力+4、シュートブロック率が上がる。',
  },
  aerial_king: {
    id: 'aerial_king',
    name: 'Aerial King',
    nameJa: 'エアリアルキング',
    effectJa: 'クロス・セットプレーの空中戦で+8。本人のヘディングシュートのゴール期待値が1.4倍。',
  },
  pressing_machine: {
    id: 'pressing_machine',
    name: 'Pressing Machine',
    nameJa: 'プレッシングマシン',
    effectJa: 'チームの守備戦術がハイプレスの時、プレス力+4、本人のスタミナ消費が15%減る。',
  },
  clutch: {
    id: 'clutch',
    name: 'Clutch',
    nameJa: 'クラッチ',
    effectJa: '75分以降、チームが同点か負けている時、決定力+10でシュートを任されやすくなる。',
  },
  sweeper_keeper: {
    id: 'sweeper_keeper',
    name: 'Sweeper Keeper',
    nameJa: 'スイーパーキーパー',
    effectJa: '相手のカウンター・裏への抜け出しの成功率を下げる（守備ラインが高いほど効果が大きい）。',
    gkOnly: true,
  },
  trickster: {
    id: 'trickster',
    name: 'Trickster',
    nameJa: 'トリックスター',
    effectJa: 'ドリブル突破の局面でドリブル+8。ファウルを受けやすい。',
  },
  engine: {
    id: 'engine',
    name: 'Engine',
    nameJa: 'エンジン',
    effectJa: 'スタミナの消費が25%減る。',
  },
  set_piece: {
    id: 'set_piece',
    name: 'Set-Piece Specialist',
    nameJa: 'セットプレー職人',
    effectJa: 'キッカーを担当し、直接FKのゴール期待値が1.6倍、CK・FKからの決定機の質が上がる。',
  },
  leader: {
    id: 'leader',
    name: 'Leader',
    nameJa: 'リーダー',
    effectJa: '出場中、チームのケミストリー+3。負けている時の終盤に全員の能力が少し下がりにくい。',
  },
  shot_stopper: {
    id: 'shot_stopper',
    name: 'Shot Stopper',
    nameJa: 'ショットストッパー',
    effectJa: '至近距離（ゴール期待値0.2以上）のシュートに対してセーブ力+6。',
    gkOnly: true,
  },
  commanding: {
    id: 'commanding',
    name: 'Commanding',
    nameJa: 'コマンディング',
    effectJa: 'クロス・セットプレーへの空中戦の守備+6。',
    gkOnly: true,
  },
};

export const OUTFIELD_TRAITS: TraitId[] = (Object.keys(TRAITS) as TraitId[]).filter((t) => !TRAITS[t].gkOnly);
export const GK_TRAITS: TraitId[] = ['sweeper_keeper', 'shot_stopper', 'commanding', 'leader'];

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
