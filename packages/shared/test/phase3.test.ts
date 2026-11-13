import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_POOLS,
  FORMATION_IDS,
  GAME_CONFIG,
  POSITION_GROUP,
  RANKED_CONFIG,
  Rng,
  analyzePool,
  buildDraftPool,
  carryOverRating,
  dailyChallenge,
  describeFilter,
  eloFromRanks,
  evaluateGoal,
  getCatalog,
  jstDateKey,
  jstDayRange,
  matchesFilter,
  previousSeasonId,
  sanitizeFilter,
  seasonAt,
  seasonById,
  teamRecord,
  tierOf,
  computeStandings,
  type FixtureResult,
} from '../src';

const catalog = getCatalog();
const byId = new Map(catalog.map((p) => [p.id, p]));

describe('ranked rating (Elo from final ranks)', () => {
  it('four equal players: winner and loser move by the same amount', () => {
    const ch = eloFromRanks(['a', 'b', 'c', 'd'].map((id, i) => ({ id, rating: 1000, rank: i + 1 })));
    expect(ch.map((c) => c.delta)).toEqual([16, 5, -5, -16]);
    expect(ch.reduce((s, c) => s + c.delta, 0)).toBe(0);
  });

  it('beating stronger players gains more than beating weaker ones', () => {
    const upset = eloFromRanks([
      { id: 'low', rating: 900, rank: 1 },
      { id: 'high', rating: 1300, rank: 2 },
    ]);
    const expected = eloFromRanks([
      { id: 'high', rating: 1300, rank: 1 },
      { id: 'low', rating: 900, rank: 2 },
    ]);
    expect(upset[0].delta).toBeGreaterThan(expected[0].delta);
    expect(upset[0].delta).toBeLessThanOrEqual(RANKED_CONFIG.k);
  });

  it('a single human (others CPU) does not change the rating', () => {
    expect(eloFromRanks([{ id: 'solo', rating: 1100, rank: 1 }])).toEqual([{ id: 'solo', before: 1100, after: 1100, delta: 0 }]);
  });

  it('two humans: rating moves by K/1 x (score - expected)', () => {
    const ch = eloFromRanks([
      { id: 'a', rating: 1000, rank: 2 },
      { id: 'b', rating: 1000, rank: 4 },
    ]);
    expect(ch.map((c) => c.delta)).toEqual([16, -16]);
  });

  it('tiers and season carry-over', () => {
    expect(tierOf(1000).id).toBe('silver');
    expect(tierOf(899).id).toBe('bronze');
    expect(tierOf(1500).id).toBe('legend');
    expect(carryOverRating(1200)).toBe(1100);
    expect(carryOverRating(800)).toBe(900);
    expect(carryOverRating(null)).toBe(1000);
  });
});

describe('monthly seasons (Japan time)', () => {
  it('changes at 00:00 JST on the 1st', () => {
    expect(seasonAt(Date.parse('2026-11-30T14:59:59Z')).id).toBe('2026-11');
    expect(seasonAt(Date.parse('2026-11-30T15:00:00Z')).id).toBe('2026-12');
    expect(seasonAt(Date.parse('2026-12-31T15:00:00Z')).id).toBe('2027-01');
    const s = seasonById('2026-12');
    expect(new Date(s.startsAt).toISOString()).toBe('2026-11-30T15:00:00.000Z');
    expect(new Date(s.endsAt).toISOString()).toBe('2026-12-31T15:00:00.000Z');
    expect(s.nameJa).toBe('2026年12月シーズン');
    expect(previousSeasonId('2027-01')).toBe('2026-12');
  });

  it('Japan date keys', () => {
    expect(jstDateKey(Date.parse('2026-11-13T14:59:00Z'))).toBe('2026-11-13');
    expect(jstDateKey(Date.parse('2026-11-13T15:00:00Z'))).toBe('2026-11-14');
    const r = jstDayRange('2026-11-14');
    expect(new Date(r.startsAt).toISOString()).toBe('2026-11-13T15:00:00.000Z');
  });
});

describe('draft pool with conditions (events / challenges)', () => {
  const comp = GAME_CONFIG.pool;
  const groupCount = (ids: string[]) => {
    const c = { GK: 0, DF: 0, MF: 0, FW: 0 };
    for (const id of ids) c[POSITION_GROUP[byId.get(id)!.primaryPosition]]++;
    return c;
  };

  it('without a condition the pool is unchanged (84 players, group quotas)', () => {
    const a = buildDraftPool(catalog, new Rng('pool-x'));
    const b = buildDraftPool(catalog, new Rng('pool-x'), comp, null);
    expect(a).toEqual(b);
    expect(a).toHaveLength(84);
    expect(groupCount(a).GK).toBe(comp.GK);
  });

  it('a pure condition makes a pool of target players only', () => {
    const f = { rarities: ['common' as const, 'rare' as const] };
    expect(analyzePool(catalog, f).pure).toBe(true);
    const pool = buildDraftPool(catalog, new Rng('pure'), comp, f);
    expect(pool).toHaveLength(84);
    expect(pool.every((id) => matchesFilter(byId.get(id)!, f))).toBe(true);
    expect(groupCount(pool).GK).toBe(comp.GK);
  });

  it('a small condition puts every target player in the pool and fills the rest (Japan: 23 players)', () => {
    const f = { nationalities: ['JPN'] };
    const a = analyzePool(catalog, f);
    expect(a).toMatchObject({ eligible: 23, included: 23, pure: false });
    const pool = buildDraftPool(catalog, new Rng('jpn'), comp, f);
    expect(pool).toHaveLength(84);
    const targets = catalog.filter((p) => matchesFilter(p, f)).map((p) => p.id);
    expect(targets.every((id) => pool.includes(id))).toBe(true);
    expect(new Set(pool).size).toBe(84);
  });

  it('a goalkeeper event includes all 20 goalkeepers (some in free slots)', () => {
    const f = { positions: ['GK' as const] };
    const pool = buildDraftPool(catalog, new Rng('gk'), comp, f);
    expect(groupCount(pool).GK).toBe(20);
    expect(pool).toHaveLength(84);
  });

  it('young players: target players first, missing goalkeepers from the others', () => {
    const f = { maxAge: 23 };
    const pool = buildDraftPool(catalog, new Rng('young'), comp, f);
    const counts = groupCount(pool);
    expect(counts.GK).toBe(comp.GK);
    const youngGk = catalog.filter((p) => p.primaryPosition === 'GK' && p.age <= 23).map((p) => p.id);
    expect(youngGk.every((id) => pool.includes(id))).toBe(true);
    expect(pool.filter((id) => byId.get(id)!.age <= 23).length).toBe(analyzePool(catalog, f).included);
  });

  it('sanitizes untrusted conditions and describes them in Japanese', () => {
    const f = sanitizeFilter({ nationalities: ['JPN', 'XXX'], rarities: ['icon', 'mythic'], maxAge: '23', minOvr: 300, positions: 'GK' });
    expect(f).toEqual({ nationalities: ['JPN'], rarities: ['icon'], maxAge: 23 });
    expect(describeFilter(f)).toEqual(['国籍：日本', 'レアリティ：ICON', '年齢：23歳以下']);
    expect(describeFilter({})).toEqual(['条件なし（通常の候補）']);
  });
});

describe('Solo Challenge (daily)', () => {
  it('is the same for everyone on the same Japan date', () => {
    expect(dailyChallenge('2026-11-14')).toEqual(dailyChallenge('2026-11-14'));
    expect(dailyChallenge('2026-11-14').id).toBe('daily-2026-11-14');
  });

  it('every challenge condition fills the whole pool with target players', () => {
    for (const p of CHALLENGE_POOLS) {
      if (p.filter) expect(analyzePool(catalog, p.filter).pure, p.id).toBe(true);
    }
  });

  it('a year of daily challenges is valid and varied', () => {
    const kinds = new Set<string>();
    const start = Date.parse('2026-11-14T00:00:00Z');
    for (let d = 0; d < 365; d++) {
      const c = dailyChallenge(new Date(start + d * 86400000).toISOString().slice(0, 10));
      if (c.rule.type === 'fixed_formation') expect(FORMATION_IDS).toContain(c.rule.formation);
      expect(c.titleJa.length).toBeGreaterThan(2);
      expect([1, 2, 3]).toContain(c.difficulty);
      kinds.add(`${c.pool.id}|${c.rule.type}|${c.goal.type}`);
    }
    expect(kinds.size).toBeGreaterThan(40);
  });

  it('evaluates goals from the league results', () => {
    const results: FixtureResult[] = [
      { matchday: 1, home: 0, away: 1, homeGoals: 3, awayGoals: 0 },
      { matchday: 1, home: 2, away: 3, homeGoals: 1, awayGoals: 1 },
      { matchday: 2, home: 2, away: 0, homeGoals: 2, awayGoals: 2 },
      { matchday: 2, home: 3, away: 1, homeGoals: 0, awayGoals: 1 },
      { matchday: 3, home: 0, away: 3, homeGoals: 2, awayGoals: 0 },
      { matchday: 3, home: 1, away: 2, homeGoals: 0, awayGoals: 0 },
    ];
    const table = computeStandings(4, results, 'lot');
    const rec = teamRecord(0, table, results);
    expect(rec).toMatchObject({ rank: 1, won: 2, drawn: 1, lost: 0, goalsFor: 7, goalsAgainst: 2, cleanSheets: 2, points: 7 });
    expect(evaluateGoal({ type: 'rank1' }, rec)).toBe(true);
    expect(evaluateGoal({ type: 'unbeaten' }, rec)).toBe(true);
    expect(evaluateGoal({ type: 'all_wins' }, rec)).toBe(false);
    expect(evaluateGoal({ type: 'goals', min: 7 }, rec)).toBe(true);
    expect(evaluateGoal({ type: 'clean_sheets', min: 2 }, rec)).toBe(true);
    expect(evaluateGoal({ type: 'rank1' }, teamRecord(1, table, results))).toBe(false);
  });
});
