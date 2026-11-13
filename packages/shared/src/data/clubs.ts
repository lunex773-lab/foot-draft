/**
 * Fictional leagues and clubs of the player database v1
 * (spec 4-6: no real clubs, badges or kits).
 */
export interface LeagueInfo {
  id: string;
  name: string;
  nameJa: string;
}

export interface ClubInfo {
  id: string;
  name: string;
  leagueId: string;
}

export const LEAGUES: LeagueInfo[] = [
  { id: 'north', name: 'North League', nameJa: 'ノースリーグ' },
  { id: 'eclipse', name: 'Eclipse League', nameJa: 'エクリプスリーグ' },
  { id: 'orion', name: 'Orion League', nameJa: 'オリオンリーグ' },
  { id: 'empire', name: 'Empire League', nameJa: 'エンパイアリーグ' },
  { id: 'zenith', name: 'Zenith League', nameJa: 'ゼニスリーグ' },
  { id: 'vortex', name: 'Vortex League', nameJa: 'ヴォルテックスリーグ' },
];

export const CLUBS: ClubInfo[] = [
  { id: 'CL-01', name: 'North United', leagueId: 'north' },
  { id: 'CL-07', name: 'Silvergate', leagueId: 'north' },
  { id: 'CL-02', name: 'Eclipse FC', leagueId: 'eclipse' },
  { id: 'CL-08', name: 'Asterion FC', leagueId: 'eclipse' },
  { id: 'CL-03', name: 'Orion SC', leagueId: 'orion' },
  { id: 'CL-09', name: 'Nova Borough', leagueId: 'orion' },
  { id: 'CL-04', name: 'Empire City', leagueId: 'empire' },
  { id: 'CL-10', name: 'Crownside', leagueId: 'empire' },
  { id: 'CL-05', name: 'Zenith FC', leagueId: 'zenith' },
  { id: 'CL-06', name: 'Vortex Athletic', leagueId: 'vortex' },
];

export const LEAGUE_BY_ID: Record<string, LeagueInfo> = Object.fromEntries(LEAGUES.map((l) => [l.id, l]));
export const LEAGUE_BY_NAME: Record<string, LeagueInfo> = Object.fromEntries(LEAGUES.map((l) => [l.name, l]));
export const CLUB_BY_ID: Record<string, ClubInfo> = Object.fromEntries(CLUBS.map((c) => [c.id, c]));
