import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUCTION_SETTINGS,
  Rng,
  availableFunds,
  checkBid,
  endAfterBid,
  gemsForShortfall,
  lotRulesOf,
  minNextBid,
  nextFromBag,
  validateAuctionSettings,
  type BidCheck,
} from '../src';

const rules = lotRulesOf(DEFAULT_AUCTION_SETTINGS, 'rare');

describe('auction rules (spec PLAYER AUCTION v1.0)', () => {
  it('uses the spec values and the start prices of decision 103', () => {
    const s = DEFAULT_AUCTION_SETTINGS;
    expect([s.initialFunds, s.concurrentLots, s.bidSeconds, s.extendWindowSeconds, s.extendSeconds, s.minRaisePercent, s.minRaiseAmount]).toEqual([100_000, 8, 30, 10, 10, 5, 100]);
    expect(s.startPrice).toEqual({ common: 1_000, rare: 3_000, epic: 8_000, legendary: 20_000, icon: 40_000 });
    expect(s.coinsPerGem).toBe(10);
  });

  it('the first bid is the start price, then +5 % or +100 whichever is larger', () => {
    expect(minNextBid(null, rules)).toBe(3_000);
    expect(minNextBid(1_000, rules)).toBe(1_100); // 5 % = 50 < 100
    expect(minNextBid(2_000, rules)).toBe(2_100); // 5 % = 100
    expect(minNextBid(10_000, rules)).toBe(10_500);
    expect(minNextBid(10_001, rules)).toBe(10_502); // 500.05 rounded up
  });

  it('a bid in the last 10 seconds moves the end 10 seconds later', () => {
    const end = 100_000;
    expect(endAfterBid(end, end - 10_001, rules)).toBe(end);
    expect(endAfterBid(end, end - 10_000, rules)).toBe(end + 10_000);
    expect(endAfterBid(end, end - 1, rules)).toBe(end + 10_000);
  });

  const base: BidCheck = { lotOpen: true, endsAt: 50_000, now: 10_000, currentPrice: 5_000, leaderId: 'a', rules, bidderId: 'b', amount: 5_250, ownedLevel: null, available: 100_000 };

  it('accepts a valid bid and refuses the others with a reason', () => {
    expect(checkBid(base)).toBeNull();
    expect(checkBid({ ...base, lotOpen: false })).toBe('LOT_CLOSED');
    expect(checkBid({ ...base, now: 50_000 })).toBe('LOT_CLOSED');
    expect(checkBid({ ...base, amount: 5_249 })).toBe('BID_TOO_LOW');
    expect(checkBid({ ...base, amount: 5_250.5 })).toBe('BAD_AMOUNT');
    expect(checkBid({ ...base, amount: '6000' })).toBe('BAD_AMOUNT');
    expect(checkBid({ ...base, bidderId: 'a' })).toBe('ALREADY_LEADING');
    expect(checkBid({ ...base, available: 5_249 })).toBe('INSUFFICIENT_FUNDS');
    expect(checkBid({ ...base, available: 5_250 })).toBeNull();
  });

  it('decision 99: an owned card can be won (+1) but not at +5', () => {
    expect(checkBid({ ...base, ownedLevel: 0 })).toBeNull();
    expect(checkBid({ ...base, ownedLevel: 4 })).toBeNull();
    expect(checkBid({ ...base, ownedLevel: 5 })).toBe('MAX_LEVEL');
  });

  it('holds never make the available funds negative; the GEMS shortfall is rounded up', () => {
    expect(availableFunds(100_000, 30_000)).toBe(70_000);
    expect(availableFunds(10, 30)).toBe(0);
    expect(gemsForShortfall(50_000, 70_000, 10)).toBe(0);
    expect(gemsForShortfall(70_001, 70_000, 10)).toBe(1);
    expect(gemsForShortfall(75_005, 70_000, 10)).toBe(501);
  });

  it('validates admin settings within the bounds', () => {
    const ok = validateAuctionSettings({ concurrentLots: 4, startPrice: { icon: 50_000 }, mode: 'manual', pauseWhenIdle: false });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.settings.concurrentLots).toBe(4);
      expect(ok.settings.startPrice.icon).toBe(50_000);
      expect(ok.settings.startPrice.common).toBe(1_000);
      expect(ok.settings.mode).toBe('manual');
      expect(ok.settings.pauseWhenIdle).toBe(false);
    }
    const bad = validateAuctionSettings({ concurrentLots: 0, bidSeconds: 2.5, mode: 'x', startPrice: { rare: -1 }, open: 'yes' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.sort()).toEqual(['bidSeconds', 'concurrentLots', 'mode', 'open', 'startPrice.rare']);
  });
});

describe('random listing with little bias (spec 5)', () => {
  const all = Array.from({ length: 300 }, (_, i) => `FD-${String(i + 1).padStart(3, '0')}`);

  it('lists every card exactly once per cycle, then shuffles again', () => {
    const rng = new Rng(7);
    const random = () => rng.next();
    let bag: string[] = [];
    const seen: string[] = [];
    let reshuffles = 0;
    for (let i = 0; i < 600; i++) {
      const r = nextFromBag(bag, all, new Set(), random);
      bag = r.bag;
      if (r.reshuffled) reshuffles++;
      seen.push(r.playerId!);
    }
    expect(reshuffles).toBe(2);
    expect(new Set(seen.slice(0, 300)).size).toBe(300);
    expect(new Set(seen.slice(300)).size).toBe(300);
    // the two cycles are in different orders
    expect(seen.slice(0, 20)).not.toEqual(seen.slice(300, 320));
  });

  it('never lists a card that is already on the market', () => {
    const rng = new Rng(3);
    const onMarket = new Set(['FD-001', 'FD-002']);
    const r = nextFromBag(['FD-001', 'FD-002', 'FD-003'], all, onMarket, () => rng.next());
    expect(r.playerId).toBe('FD-003');
    expect(r.bag).toEqual(['FD-001', 'FD-002']);
    // only cards on the market left: a new cycle starts and skips them
    const r2 = nextFromBag(['FD-001'], all, onMarket, () => rng.next());
    expect(r2.reshuffled).toBe(true);
    expect(onMarket.has(r2.playerId!)).toBe(false);
  });
});
