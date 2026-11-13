/**
 * Fictional leagues and clubs (spec 4-6: no real clubs, badges or kits).
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

export type CrestShape = 'shield' | 'round' | 'diamond' | 'heater' | 'hex';
export type KitPattern = 'solid' | 'stripes' | 'hoops' | 'sash' | 'halves' | 'pinstripe' | 'chevron';

export interface LeagueInfo {
  id: string;
  name: string;
  nameJa: string;
  /** emblem used for the league badge */
  emblem: 'north' | 'eclipse' | 'orion' | 'empire' | 'zenith';
  color: string;
}

export interface ClubInfo {
  id: string;
  name: string;
  shortName: string;
  leagueId: string;
  primary: string;
  secondary: string;
  accent: string;
  pattern: KitPattern;
  crestShape: CrestShape;
  emblem: CrestEmblem;
}

export const LEAGUES: LeagueInfo[] = [
  { id: 'north', name: 'North League', nameJa: 'ノースリーグ', emblem: 'north', color: '#9fb4c8' },
  { id: 'eclipse', name: 'Eclipse League', nameJa: 'エクリプスリーグ', emblem: 'eclipse', color: '#6f8fd8' },
  { id: 'orion', name: 'Orion League', nameJa: 'オリオンリーグ', emblem: 'orion', color: '#a77bd9' },
  { id: 'empire', name: 'Empire League', nameJa: 'エンパイアリーグ', emblem: 'empire', color: '#d4af5a' },
  { id: 'zenith', name: 'Zenith League', nameJa: 'ゼニスリーグ', emblem: 'zenith', color: '#7fd6d0' },
];

export const CLUBS: ClubInfo[] = [
  // North League
  { id: 'frostvale', name: 'Frostvale FC', shortName: 'FRO', leagueId: 'north', primary: '#1f2329', secondary: '#3a414b', accent: '#c9d3dd', pattern: 'solid', crestShape: 'round', emblem: 'mountain' },
  { id: 'northgate', name: 'Northgate Rovers', shortName: 'NGR', leagueId: 'north', primary: '#1d4f7a', secondary: '#f2f4f7', accent: '#9cc3e6', pattern: 'hoops', crestShape: 'shield', emblem: 'compass' },
  { id: 'ironpeak', name: 'Ironpeak United', shortName: 'IPU', leagueId: 'north', primary: '#7a1f24', secondary: '#2a2a2e', accent: '#d9b46a', pattern: 'halves', crestShape: 'heater', emblem: 'tower' },
  { id: 'glacierbay', name: 'Glacier Bay', shortName: 'GLB', leagueId: 'north', primary: '#e8eef4', secondary: '#4a86b8', accent: '#1d3a57', pattern: 'sash', crestShape: 'hex', emblem: 'wave' },
  // Eclipse League
  { id: 'lunaris', name: 'Lunaris FC', shortName: 'LUN', leagueId: 'eclipse', primary: '#16246b', secondary: '#0b0f2a', accent: '#6f8fd8', pattern: 'stripes', crestShape: 'shield', emblem: 'wolf' },
  { id: 'nightfall', name: 'Nightfall City', shortName: 'NFC', leagueId: 'eclipse', primary: '#26213f', secondary: '#c7a7ff', accent: '#e6dcff', pattern: 'pinstripe', crestShape: 'round', emblem: 'moon' },
  { id: 'crescent', name: 'Crescent Athletic', shortName: 'CRA', leagueId: 'eclipse', primary: '#0f6b5c', secondary: '#f1f1e8', accent: '#e0c15a', pattern: 'chevron', crestShape: 'diamond', emblem: 'key' },
  { id: 'shadowmere', name: 'Shadowmere', shortName: 'SHM', leagueId: 'eclipse', primary: '#2b2b2b', secondary: '#c0392b', accent: '#ececec', pattern: 'stripes', crestShape: 'heater', emblem: 'fox' },
  // Orion League
  { id: 'starhaven', name: 'Starhaven', shortName: 'STH', leagueId: 'orion', primary: '#3a1660', secondary: '#1a0b2e', accent: '#b98cff', pattern: 'chevron', crestShape: 'shield', emblem: 'wolf' },
  { id: 'nebula', name: 'Nebula Athletic', shortName: 'NEB', leagueId: 'orion', primary: '#8c1d5a', secondary: '#f6e7f0', accent: '#ff9ad5', pattern: 'hoops', crestShape: 'round', emblem: 'comet' },
  { id: 'polaris', name: 'Polaris FC', shortName: 'POL', leagueId: 'orion', primary: '#f5f6fa', secondary: '#1f3a8a', accent: '#f2c94c', pattern: 'sash', crestShape: 'hex', emblem: 'star' },
  { id: 'cometunited', name: 'Comet United', shortName: 'COM', leagueId: 'orion', primary: '#d35400', secondary: '#1b1b1b', accent: '#ffd29a', pattern: 'halves', crestShape: 'diamond', emblem: 'bolt' },
  // Empire League
  { id: 'imperial', name: 'Imperial Lions', shortName: 'IML', leagueId: 'empire', primary: '#121a33', secondary: '#c9a227', accent: '#f3dc8a', pattern: 'solid', crestShape: 'shield', emblem: 'lion' },
  { id: 'regalcity', name: 'Regal City', shortName: 'RGC', leagueId: 'empire', primary: '#6b0f1a', secondary: '#f4e3b2', accent: '#d4af5a', pattern: 'pinstripe', crestShape: 'heater', emblem: 'crown' },
  { id: 'sovereign', name: 'Sovereign FC', shortName: 'SOV', leagueId: 'empire', primary: '#0d4d2e', secondary: '#ffffff', accent: '#d4af5a', pattern: 'stripes', crestShape: 'round', emblem: 'eagle' },
  { id: 'crownmoor', name: 'Crownmoor', shortName: 'CRM', leagueId: 'empire', primary: '#f2f2f2', secondary: '#1c1c1c', accent: '#b8862b', pattern: 'hoops', crestShape: 'diamond', emblem: 'shield_cross' },
  // Zenith League
  { id: 'skyreach', name: 'Skyreach', shortName: 'SKY', leagueId: 'zenith', primary: '#eef3f6', secondary: '#c9a227', accent: '#7fd6d0', pattern: 'solid', crestShape: 'round', emblem: 'compass' },
  { id: 'apex', name: 'Apex United', shortName: 'APX', leagueId: 'zenith', primary: '#0e7c86', secondary: '#0a2c33', accent: '#a7f3ec', pattern: 'chevron', crestShape: 'shield', emblem: 'flame' },
  { id: 'solaris', name: 'Solaris', shortName: 'SOL', leagueId: 'zenith', primary: '#f4b400', secondary: '#1d1d1d', accent: '#fff3c4', pattern: 'stripes', crestShape: 'hex', emblem: 'sun' },
  { id: 'evergreen', name: 'Evergreen Wanderers', shortName: 'EVW', leagueId: 'zenith', primary: '#2e7d32', secondary: '#f1f8e9', accent: '#a5d6a7', pattern: 'halves', crestShape: 'heater', emblem: 'stag' },
];

export const LEAGUE_BY_ID: Record<string, LeagueInfo> = Object.fromEntries(LEAGUES.map((l) => [l.id, l]));
export const CLUB_BY_ID: Record<string, ClubInfo> = Object.fromEntries(CLUBS.map((c) => [c.id, c]));
