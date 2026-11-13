import type { Player } from '@fd/shared';
import { useEffect, useState } from 'react';
import { api } from './api';

/** Card catalog from the server (source of truth: D1). Cached for the session. */
let cache: Promise<Map<string, Player>> | null = null;

export function loadCatalog(): Promise<Map<string, Player>> {
  if (!cache) {
    cache = api<{ players: Player[] }>('/api/players')
      .then((r) => new Map(r.players.map((p) => [p.id, p])))
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}

export function useCatalog(): Map<string, Player> | null {
  const [m, setM] = useState<Map<string, Player> | null>(null);
  useEffect(() => {
    let alive = true;
    loadCatalog().then((x) => alive && setM(x)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return m;
}
