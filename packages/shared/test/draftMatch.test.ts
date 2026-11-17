import { describe, expect, it } from 'vitest';
import {
  DRAFT_MATCH_CONFIG,
  FORMATION_IDS,
  RARITIES,
  buildDraftMatchPool,
  canMove,
  draftMatchAutoPick,
  draftMatchOrder,
  dmCurrentSeat,
  dmRoster,
  evaluateHand,
  getCatalog,
  groupNeeds,
  groupOf,
  nextTieGroup,
  poolQuota,
  rarityTargets,
  resolveGroup,
  rollDice,
  roundRobin,
  seededRandom,
  splitByResult,
  turnFinished,
  turnResult,
  validateDraftMatchPick,
  type Dice,
  type DraftMatchDraft,
  type FormationId,
} from '../src';

const catalog = getCatalog();
const byId = new Map(catalog.map((p) => [p.id, p]));

describe('チンチロ hands (spec 3)', () => {
  it('ranks ピンゾロ > シゴロ > ゾロ目 > 通常役 > ヒフミ > 役なし', () => {
    const s = (d: number[]) => evaluateHand(d).strength;
    expect(evaluateHand([1, 1, 1]).kind).toBe('pinzoro');
    expect(evaluateHand([6, 4, 5]).kind).toBe('shigoro');
    expect(evaluateHand([3, 3, 3])).toMatchObject({ kind: 'zorome', value: 3 });
    expect(evaluateHand([2, 5, 2])).toMatchObject({ kind: 'normal', value: 5 });
    expect(evaluateHand([3, 1, 2]).kind).toBe('hifumi');
    expect(evaluateHand([1, 3, 6]).kind).toBe('none');
    const order = [
      [1, 1, 1],
      [4, 5, 6],
      [6, 6, 6],
      [2, 2, 2],
      [1, 1, 6],
      [5, 5, 1],
      [1, 2, 3],
      [2, 4, 6],
    ];
    for (let i = 1; i < order.length; i++) expect(s(order[i - 1])).toBeGreaterThan(s(order[i]));
    // the same hand: the remaining die / the number decides; the same result is equal
    expect(s([3, 3, 6])).toBeGreaterThan(s([5, 5, 2]));
    expect(s([3, 3, 6])).toBe(s([1, 6, 1]));
    expect(s([2, 5, 1])).toBe(s([3, 4, 1]));
  });

  it('a turn ends with the first hand or after 3 throws (no hand = last)', () => {
    const none: Dice = [1, 3, 5];
    expect(turnFinished([none])).toBe(false);
    expect(turnFinished([none, [2, 2, 4]])).toBe(true);
    expect(turnFinished([none, none, none])).toBe(true);
    expect(turnResult([none, none, none]).kind).toBe('none');
    expect(turnResult([none, [1, 2, 3]]).kind).toBe('hifumi');
  });

  it('equal results play again; the order is built from the groups', () => {
    const hands: Record<string, number[]> = { a: [4, 4, 2], b: [6, 6, 5], c: [1, 3, 5], d: [5, 2, 5] };
    const groups = splitByResult(['a', 'b', 'c', 'd'], (p) => evaluateHand(hands[p]));
    // a and d both have 2の目: the same result
    expect(groups.map((g) => [...g].sort())).toEqual([['b'], ['a', 'd'], ['c']]);
    expect(nextTieGroup(groups)?.sort()).toEqual(['a', 'd']);
    const resolved = resolveGroup(groups, ['a', 'd'], [['d'], ['a']]);
    expect(resolved).toEqual([['b'], ['d'], ['a'], ['c']]);
    expect(nextTieGroup(resolved)).toBeNull();
  });

  it('the dice are fair 1-6 and hands appear at about the expected rate', () => {
    const rnd = seededRandom('dice');
    const counts = [0, 0, 0, 0, 0, 0];
    let withHand = 0;
    const n = 30_000;
    for (let i = 0; i < n; i++) {
      const d = rollDice(rnd);
      for (const x of d) counts[x - 1]++;
      if (evaluateHand(d).kind !== 'none') withHand++;
    }
    for (const c of counts) expect(Math.abs(c / (n * 3) - 1 / 6)).toBeLessThan(0.01);
    // 1 - P(no hand) where no hand = all different except 4-5-6 and 1-2-3: 108/216 = 0.5
    expect(Math.abs(withHand / n - 0.5)).toBeLessThan(0.015);
  });
});

describe('DRAFT MATCH pool (spec 5, decisions 79 / 81)', () => {
  const cases: FormationId[][] = [
    ['4-3-3', '4-4-2', '3-5-2', '5-3-2'],
    ['4-2-3-1', '4-2-3-1', '4-2-3-1'],
    ['3-4-3', '4-1-4-1'],
    ['5-3-2', '5-3-2', '5-3-2', '5-3-2'],
  ];
  for (const fs of cases) {
    it(`${fs.length} players (${fs.join(', ')}): size, positions, rarities`, () => {
      for (let seed = 0; seed < 20; seed++) {
        const pool = buildDraftMatchPool(catalog, fs, seededRandom(`pool-${fs.join()}-${seed}`));
        expect(pool).toHaveLength(11 * fs.length + 12);
        expect(new Set(pool).size).toBe(pool.length);
        const quota = poolQuota(fs);
        for (const g of ['GK', 'DF', 'MF', 'FW'] as const) expect(pool.filter((id) => groupOf(byId.get(id)!) === g).length).toBe(quota[g]);
        const target = rarityTargets(catalog, pool.length);
        for (const r of RARITIES) {
          const n = pool.filter((id) => byId.get(id)!.rarity === r).length;
          expect(n).toBeGreaterThanOrEqual(1);
          expect(Math.abs(n - target[r])).toBeLessThanOrEqual(3);
        }
      }
    });
  }

  it('rarity targets follow the catalog (56 cards)', () => {
    const t = rarityTargets(catalog, 56);
    expect(Object.values(t).reduce((a, b) => a + b, 0)).toBe(56);
    expect(t).toEqual({ common: 22, rare: 17, epic: 10, legendary: 5, icon: 2 });
  });

  it('excluded (paid-only) cards are never in the pool', () => {
    const icons = catalog.filter((p) => p.rarity === 'icon').map((p) => p.id);
    const pool = buildDraftMatchPool(catalog, ['4-3-3', '4-3-3'], seededRandom('ex'), new Set(icons));
    expect(pool.some((id) => icons.includes(id))).toBe(false);
  });
});

describe('DRAFT MATCH snake draft (spec 4, decision 78)', () => {
  it('snake order from the チンチロ result', () => {
    expect(draftMatchOrder([2, 0, 3, 1], 3)).toEqual([2, 0, 3, 1, 1, 3, 0, 2, 2, 0, 3, 1]);
    expect(draftMatchOrder([1, 0]).length).toBe(22);
  });

  it('turn, pool, duplicates and full position groups are refused', () => {
    const fs: FormationId[] = ['4-3-3', '3-5-2'];
    const pool = buildDraftMatchPool(catalog, fs, seededRandom('v'));
    const d: DraftMatchDraft = { order: draftMatchOrder([0, 1]), pool, picks: [] };
    const gk = pool.find((id) => byId.get(id)!.primaryPosition === 'GK')!;
    const gk2 = pool.filter((id) => byId.get(id)!.primaryPosition === 'GK')[1];
    expect(validateDraftMatchPick(d, 1, gk, fs[1], byId)).toBe('NOT_YOUR_TURN');
    expect(validateDraftMatchPick(d, 0, catalog.find((p) => !pool.includes(p.id))!.id, fs[0], byId)).toBe('NOT_IN_POOL');
    expect(validateDraftMatchPick(d, 0, gk, fs[0], byId)).toBeNull();
    d.picks.push({ pickNo: 1, seat: 0, playerId: gk, auto: false });
    expect(validateDraftMatchPick(d, 1, gk, fs[1], byId)).toBe('ALREADY_PICKED');
    const dfs = pool.filter((id) => groupOf(byId.get(id)!) === 'DF');
    d.picks.push({ pickNo: 2, seat: 1, playerId: dfs[0], auto: false }, { pickNo: 3, seat: 1, playerId: dfs[1], auto: false });
    // seat 0 already has its only GK
    expect(validateDraftMatchPick(d, 0, gk2, fs[0], byId)).toBe('POSITION_FULL');
  });

  it('auto picks always end with every team matching its formation (2-4 players, all formations)', () => {
    for (let t = 0; t < 40; t++) {
      const rnd = seededRandom(`auto-${t}`);
      const n = 2 + (t % 3);
      const fs = Array.from({ length: n }, () => FORMATION_IDS[rnd.int(FORMATION_IDS.length)]);
      const pool = buildDraftMatchPool(catalog, fs, rnd);
      const d: DraftMatchDraft = { order: draftMatchOrder(Array.from({ length: n }, (_, i) => i)), pool, picks: [] };
      while (dmCurrentSeat(d) !== null) {
        const seat = dmCurrentSeat(d)!;
        // humans pick something random that is allowed now and then
        let id = draftMatchAutoPick(d, seat, fs[seat], byId);
        if (rnd.int(2) === 0) {
          const ok = pool.filter((x) => validateDraftMatchPick(d, seat, x, fs[seat], byId) === null);
          id = ok[rnd.int(ok.length)];
        }
        expect(validateDraftMatchPick(d, seat, id, fs[seat], byId)).toBeNull();
        d.picks.push({ pickNo: d.picks.length + 1, seat, playerId: id, auto: true });
      }
      expect(d.picks).toHaveLength(11 * n);
      expect(pool.length - d.picks.length).toBe(DRAFT_MATCH_CONFIG.poolExtra);
      for (let s = 0; s < n; s++) {
        const roster = dmRoster(d, s).map((id) => byId.get(id)!);
        const need = groupNeeds(fs[s]);
        for (const g of ['GK', 'DF', 'MF', 'FW'] as const) expect(roster.filter((p) => groupOf(p) === g).length).toBe(need[g]);
      }
    }
  });

  it('round robin for 2-4 players and the state machine', () => {
    expect(roundRobin(2).flat()).toHaveLength(1);
    expect(roundRobin(3).flat()).toHaveLength(3);
    expect(roundRobin(4).flat()).toHaveLength(6);
    for (const n of [2, 3, 4]) {
      const games = roundRobin(n).flat();
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) expect(games.filter(([h, w]) => (h === a && w === b) || (h === b && w === a))).toHaveLength(1);
    }
    expect(canMove('WAITING', 'MATCHING')).toBe(true);
    expect(canMove('CHINCHIRO', 'PLAYER_DRAFT')).toBe(false);
    expect(canMove('SIMULATION', 'TEAM_CONFIRMATION')).toBe(true);
  });
});
