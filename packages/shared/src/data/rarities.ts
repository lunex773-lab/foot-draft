import type { Rarity } from '../types';

export const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'icon'];

export interface RarityInfo {
  id: Rarity;
  label: string;
  labelJa: string;
  /** initial OVR band (spec 4-3). Used as a guide only. */
  ovrMin: number;
  ovrMax: number;
  /** number of cards of this rarity in the player database v1 */
  catalogCount: number;
}

export const RARITY_INFO: Record<Rarity, RarityInfo> = {
  common: { id: 'common', label: 'COMMON', labelJa: 'コモン', ovrMin: 45, ovrMax: 65, catalogCount: 120 },
  rare: { id: 'rare', label: 'RARE', labelJa: 'レア', ovrMin: 60, ovrMax: 75, catalogCount: 90 },
  epic: { id: 'epic', label: 'EPIC', labelJa: 'エピック', ovrMin: 70, ovrMax: 85, catalogCount: 54 },
  legendary: { id: 'legendary', label: 'LEGENDARY', labelJa: 'レジェンダリー', ovrMin: 80, ovrMax: 92, catalogCount: 27 },
  icon: { id: 'icon', label: 'ICON', labelJa: 'アイコン', ovrMin: 88, ovrMax: 99, catalogCount: 9 },
};

export function rarityRank(r: Rarity): number {
  return RARITIES.indexOf(r);
}
