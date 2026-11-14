import { describe, expect, it } from 'vitest';
import { PASS_CONFIG, PRODUCTS, gemsForPurchase, leagueXp, passLevel, passRewards, passTotals, splitGemsFreeFirst } from '../src';

describe('products (decision 53)', () => {
  it('1 yen = 1 GEMS, bonus on bigger packs, first-time bonus on the Starter Pack', () => {
    const p = (id: string) => PRODUCTS.find((x) => x.id === id)!;
    expect(PRODUCTS.filter((x) => x.kind === 'gems').every((x) => x.gemsBase === x.priceJpy)).toBe(true);
    expect(gemsForPurchase(p('gems_300'), true)).toEqual({ purchased: 300, granted: 150 });
    expect(gemsForPurchase(p('gems_300'), false)).toEqual({ purchased: 300, granted: 0 });
    const total = (id: string) => {
      const g = gemsForPurchase(p(id), false);
      return g.purchased + g.granted;
    };
    expect([600, 1200, 3000, 5000, 10000].map((y) => total(`gems_${y}`))).toEqual([600, 1250, 3200, 5500, 11500]);
    expect(p('membership_monthly')).toMatchObject({ kind: 'membership', priceJpy: 500, periodDays: 30 });
  });
});

describe('Season Pass (decision 54)', () => {
  it('30 levels of 200 XP; a league gives 100 XP (+50 for 1st)', () => {
    expect(passLevel(0)).toBe(0);
    expect(passLevel(199)).toBe(0);
    expect(passLevel(200)).toBe(1);
    expect(passLevel(99999)).toBe(PASS_CONFIG.levels);
    expect([leagueXp(1), leagueXp(2), leagueXp(4)]).toEqual([150, 100, 100]);
  });

  it('free track: 300 FREE GEMS and COINS; premium track: COINS, points and 2 cards', () => {
    expect(passTotals('free')).toEqual({ coins: 1500, gemsFree: 300, standardPoints: 0, premiumPoints: 0, cards: 0 });
    expect(passTotals('premium')).toEqual({ coins: 4800, gemsFree: 0, standardPoints: 600, premiumPoints: 200, cards: 2 });
    expect(passRewards('premium', 30)[0]).toMatchObject({ type: 'card', rarity: 'legendary' });
    expect(passRewards('free', 31)).toEqual([]);
  });

  it('GEMS are spent FREE first, then distributed, then purchased (decision 56)', () => {
    expect(splitGemsFreeFirst(800, { GEMS_FREE: 500, GEMS_PAID_GRANTED: 200, GEMS_PAID_PURCHASED: 1000 })).toEqual({ GEMS_FREE: 500, GEMS_PAID_GRANTED: 200, GEMS_PAID_PURCHASED: 100 });
    expect(splitGemsFreeFirst(800, { GEMS_FREE: 1000, GEMS_PAID_GRANTED: 0, GEMS_PAID_PURCHASED: 0 })).toEqual({ GEMS_FREE: 800 });
    expect(splitGemsFreeFirst(800, { GEMS_FREE: 100, GEMS_PAID_GRANTED: 100, GEMS_PAID_PURCHASED: 100 })).toBeNull();
  });
});
