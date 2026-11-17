import { enhancePlayer, type Lineup, type Player, type RoomSnapshot } from '@fd/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** an owned card (MATCH: strengthening level, decision 70; favourite mark, decision 73) */
export interface TeamCard {
  playerId: string;
  level: number;
  favorite: boolean;
  source: string;
  obtainedAt: number;
}

export interface Squad {
  slot: number;
  name: string;
  lineup: Lineup;
  updatedAt: number;
}

export interface TeamData {
  cards: TeamCard[];
  squads: Squad[];
  /** the team used in MATCH */
  active: number | null;
  slots: number;
  maxLevel: number;
  /** the first 11 cards, only in the answer of the very first visit */
  starter?: { playerId: string; newCard: boolean; levelTo: number | null; points: number }[] | null;
}

export function useTeam() {
  const [data, setData] = useState<TeamData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api<TeamData>('/api/team')
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(reload, [reload]);
  return { data, setData, error, reload };
}

/** the owned cards as they play in MATCH (strengthened) */
export function strengthenedCards(cards: TeamCard[], catalog: Map<string, Player>): Player[] {
  return cards.filter((c) => catalog.has(c.playerId)).map((c) => enhancePlayer(catalog.get(c.playerId)!, c.level));
}

export async function setFavorite(playerId: string, favorite: boolean) {
  return api<{ playerId: string; favorite: boolean }>('/api/team/favorite', { body: { playerId, favorite } });
}

/** the cards of a seat in a room as they play (MATCH: strengthened by the seat's levels) */
export function seatRoster(snap: RoomSnapshot, players: Map<string, Player>, seat: number): Player[] {
  const lv = snap.levels?.[seat] ?? {};
  return (snap.rosters[seat] ?? [])
    .map((id) => players.get(id))
    .filter((p): p is Player => !!p)
    .map((p) => (lv[p.id] ? enhancePlayer(p, lv[p.id]) : p));
}
