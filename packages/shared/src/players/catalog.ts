import rawPlayers from '../../../../data/player-db-v1/players.json';
import rawSim from '../../../../data/player-db-v1/simulation_attributes.json';
import type { Player } from '../types';
import { convertPlayerDatabase, type RawPlayerDb, type RawSimDb } from './import';

/**
 * The card catalog = "FOOTBALL DRAFT 300 Player Database v1"
 * (data/player-db-v1). The server's source of truth is D1, seeded from the
 * same files; this in-memory copy is used by tests, scripts and tooling.
 */
let cached: Player[] | null = null;

export function getCatalog(): Player[] {
  if (!cached) cached = convertPlayerDatabase(rawPlayers as RawPlayerDb, rawSim as RawSimDb);
  return cached;
}
