export type Position =
  | 'GK'
  | 'CB'
  | 'LB'
  | 'RB'
  | 'LWB'
  | 'RWB'
  | 'CDM'
  | 'CM'
  | 'CAM'
  | 'LM'
  | 'RM'
  | 'LW'
  | 'RW'
  | 'CF'
  | 'ST';

export type PositionGroup = 'GK' | 'DF' | 'MF' | 'FW';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'icon';

/** SIM-only detailed attributes (spec 4-2). 1..99 */
export interface InternalAttributes {
  acceleration: number;
  sprintSpeed: number;
  shotAccuracy: number;
  shotPower: number;
  finishing: number;
  shortPassing: number;
  longPassing: number;
  vision: number;
  ballControl: number;
  dribbling: number;
  tackling: number;
  interception: number;
  positioning: number;
  stamina: number;
  strength: number;
  jumping: number;
  gkReflexes: number;
  gkHandling: number;
  gkPositioning: number;
}

export type AttributeKey = keyof InternalAttributes;

/** Displayed card stats (spec 4-1). 1..99 */
export interface DisplayStats {
  pac: number;
  sho: number;
  pas: number;
  dri: number;
  def: number;
  phy: number;
}

export type DisplayStatKey = keyof DisplayStats;

/** Special abilities of the player database v1 (spec 4-4). */
export type TraitId =
  | 'engine'
  | 'counter_runner'
  | 'sweeper_keeper'
  | 'cross_specialist'
  | 'press_resistant'
  | 'clinical_finisher'
  | 'leader'
  | 'long_shot'
  | 'aerial_threat'
  | 'ball_winner'
  | 'speedster'
  | 'playmaker';

export type RoleId =
  | 'keeper_classic'
  | 'keeper_libero'
  | 'stopper'
  | 'ball_playing_cb'
  | 'cover_cb'
  | 'fullback'
  | 'wingback'
  | 'anchor'
  | 'deep_playmaker'
  | 'box_to_box'
  | 'advanced_playmaker'
  | 'shadow_striker'
  | 'wide_midfielder'
  | 'winger'
  | 'inside_forward'
  | 'poacher'
  | 'target_man'
  | 'false_nine'
  | 'complete_forward';

export interface Player {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  nationality: string; // nation code
  leagueId: string;
  clubId: string;
  rarity: Rarity;
  primaryPosition: Position;
  /** primary first, then secondary positions */
  positions: Position[];
  ovr: number;
  /** play style used for chemistry (derived from attributes; not in the database) */
  role: RoleId;
  traits: TraitId[];
  /** SIM-only attributes (simulation_attributes.json) */
  attributes: InternalAttributes;
  /** displayed card stats (taken from the database as-is) */
  stats: DisplayStats;
  age: number;
  heightCm: number;
  /** card image path relative to the card asset base, e.g. "cards/FD-001.png" */
  cardAsset: string;
}

export type FormationId =
  | '4-3-3'
  | '4-4-2'
  | '4-2-3-1'
  | '3-5-2'
  | '3-4-3'
  | '5-3-2'
  | '4-1-4-1'
  | '4-3-2-1';

export interface FormationSlot {
  /** stable slot id inside the formation, e.g. "CB1" */
  id: string;
  pos: Position;
  /** pitch coordinates, x: 0 (left) .. 100 (right), y: 0 (own goal) .. 100 (opponent goal) */
  x: number;
  y: number;
}

export interface Formation {
  id: FormationId;
  slots: FormationSlot[];
}

export type OffenseStyle = 'possession' | 'counter' | 'long_ball';
export type DefenseStyle = 'high_press' | 'mid_block' | 'low_block';

export interface Tactics {
  offense: OffenseStyle;
  defense: DefenseStyle;
  attackSide: 'balanced' | 'left' | 'center' | 'right';
  defensiveLine: 'deep' | 'normal' | 'high';
  tempo: 'slow' | 'normal' | 'fast';
  passing: 'short' | 'mixed' | 'direct';
  pressIntensity: 'low' | 'normal' | 'high';
  /** late game plan (spec 6-5 終盤の戦術変更) */
  whenLosing: 'keep' | 'attack';
  whenWinning: 'keep' | 'defend';
}

export interface Lineup {
  formation: FormationId;
  /** player ids in formation slot order (11) */
  starters: string[];
  /** 3 substitutes */
  bench: string[];
  tactics: Tactics;
}
