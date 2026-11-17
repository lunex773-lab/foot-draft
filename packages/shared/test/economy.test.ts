import { describe, expect, it } from 'vitest';
import {
  ECONOMY_CONFIG,
  EMPTY_PITY,
  GACHA_BANNERS,
  MISSIONS,
  PPM,
  RARITIES,
  applyPick,
  bannerPool,
  buildDraftPool,
  chooseAutoPick,
  createDraftState,
  cryptoRandom,
  drawRarity,
  getCatalog,
  jstWeekKey,
  leagueMetrics,
  loginBonusFor,
  matchRewardFor,
  periodKey,
  pityStatus,
  ratesSum,
  runGacha,
  seasonRewardFor,
  seededRandom,
  splitPaidGems,
  validatePick,
  Rng,
  type Rarity,
} from '../src';

const catalog = getCatalog();
const byId = new Map(catalog.map((p) => [p.id, p]));
const standard = GACHA_BANNERS.find((b) => b.id === 'standard')!;
const premium = GACHA_BANNERS.find((b) => b.id === 'premium-s1')!;

describe('gacha rates and pools (spec 9)', () => {
  it('rates add up to 100% and match the specification', () => {
    for (const b of GACHA_BANNERS) expect(ratesSum(b.ratesPpm)).toBe(PPM);
    expect(standard.ratesPpm).toEqual({ common: 600_000, rare: 280_000, epic: 100_000, legendary: 20_000, icon: 0 });
    expect(premium.ratesPpm).toEqual({ common: 0, rare: 650_000, epic: 250_000, legendary: 90_000, icon: 10_000 });
    expect(standard.pity).toBeNull();
  });

  it('pools: Standard has no Icon, Premium has the 180 Rare-or-better cards', () => {
    const sp = bannerPool(standard, catalog);
    const pp = bannerPool(premium, catalog);
    expect(sp.icon).toHaveLength(0);
    expect(sp.common.length + sp.rare.length + sp.epic.length + sp.legendary.length).toBe(291);
    expect(pp.common).toHaveLength(0);
    expect(pp.rare.length + pp.epic.length + pp.legendary.length + pp.icon.length).toBe(180);
  });

  it('a large number of draws follows the rates (Standard)', () => {
    const rnd = seededRandom('rates');
    const counts: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0, icon: 0 };
    const n = 200_000;
    for (let i = 0; i < n; i++) counts[drawRarity(standard.ratesPpm, rnd)]++;
    for (const r of RARITIES) expect(Math.abs(counts[r] / n - standard.ratesPpm[r] / PPM)).toBeLessThan(0.005);
    expect(counts.icon).toBe(0);
  });

  it('crypto randomness gives integers in range', () => {
    const rnd = cryptoRandom();
    for (let i = 0; i < 1000; i++) {
      const v = rnd.int(7);
      expect(v >= 0 && v < 7 && Number.isInteger(v)).toBe(true);
    }
  });

  it('Standard: 10 draws are independent, duplicates of +5 cards become Standard points', () => {
    const pool = bannerPool(standard, catalog);
    const owned = new Map(pool.common.map((id) => [id, 5] as [string, number]));
    const run = runGacha(standard, pool, owned, null, 10, seededRandom('std'));
    expect(run.results).toHaveLength(10);
    expect(run.pity).toBeNull();
    for (const r of run.results) {
      expect(r.guarantee).toBe('none');
      expect(r.pointType).toBe('standard');
      if (r.rarity === 'common') expect(r.duplicate && r.enhancedTo === null && r.points === 10).toBe(true);
    }
    expect(run.pointsTotal).toBe(run.results.reduce((s, r) => s + r.points, 0));
  });

  it('decision 70: a duplicate strengthens the card +1 (up to +5), no points until then', () => {
    const pool = bannerPool(standard, catalog);
    // a random source that always draws the first card of the lowest rarity: always the same common card
    const same = { int: () => 0 };
    const first = pool.common[0];
    const run = runGacha(standard, pool, new Map([[first, 3]]), null, 4, same);
    expect(run.results.map((r) => r.enhancedTo)).toEqual([4, 5, null, null]);
    expect(run.results.map((r) => r.points)).toEqual([0, 0, 10, 10]);
    expect(run.enhanced).toEqual({ [first]: 5 });
    // a new card: the first copy is not a duplicate, the second strengthens it
    const fresh = runGacha(standard, pool, new Map(), null, 2, same);
    expect(fresh.results.map((r) => [r.duplicate, r.enhancedTo])).toEqual([
      [false, null],
      [true, 1],
    ]);
  });
});

describe('Premium pity (decisions 37, 38)', () => {
  const pool = bannerPool(premium, catalog);
  /** a random source that always draws the lowest allowed rarity and the first card */
  const unlucky = { int: () => 0 };

  it('without luck: Epic+ on the 50th draw, Legendary+ on the 100th', () => {
    const run = runGacha(premium, pool, new Set(), EMPTY_PITY, 100, unlucky);
    const g = run.results.map((r, i) => ({ i: i + 1, ...r }));
    expect(g.filter((r) => r.rarity !== 'rare').map((r) => [r.i, r.rarity, r.guarantee])).toEqual([
      [50, 'epic', 'epic'],
      [100, 'legendary', 'legendary'],
    ]);
    expect(run.pity).toEqual({ sinceEpic: 0, sinceLegendary: 0, towardBonus: 100, total: 100 });
  });

  it('counters restart when an Epic-or-better is drawn naturally', () => {
    const state = { ...EMPTY_PITY, sinceEpic: 30, sinceLegendary: 30 };
    // first draw lands in the Epic range (index >= 650000), then unlucky
    let first = true;
    const rnd = { int: (max: number) => (first ? ((first = false), 700_000 % max) : 0) };
    const run = runGacha(premium, pool, new Set(), state, 1, rnd);
    expect(run.results[0].rarity).toBe('epic');
    expect(run.results[0].guarantee).toBe('none');
    expect(run.pity).toMatchObject({ sinceEpic: 0, sinceLegendary: 31 });
  });

  it('every 150 paid draws a free Epic-or-better draw is added automatically', () => {
    const run = runGacha(premium, pool, new Set(), { ...EMPTY_PITY, towardBonus: 145, total: 145 }, 10, unlucky);
    expect(run.results).toHaveLength(11);
    const bonus = run.results.filter((r) => r.free);
    expect(bonus).toHaveLength(1);
    expect(bonus[0].guarantee).toBe('bonus');
    expect(['epic', 'legendary', 'icon']).toContain(bonus[0].rarity);
    expect(run.results.indexOf(bonus[0])).toBe(5); // right after the 150th paid draw
    expect(run.pity?.towardBonus).toBe(5);
    expect(run.pity?.total).toBe(155);
  });

  it('the bonus draw does not touch the guarantee counters', () => {
    const run = runGacha(premium, pool, new Set(), { sinceEpic: 10, sinceLegendary: 10, towardBonus: 149, total: 149 }, 1, unlucky);
    expect(run.results.map((r) => r.free)).toEqual([false, true]);
    expect(run.pity).toMatchObject({ sinceEpic: 11, sinceLegendary: 11 });
  });

  it('pity status for the UI', () => {
    expect(pityStatus(premium, { sinceEpic: 49, sinceLegendary: 99, towardBonus: 149, total: 149 })).toEqual({ epicIn: 1, legendaryIn: 1, bonusIn: 1, total: 149 });
    expect(pityStatus(standard, null)).toBeNull();
  });

  it('a long run never goes 50 draws without Epic+ or 100 without Legendary+', () => {
    const run = runGacha(premium, pool, new Set(), EMPTY_PITY, 3000, seededRandom('long'));
    let se = 0;
    let sl = 0;
    for (const r of run.results.filter((x) => !x.free)) {
      se = ['epic', 'legendary', 'icon'].includes(r.rarity) ? 0 : se + 1;
      sl = ['legendary', 'icon'].includes(r.rarity) ? 0 : sl + 1;
      expect(se).toBeLessThan(50);
      expect(sl).toBeLessThan(100);
    }
    expect(run.results.filter((x) => x.free)).toHaveLength(20);
  });
});

describe('economy values (spec 8-10)', () => {
  it('match rewards, season rewards, login bonus', () => {
    expect(matchRewardFor(1)).toEqual({ participation: 100, rankBonus: 150, total: 250 });
    expect(matchRewardFor(4).total).toBe(125);
    expect(seasonRewardFor(1)).toBe(300);
    expect(seasonRewardFor(10)).toBe(200);
    expect(seasonRewardFor(11)).toBe(100);
    expect([1, 2, 6, 7, 14].map(loginBonusFor)).toEqual([100, 100, 100, 300, 300]);
    expect(ECONOMY_CONFIG.duplicatePoints).toEqual({ common: 10, rare: 30, epic: 100, legendary: 300, icon: 1000 });
  });

  it('PAID GEMS: distributed gems are spent first (decision 44)', () => {
    expect(splitPaidGems(100, { GEMS_PAID_GRANTED: 60, GEMS_PAID_PURCHASED: 500 })).toEqual({ GEMS_PAID_GRANTED: 60, GEMS_PAID_PURCHASED: 40 });
    expect(splitPaidGems(100, { GEMS_PAID_GRANTED: 500, GEMS_PAID_PURCHASED: 0 })).toEqual({ GEMS_PAID_GRANTED: 100 });
    expect(splitPaidGems(1000, { GEMS_PAID_GRANTED: 500, GEMS_PAID_PURCHASED: 499 })).toBeNull();
  });

  it('missions: totals, Japan day / week keys, league metrics', () => {
    const sum = (p: string) => MISSIONS.filter((m) => m.period === p).reduce((s, m) => s + m.reward.amount, 0);
    expect(sum('daily')).toBe(300);
    expect(sum('weekly')).toBe(1500);
    expect(sum('beginner')).toBe(300);
    // Sunday 23:59 JST and Monday 00:00 JST belong to different weeks
    expect(jstWeekKey(Date.parse('2026-11-15T14:59:00Z'))).toBe('W2026-11-09');
    expect(jstWeekKey(Date.parse('2026-11-15T15:00:00Z'))).toBe('W2026-11-16');
    expect(periodKey('daily', Date.parse('2026-11-14T15:00:00Z'))).toBe('2026-11-15');
    expect(periodKey('beginner', 0)).toBe('once');
    expect(leagueMetrics({ mode: 'ranked', rank: 1, matchWins: 2, manualPicks: 9 })).toMatchObject({
      league_completed: 1,
      league_won: 1,
      match_won: 2,
      manual_pick: 9,
      ranked_or_event_league: 1,
      ranked_league: 1,
    });
  });
});

describe('Collection Draft reserved cards (decision 36)', () => {
  it('only the owner can pick a reserved card; auto picks respect it', () => {
    const reservedIds = ['FD-173', 'FD-072', 'FD-096']; // icons
    const pool = [...buildDraftPool(catalog.filter((p) => !reservedIds.includes(p.id)), new Rng('cd')), ...reservedIds];
    const state = createDraftState(pool);
    // FD-096 was registered by two players: either of them may pick it
    state.reserved = { 'FD-173': [2], 'FD-072': [2], 'FD-096': [0, 3] };
    expect(validatePick(state, 0, 'FD-173', byId)).toBe('RESERVED');
    expect(validatePick(state, 0, 'FD-096', byId)).toBeNull();
    // run the whole draft with auto picks: reserved cards end up only with their owners
    while (state.picks.length < state.order.length) {
      const seat = state.order[state.picks.length];
      applyPick(state, seat, chooseAutoPick(state, seat, byId), true, byId);
    }
    for (const p of state.picks) {
      const owners = state.reserved[p.playerId];
      if (owners !== undefined) expect(owners).toContain(p.seat);
    }
  });
});
