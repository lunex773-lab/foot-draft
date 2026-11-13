import { describe, expect, it } from 'vitest';
import {
  GAME_CONFIG,
  POSITION_GROUP,
  Rng,
  applyPick,
  buildDraftPool,
  chooseAutoPick,
  createDraftState,
  currentSeat,
  getCatalog,
  isDraftComplete,
  rosterOf,
  snakeOrder,
  validatePick,
} from '../src';

const catalog = getCatalog();
const byId = new Map(catalog.map((p) => [p.id, p]));

describe('snake draft', () => {
  it('follows P1 P2 P3 P4 P4 P3 P2 P1', () => {
    expect(snakeOrder(4, 3)).toEqual([0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3]);
    expect(snakeOrder(4, 14)).toHaveLength(56);
  });

  it('builds a pool with the agreed composition', () => {
    const pool = buildDraftPool(catalog, new Rng('pool-test'));
    expect(pool).toHaveLength(84);
    expect(new Set(pool).size).toBe(84);
    const groups = { GK: 0, DF: 0, MF: 0, FW: 0 };
    for (const id of pool) groups[POSITION_GROUP[byId.get(id)!.primaryPosition]]++;
    expect(groups.GK).toBe(GAME_CONFIG.pool.GK);
    expect(groups.DF).toBeGreaterThanOrEqual(GAME_CONFIG.pool.DF);
    expect(groups.MF).toBeGreaterThanOrEqual(GAME_CONFIG.pool.MF);
    expect(groups.FW).toBeGreaterThanOrEqual(GAME_CONFIG.pool.FW);
  });

  it('completes 56 picks with no duplicates and valid rosters (auto picks)', () => {
    for (let n = 0; n < 5; n++) {
      const rng = new Rng(`draft-${n}`);
      const state = createDraftState(buildDraftPool(catalog, rng.fork('pool')));
      while (!isDraftComplete(state)) {
        const seat = currentSeat(state)!;
        applyPick(state, seat, chooseAutoPick(state, seat, byId, rng, n % 2 ? 2 : 0), true, byId);
      }
      expect(state.picks).toHaveLength(56);
      expect(new Set(state.picks.map((p) => p.playerId)).size).toBe(56);
      for (let seat = 0; seat < 4; seat++) {
        const roster = rosterOf(state, seat).map((id) => byId.get(id)!);
        expect(roster).toHaveLength(14);
        const gks = roster.filter((p) => p.primaryPosition === 'GK').length;
        expect(gks).toBeGreaterThanOrEqual(1);
        expect(gks).toBeLessThanOrEqual(GAME_CONFIG.maxGkPerTeam);
        // the AI builds balanced squads
        expect(roster.filter((p) => POSITION_GROUP[p.primaryPosition] === 'DF').length).toBeGreaterThanOrEqual(3);
        expect(roster.filter((p) => POSITION_GROUP[p.primaryPosition] === 'FW').length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('rejects invalid picks', () => {
    const state = createDraftState(buildDraftPool(catalog, new Rng('v')));
    const first = state.pool[0];
    expect(validatePick(state, 1, first, byId)).toBe('NOT_YOUR_TURN');
    expect(validatePick(state, 0, 'unknown', byId)).toBe('NOT_IN_POOL');
    applyPick(state, 0, first, false, byId);
    expect(validatePick(state, 1, first, byId)).toBe('ALREADY_PICKED');
  });

  it('enforces the goalkeeper limit', () => {
    const state = createDraftState(buildDraftPool(catalog, new Rng('gk')), 1, 14);
    const gks = state.pool.filter((id) => byId.get(id)!.primaryPosition === 'GK');
    for (let i = 0; i < GAME_CONFIG.maxGkPerTeam; i++) applyPick(state, 0, gks[i], false, byId);
    expect(validatePick(state, 0, gks[GAME_CONFIG.maxGkPerTeam], byId)).toBe('GK_LIMIT');
    const auto = chooseAutoPick(state, 0, byId);
    expect(byId.get(auto)!.primaryPosition).not.toBe('GK');
  });
});
