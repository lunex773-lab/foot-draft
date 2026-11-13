import type { Rarity } from '@fd/shared';

/** Colour themes per rarity, taken from the reference card design image. */
export interface RarityTheme {
  /** background gradient stops (top -> bottom) */
  bg: [string, string, string];
  /** crystal shard colours */
  shards: string[];
  shardOpacity: number;
  /** metallic frame gradient */
  frame: [string, string, string, string];
  frameInner: string;
  /** main text (OVR, name, stat values) */
  text: string;
  /** secondary text (labels) */
  subText: string;
  glow: string;
  badgeFill: string;
  badgeStroke: string;
  /** portrait colour treatment */
  portraitSaturation: number;
  portraitTint: string | null;
  portraitTintOpacity: number;
  labelBg: string;
  labelText: string;
  labelBorder: string;
}

export const RARITY_THEMES: Record<Rarity, RarityTheme> = {
  common: {
    bg: ['#3b3d42', '#202125', '#121214'],
    shards: ['#7d8088', '#5b5e66', '#a3a6ad', '#2e3036'],
    shardOpacity: 0.35,
    frame: ['#e9eaee', '#8d9097', '#d4d6db', '#5d6067'],
    frameInner: '#a9acb3',
    text: '#f1f2f4',
    subText: '#c9ccd2',
    glow: '#9aa0aa',
    badgeFill: '#2a2c31',
    badgeStroke: '#c4c7cd',
    portraitSaturation: 0.08,
    portraitTint: null,
    portraitTintOpacity: 0,
    labelBg: '#2d2f34',
    labelText: '#e3e5e9',
    labelBorder: '#8d9097',
  },
  rare: {
    bg: ['#1d4fd6', '#10287a', '#07123d'],
    shards: ['#3b7bff', '#1a4cd1', '#86b2ff', '#0d2a8a'],
    shardOpacity: 0.45,
    frame: ['#d9e6ff', '#3d6fe0', '#a9c4ff', '#1b3a95'],
    frameInner: '#7ea4ff',
    text: '#f4f7ff',
    subText: '#c7d6ff',
    glow: '#4f8bff',
    badgeFill: '#0d1f5c',
    badgeStroke: '#9fbaff',
    portraitSaturation: 0.75,
    portraitTint: '#2457e6',
    portraitTintOpacity: 0.22,
    labelBg: '#132a6e',
    labelText: '#dbe6ff',
    labelBorder: '#4f7be0',
  },
  epic: {
    bg: ['#7a3fe0', '#3c1585', '#170833'],
    shards: ['#a46bff', '#6c2fd6', '#d3b2ff', '#3a0f80'],
    shardOpacity: 0.45,
    frame: ['#ead9ff', '#8a4fe8', '#c9a6ff', '#4a1d99'],
    frameInner: '#b388ff',
    text: '#f8f3ff',
    subText: '#dccbff',
    glow: '#a066ff',
    badgeFill: '#2b0f5c',
    badgeStroke: '#c5a3ff',
    portraitSaturation: 0.8,
    portraitTint: '#7b35e8',
    portraitTintOpacity: 0.22,
    labelBg: '#36146e',
    labelText: '#eadcff',
    labelBorder: '#9b67f0',
  },
  legendary: {
    bg: ['#1c2030', '#0d1020', '#06070d'],
    shards: ['#d4af37', '#8f6f1f', '#f3dd8a', '#3a2f12'],
    shardOpacity: 0.32,
    frame: ['#fff1b8', '#c9962b', '#f5d77a', '#7a5414'],
    frameInner: '#e3bf5e',
    text: '#f6d77c',
    subText: '#e5c873',
    glow: '#d9a93a',
    badgeFill: '#14110a',
    badgeStroke: '#e3bf5e',
    portraitSaturation: 1,
    portraitTint: '#d9a43a',
    portraitTintOpacity: 0.1,
    labelBg: '#1c1608',
    labelText: '#f2d27a',
    labelBorder: '#c9962b',
  },
  icon: {
    bg: ['#f3fbff', '#cfeef8', '#a9dbe9'],
    shards: ['#ffffff', '#9fe6f2', '#f6e3a8', '#c7b6ff', '#8ed3e8'],
    shardOpacity: 0.55,
    frame: ['#fff6cf', '#c79a32', '#9fe8f0', '#7a5a14'],
    frameInner: '#e0b956',
    text: '#a8781c',
    subText: '#8b6a26',
    glow: '#ffffff',
    badgeFill: '#fbf6e6',
    badgeStroke: '#c79a32',
    portraitSaturation: 1,
    portraitTint: '#fff4d6',
    portraitTintOpacity: 0.12,
    labelBg: '#fbf7ea',
    labelText: '#7a5a14',
    labelBorder: '#d9b45a',
  },
};

export const SKIN_TONES = ['#f4d6c2', '#e6b793', '#cf9970', '#ad7650', '#87583a', '#5c3a26'];
export const SKIN_SHADOWS = ['#ddb299', '#cc9670', '#b27b54', '#8f5d3c', '#6c442b', '#43291b'];
export const HAIR_COLORS = ['#1a1615', '#3a2518', '#5b3a22', '#87603a', '#c8a159', '#984822'];
export const EYE_COLORS = ['#4a2e1b', '#6b5a2b', '#3c6e9e', '#4f7a4a'];
