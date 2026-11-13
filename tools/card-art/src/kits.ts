/**
 * Fictional kits and crests for the 10 clubs of the player database
 * (spec 4-6: no real clubs, badges, kits or sponsor logos).
 */
export type CrestEmblem =
  | 'mountain'
  | 'wolf'
  | 'star'
  | 'lion'
  | 'crown'
  | 'moon'
  | 'sun'
  | 'eagle'
  | 'tower'
  | 'compass'
  | 'wave'
  | 'flame'
  | 'stag'
  | 'anchor'
  | 'bolt'
  | 'tree'
  | 'comet'
  | 'shield_cross'
  | 'fox'
  | 'key';

export type KitPattern = 'solid' | 'stripes' | 'hoops' | 'sash' | 'halves' | 'pinstripe' | 'chevron';

export interface Kit {
  primary: string;
  secondary: string;
  accent: string;
  pattern: KitPattern;
  crestShape: 'shield' | 'round' | 'diamond' | 'heater' | 'hex';
  emblem: CrestEmblem;
  collar: 'v' | 'crew';
}

export const KITS: Record<string, Kit> = {
  // North League
  'CL-01': { primary: '#1d4f7a', secondary: '#f2f4f7', accent: '#9cc3e6', pattern: 'hoops', crestShape: 'shield', emblem: 'compass', collar: 'crew' }, // North United
  'CL-07': { primary: '#b9c0c9', secondary: '#2a2f38', accent: '#2a2f38', pattern: 'solid', crestShape: 'heater', emblem: 'tower', collar: 'v' }, // Silvergate
  // Eclipse League
  'CL-02': { primary: '#16246b', secondary: '#0b0f2a', accent: '#6f8fd8', pattern: 'stripes', crestShape: 'round', emblem: 'moon', collar: 'v' }, // Eclipse FC
  'CL-08': { primary: '#3a1660', secondary: '#e0b84f', accent: '#e0b84f', pattern: 'chevron', crestShape: 'diamond', emblem: 'star', collar: 'v' }, // Asterion FC
  // Orion League
  'CL-03': { primary: '#5b2a9e', secondary: '#f1ecfa', accent: '#c9a6ff', pattern: 'sash', crestShape: 'hex', emblem: 'wolf', collar: 'crew' }, // Orion SC
  'CL-09': { primary: '#8c1d5a', secondary: '#1b1b1b', accent: '#ff9ad5', pattern: 'halves', crestShape: 'round', emblem: 'comet', collar: 'v' }, // Nova Borough
  // Empire League
  'CL-04': { primary: '#121a33', secondary: '#c9a227', accent: '#f3dc8a', pattern: 'pinstripe', crestShape: 'shield', emblem: 'crown', collar: 'v' }, // Empire City
  'CL-10': { primary: '#7a1020', secondary: '#f4e3b2', accent: '#f4e3b2', pattern: 'solid', crestShape: 'heater', emblem: 'lion', collar: 'crew' }, // Crownside
  // Zenith League
  'CL-05': { primary: '#eef3f6', secondary: '#0e7c86', accent: '#0e7c86', pattern: 'sash', crestShape: 'round', emblem: 'sun', collar: 'v' }, // Zenith FC
  // Vortex League
  'CL-06': { primary: '#d35400', secondary: '#1b1b1b', accent: '#1b1b1b', pattern: 'stripes', crestShape: 'diamond', emblem: 'bolt', collar: 'crew' }, // Vortex Athletic
};
