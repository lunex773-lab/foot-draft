import type { AttributeKey, Position, RoleId, TraitId } from '../types';

/**
 * Archetype = role (play style) + attribute shape.
 * Offsets are relative to the player's target OVR.
 */
export interface Archetype {
  role: RoleId;
  offsets: Partial<Record<AttributeKey, number>>;
  traits: Partial<Record<TraitId, number>>;
}

const NO_DEF = { tackling: -32, interception: -30 };

export const ARCHETYPES: Record<RoleId, Archetype> = {
  keeper_classic: {
    role: 'keeper_classic',
    offsets: { gkReflexes: 5, gkHandling: 5, gkPositioning: 4, jumping: -12, strength: -14, longPassing: -24, shortPassing: -28, acceleration: -26, sprintSpeed: -32, stamina: -30 },
    traits: { shot_stopper: 5, commanding: 4, leader: 2, sweeper_keeper: 1 },
  },
  keeper_libero: {
    role: 'keeper_libero',
    offsets: { gkReflexes: 3, gkHandling: 2, gkPositioning: 5, shortPassing: -16, longPassing: -12, acceleration: -20, sprintSpeed: -26, ballControl: -24, vision: -24, jumping: -14, strength: -16, stamina: -30 },
    traits: { sweeper_keeper: 6, shot_stopper: 2, leader: 2, commanding: 1 },
  },
  stopper: {
    role: 'stopper',
    offsets: { tackling: 6, interception: 4, strength: 8, jumping: 8, sprintSpeed: -8, acceleration: -10, shortPassing: -10, longPassing: -10, ballControl: -12, vision: -18, dribbling: -22, finishing: -30, shotAccuracy: -28, shotPower: -14, positioning: -25, stamina: -4 },
    traits: { wall: 5, aerial_king: 5, leader: 2, pressing_machine: 1 },
  },
  ball_playing_cb: {
    role: 'ball_playing_cb',
    offsets: { tackling: 4, interception: 6, strength: 0, jumping: 2, shortPassing: 2, longPassing: 4, ballControl: -2, vision: -6, sprintSpeed: -8, acceleration: -8, dribbling: -14, finishing: -30, shotAccuracy: -26, shotPower: -12, positioning: -25, stamina: -4 },
    traits: { wall: 4, playmaker: 2, leader: 3, aerial_king: 2, set_piece: 1 },
  },
  cover_cb: {
    role: 'cover_cb',
    offsets: { tackling: 4, interception: 6, sprintSpeed: 6, acceleration: 4, strength: -2, jumping: -2, shortPassing: -8, longPassing: -10, ballControl: -10, vision: -18, dribbling: -16, finishing: -30, shotAccuracy: -28, shotPower: -15, positioning: -25, stamina: 0 },
    traits: { speedster: 4, wall: 4, pressing_machine: 2, leader: 1 },
  },
  fullback: {
    role: 'fullback',
    offsets: { tackling: 5, interception: 5, sprintSpeed: 2, acceleration: 2, stamina: 4, strength: 0, shortPassing: -4, longPassing: -6, ballControl: -6, dribbling: -8, vision: -14, jumping: -6, finishing: -28, shotAccuracy: -24, shotPower: -14, positioning: -22 },
    traits: { wall: 3, pressing_machine: 3, engine: 3, speedster: 2 },
  },
  wingback: {
    role: 'wingback',
    offsets: { sprintSpeed: 7, acceleration: 7, stamina: 8, tackling: -2, interception: -2, shortPassing: 0, longPassing: 0, dribbling: 0, ballControl: -2, vision: -8, strength: -8, jumping: -10, finishing: -22, shotAccuracy: -18, shotPower: -12, positioning: -14 },
    traits: { engine: 4, speedster: 4, pressing_machine: 2, trickster: 1, set_piece: 1 },
  },
  anchor: {
    role: 'anchor',
    offsets: { interception: 7, tackling: 7, strength: 6, stamina: 4, jumping: 2, shortPassing: -2, longPassing: -4, ballControl: -4, vision: -6, dribbling: -12, acceleration: -10, sprintSpeed: -10, finishing: -24, shotAccuracy: -20, shotPower: -4, positioning: -18 },
    traits: { wall: 5, pressing_machine: 4, leader: 3, engine: 2, aerial_king: 1 },
  },
  deep_playmaker: {
    role: 'deep_playmaker',
    offsets: { shortPassing: 7, longPassing: 7, vision: 6, ballControl: 3, interception: 0, tackling: -3, strength: -6, stamina: 0, dribbling: -4, acceleration: -10, sprintSpeed: -12, finishing: -18, shotAccuracy: -10, shotPower: -4, positioning: -14, jumping: -10 },
    traits: { playmaker: 6, set_piece: 4, sniper: 2, leader: 2 },
  },
  box_to_box: {
    role: 'box_to_box',
    offsets: { stamina: 8, shortPassing: 2, ballControl: 2, tackling: 2, interception: 2, strength: 2, longPassing: -2, vision: -2, dribbling: -2, acceleration: -2, sprintSpeed: -2, finishing: -10, shotAccuracy: -8, shotPower: 2, positioning: -6, jumping: -6 },
    traits: { engine: 5, pressing_machine: 4, sniper: 2, clutch: 2, leader: 1 },
  },
  advanced_playmaker: {
    role: 'advanced_playmaker',
    offsets: { vision: 8, shortPassing: 7, ballControl: 6, dribbling: 4, longPassing: 2, finishing: -6, shotAccuracy: -4, positioning: -2, acceleration: -4, sprintSpeed: -6, shotPower: -6, ...NO_DEF, strength: -16, stamina: -8, jumping: -20 },
    traits: { playmaker: 6, trickster: 3, set_piece: 3, sniper: 2 },
  },
  shadow_striker: {
    role: 'shadow_striker',
    offsets: { finishing: 4, positioning: 6, ballControl: 4, dribbling: 4, shotAccuracy: 4, vision: 0, shortPassing: 0, acceleration: 0, sprintSpeed: -2, shotPower: 0, longPassing: -8, ...NO_DEF, strength: -12, stamina: -6, jumping: -16 },
    traits: { sniper: 4, clutch: 4, trickster: 2, playmaker: 1 },
  },
  wide_midfielder: {
    role: 'wide_midfielder',
    offsets: { stamina: 6, shortPassing: 4, longPassing: 4, ballControl: 3, dribbling: 2, vision: 2, acceleration: 2, sprintSpeed: 2, positioning: 0, finishing: -10, shotAccuracy: -8, shotPower: -6, tackling: -10, interception: -8, strength: -10, jumping: -14 },
    traits: { engine: 4, set_piece: 3, playmaker: 2, speedster: 2 },
  },
  winger: {
    role: 'winger',
    offsets: { acceleration: 8, sprintSpeed: 8, dribbling: 7, ballControl: 3, shortPassing: -2, longPassing: -2, vision: -4, finishing: -6, shotAccuracy: -6, shotPower: -8, positioning: -4, stamina: 0, ...NO_DEF, strength: -16, jumping: -18 },
    traits: { speedster: 6, trickster: 5, clutch: 1 },
  },
  inside_forward: {
    role: 'inside_forward',
    offsets: { finishing: 3, shotAccuracy: 4, dribbling: 6, ballControl: 4, acceleration: 5, sprintSpeed: 4, positioning: 2, shotPower: 0, shortPassing: -4, vision: -4, longPassing: -10, stamina: -4, tackling: -34, interception: -30, strength: -14, jumping: -16 },
    traits: { trickster: 4, sniper: 4, speedster: 3, clutch: 3 },
  },
  poacher: {
    role: 'poacher',
    offsets: { finishing: 8, positioning: 8, shotAccuracy: 4, acceleration: 2, sprintSpeed: 0, shotPower: 0, ballControl: -2, dribbling: -4, strength: -6, jumping: -6, shortPassing: -12, longPassing: -22, vision: -14, stamina: -10, tackling: -36, interception: -34 },
    traits: { clutch: 5, speedster: 3, sniper: 1, aerial_king: 1 },
  },
  target_man: {
    role: 'target_man',
    offsets: { strength: 10, jumping: 10, finishing: 4, positioning: 4, shotPower: 4, shotAccuracy: 0, ballControl: -2, dribbling: -10, acceleration: -10, sprintSpeed: -10, shortPassing: -8, vision: -12, longPassing: -18, stamina: -6, tackling: -30, interception: -32 },
    traits: { aerial_king: 7, clutch: 2, leader: 2 },
  },
  false_nine: {
    role: 'false_nine',
    offsets: { ballControl: 6, shortPassing: 4, vision: 4, dribbling: 4, finishing: 2, positioning: 2, shotAccuracy: 0, acceleration: 0, sprintSpeed: -2, shotPower: -4, longPassing: -6, strength: -8, jumping: -12, stamina: -4, tackling: -32, interception: -30 },
    traits: { playmaker: 4, trickster: 4, sniper: 2, clutch: 1 },
  },
  complete_forward: {
    role: 'complete_forward',
    offsets: { finishing: 4, positioning: 4, shotPower: 4, shotAccuracy: 3, strength: 3, ballControl: 2, dribbling: 2, acceleration: 2, sprintSpeed: 2, jumping: 0, shortPassing: -4, vision: -6, longPassing: -12, stamina: -2, tackling: -30, interception: -30 },
    traits: { clutch: 3, sniper: 3, aerial_king: 2, pressing_machine: 2, speedster: 1 },
  },
};

export const POSITION_ARCHETYPES: Record<Position, [RoleId, number][]> = {
  GK: [
    ['keeper_classic', 0.6],
    ['keeper_libero', 0.4],
  ],
  CB: [
    ['stopper', 0.4],
    ['ball_playing_cb', 0.35],
    ['cover_cb', 0.25],
  ],
  LB: [
    ['fullback', 0.5],
    ['wingback', 0.5],
  ],
  RB: [
    ['fullback', 0.5],
    ['wingback', 0.5],
  ],
  CDM: [
    ['anchor', 0.6],
    ['deep_playmaker', 0.4],
  ],
  CM: [
    ['box_to_box', 0.55],
    ['deep_playmaker', 0.45],
  ],
  CAM: [
    ['advanced_playmaker', 0.55],
    ['shadow_striker', 0.45],
  ],
  LM: [
    ['wide_midfielder', 0.55],
    ['winger', 0.45],
  ],
  RM: [
    ['wide_midfielder', 0.55],
    ['winger', 0.45],
  ],
  LW: [
    ['winger', 0.45],
    ['inside_forward', 0.55],
  ],
  RW: [
    ['winger', 0.45],
    ['inside_forward', 0.55],
  ],
  ST: [
    ['poacher', 0.3],
    ['target_man', 0.25],
    ['false_nine', 0.15],
    ['complete_forward', 0.3],
  ],
};

/** Minimum attribute requirements for a trait to be assigned. */
export const TRAIT_REQUIREMENTS: Partial<Record<TraitId, Partial<Record<AttributeKey, number>>>> = {
  sniper: { shotAccuracy: 60 },
  playmaker: { vision: 60 },
  speedster: { sprintSpeed: 68 },
  wall: { tackling: 55 },
  aerial_king: { jumping: 65 },
  pressing_machine: { stamina: 60 },
  trickster: { dribbling: 62 },
  engine: { stamina: 66 },
  set_piece: { longPassing: 58 },
};
