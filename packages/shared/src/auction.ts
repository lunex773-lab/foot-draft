import { MAX_CARD_LEVEL } from './economy/gacha';
import { RARITIES } from './data/rarities';
import type { Rarity } from './types';

/**
 * PLAYER AUCTION (spec "PLAYER AUCTION SYSTEM v1.0", decisions 97-106,
 * docs/14-auction-plan.md): one market shared by every user, up to 8 cards
 * listed at a time, public ascending bids. Auction coins are a separate
 * currency (not purchasable; FREE -> PAID GEMS can be exchanged for them).
 * Everything here is pure so that the server and the tests use the same rules.
 */

export type AuctionListingMode = 'random' | 'manual';

export interface AuctionSettings {
  /** the market lists new cards (pausing keeps running lots until they end) */
  open: boolean;
  /** decision 105: random (shuffled cycle of every card) or the admin's queue */
  mode: AuctionListingMode;
  /** decision 106: no new listings while nobody is watching */
  pauseWhenIdle: boolean;
  /** coins every user receives once (spec 3) */
  initialFunds: number;
  /** cards listed at the same time (spec 3) */
  concurrentLots: number;
  /** seconds a lot runs after it is listed (decision 107: at least one day) */
  bidSeconds: number;
  /** a bid with this many seconds or less left ... (spec 3) */
  extendWindowSeconds: number;
  /** ... moves the end this many seconds later (spec 3) */
  extendSeconds: number;
  /** minimum raise: the larger of this percentage of the current price ... (spec 3) */
  minRaisePercent: number;
  /** ... and this many coins (spec 3) */
  minRaiseAmount: number;
  /** decision 103: the first bid must be at least this (per rarity) */
  startPrice: Record<Rarity, number>;
  /** decision 102: 1 GEMS = this many auction coins */
  coinsPerGem: number;
}

export const DEFAULT_AUCTION_SETTINGS: AuctionSettings = {
  open: true,
  mode: 'random',
  pauseWhenIdle: true,
  initialFunds: 100_000,
  concurrentLots: 8,
  bidSeconds: 86_400,
  extendWindowSeconds: 10,
  extendSeconds: 10,
  minRaisePercent: 5,
  minRaiseAmount: 100,
  startPrice: { common: 1_000, rare: 3_000, epic: 8_000, legendary: 20_000, icon: 40_000 },
  coinsPerGem: 10,
};

/** the bounds an admin can set (the server refuses anything outside them) */
export const AUCTION_LIMITS = {
  initialFunds: [0, 10_000_000],
  concurrentLots: [1, 16],
  // decision 107: a lot runs at least one day (at most 30 days)
  bidSeconds: [86_400, 2_592_000],
  extendWindowSeconds: [0, 120],
  extendSeconds: [0, 120],
  minRaisePercent: [0, 100],
  minRaiseAmount: [1, 1_000_000],
  startPrice: [1, 10_000_000],
  coinsPerGem: [1, 10_000],
} as const;

/** automated tests only (local / dev with test timings): lots can be this short */
export const AUCTION_TEST_MIN_BID_SECONDS = 10;

/** the largest single bid (keeps every amount a safe integer) */
export const AUCTION_MAX_BID = 1_000_000_000;

type NumberKey = Exclude<keyof typeof AUCTION_LIMITS, 'startPrice'>;

/**
 * Checks admin input and fills missing fields from `base`. Returns the
 * settings or the list of fields that are not acceptable.
 */
export function validateAuctionSettings(
  input: unknown,
  base: AuctionSettings = DEFAULT_AUCTION_SETTINGS,
  opts: { testTimings?: boolean } = {},
): { ok: true; settings: AuctionSettings } | { ok: false; errors: string[] } {
  if (!input || typeof input !== 'object') return { ok: false, errors: ['settings'] };
  const v = input as Record<string, unknown>;
  const errors: string[] = [];
  const out: AuctionSettings = { ...base, startPrice: { ...base.startPrice } };
  const int = (x: unknown, [lo, hi]: readonly [number, number]) => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
  const limits = (k: NumberKey): readonly [number, number] => (k === 'bidSeconds' && opts.testTimings ? [AUCTION_TEST_MIN_BID_SECONDS, AUCTION_LIMITS.bidSeconds[1]] : AUCTION_LIMITS[k]);
  for (const key of Object.keys(AUCTION_LIMITS) as (keyof typeof AUCTION_LIMITS)[]) {
    if (key === 'startPrice' || v[key] === undefined) continue;
    const k = key as NumberKey;
    if (int(v[k], limits(k))) out[k] = v[k] as number;
    else errors.push(k);
  }
  if (v.startPrice !== undefined) {
    const sp = v.startPrice as Record<string, unknown> | null;
    if (!sp || typeof sp !== 'object') errors.push('startPrice');
    else
      for (const r of RARITIES) {
        if (sp[r] === undefined) continue;
        if (int(sp[r], AUCTION_LIMITS.startPrice)) out.startPrice[r] = sp[r] as number;
        else errors.push(`startPrice.${r}`);
      }
  }
  for (const k of ['open', 'pauseWhenIdle'] as const) {
    if (v[k] === undefined) continue;
    if (typeof v[k] === 'boolean') out[k] = v[k] as boolean;
    else errors.push(k);
  }
  if (v.mode !== undefined) {
    if (v.mode === 'random' || v.mode === 'manual') out.mode = v.mode;
    else errors.push('mode');
  }
  return errors.length ? { ok: false, errors } : { ok: true, settings: out };
}

/**
 * Settings read back from storage: numbers outside the bounds (e.g. a 30-second
 * duration saved before decision 107) are moved to the nearest bound instead of
 * throwing every saved value away.
 */
export function normalizeStoredAuctionSettings(input: unknown, opts: { testTimings?: boolean } = {}): AuctionSettings {
  if (!input || typeof input !== 'object') return DEFAULT_AUCTION_SETTINGS;
  const v = { ...(input as Record<string, unknown>) };
  for (const key of Object.keys(AUCTION_LIMITS) as (keyof typeof AUCTION_LIMITS)[]) {
    if (key === 'startPrice' || typeof v[key] !== 'number' || !Number.isFinite(v[key] as number)) continue;
    const k = key as NumberKey;
    const lo = k === 'bidSeconds' && opts.testTimings ? AUCTION_TEST_MIN_BID_SECONDS : AUCTION_LIMITS[k][0];
    v[k] = Math.min(AUCTION_LIMITS[k][1], Math.max(lo, Math.round(v[k] as number)));
  }
  const r = validateAuctionSettings(v, DEFAULT_AUCTION_SETTINGS, opts);
  return r.ok ? r.settings : DEFAULT_AUCTION_SETTINGS;
}

/** a duration for people: 1日 / 3時間20分 / 5分10秒 / 8秒 */
export function formatAuctionDuration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return h > 0 ? `${d}日${h}時間` : `${d}日`;
  if (h > 0) return m > 0 ? `${h}時間${m}分` : `${h}時間`;
  if (m > 0) return sec > 0 ? `${m}分${sec}秒` : `${m}分`;
  return `${sec}秒`;
}

// ------------------------------------------------------------------ bidding

/** the rules a lot was listed with (kept on the lot: later changes do not affect it) */
export interface LotRules {
  startPrice: number;
  extendWindowSeconds: number;
  extendSeconds: number;
  minRaisePercent: number;
  minRaiseAmount: number;
}

export function lotRulesOf(s: AuctionSettings, rarity: Rarity): LotRules {
  return {
    startPrice: s.startPrice[rarity],
    extendWindowSeconds: s.extendWindowSeconds,
    extendSeconds: s.extendSeconds,
    minRaisePercent: s.minRaisePercent,
    minRaiseAmount: s.minRaiseAmount,
  };
}

/** spec 3: the next bid is at least the larger of +5 % and +100 (the first bid: the start price) */
export function minNextBid(currentPrice: number | null, rules: LotRules): number {
  if (currentPrice === null) return rules.startPrice;
  const raise = Math.max(Math.ceil((currentPrice * rules.minRaisePercent) / 100), rules.minRaiseAmount);
  return currentPrice + raise;
}

/** spec 3: a bid in the last seconds moves the end later */
export function endAfterBid(endsAt: number, now: number, rules: LotRules): number {
  if (endsAt - now <= rules.extendWindowSeconds * 1000) return endsAt + rules.extendSeconds * 1000;
  return endsAt;
}

export type BidRefusal =
  /** the lot ended, was cancelled or does not exist */
  | 'LOT_CLOSED'
  /** below the minimum next bid */
  | 'BID_TOO_LOW'
  /** not a whole number of coins or above the maximum */
  | 'BAD_AMOUNT'
  /** the bidder already holds the highest bid */
  | 'ALREADY_LEADING'
  /** decision 99: the card is already +5 */
  | 'MAX_LEVEL'
  /** available coins (balance - holds) are not enough */
  | 'INSUFFICIENT_FUNDS';

export interface BidCheck {
  lotOpen: boolean;
  endsAt: number;
  now: number;
  currentPrice: number | null;
  leaderId: string | null;
  rules: LotRules;
  bidderId: string;
  amount: unknown;
  /** the bidder's level of this card (null = not owned) */
  ownedLevel: number | null;
  /** balance - every active hold of the bidder */
  available: number;
}

/** the server's decision on a bid (the client shows the same reasons) */
export function checkBid(b: BidCheck): BidRefusal | null {
  if (!b.lotOpen || b.now >= b.endsAt) return 'LOT_CLOSED';
  if (typeof b.amount !== 'number' || !Number.isInteger(b.amount) || b.amount <= 0 || b.amount > AUCTION_MAX_BID) return 'BAD_AMOUNT';
  if (b.leaderId === b.bidderId) return 'ALREADY_LEADING';
  if (b.ownedLevel !== null && b.ownedLevel >= MAX_CARD_LEVEL) return 'MAX_LEVEL';
  if (b.amount < minNextBid(b.currentPrice, b.rules)) return 'BID_TOO_LOW';
  if (b.amount > b.available) return 'INSUFFICIENT_FUNDS';
  return null;
}

export const BID_REFUSAL_TEXT: Record<BidRefusal, string> = {
  LOT_CLOSED: 'この出品は終了しました',
  BID_TOO_LOW: '最低入札額より低い金額です',
  BAD_AMOUNT: '金額が正しくありません',
  ALREADY_LEADING: 'すでにあなたが最高額です',
  MAX_LEVEL: 'この選手は +5 まで強化済みのため入札できません',
  INSUFFICIENT_FUNDS: 'オークション資金が足りません',
};

// ------------------------------------------------------------------ funds

/** coins that can still be bid: the balance minus every active hold (spec 4) */
export function availableFunds(balance: number, held: number): number {
  return Math.max(0, balance - held);
}

/** decision 101: whole GEMS needed to cover `needed` more coins (0 = enough already) */
export function gemsForShortfall(needed: number, available: number, coinsPerGem: number): number {
  const short = needed - available;
  if (short <= 0) return 0;
  return Math.ceil(short / coinsPerGem);
}

// ------------------------------------------------------------------ listing

/**
 * Random listing with little bias (spec 5): every card once per cycle in a
 * shuffled order; a new cycle (the "market update") shuffles every card
 * again, sold or unsold. A card already on the market is skipped (put back).
 * Returns the next card and the remaining bag (the input is not changed).
 */
export function nextFromBag(bag: readonly string[], allIds: readonly string[], onMarket: ReadonlySet<string>, random: () => number): { playerId: string | null; bag: string[]; reshuffled: boolean } {
  let rest = [...bag];
  let reshuffled = false;
  for (let round = 0; round < 2; round++) {
    const i = rest.findIndex((id) => !onMarket.has(id));
    if (i >= 0) {
      const playerId = rest[i];
      rest.splice(i, 1);
      return { playerId, bag: rest, reshuffled };
    }
    // the cycle is over (or only cards on the market are left): shuffle every card again
    rest = shuffle(allIds, random);
    reshuffled = true;
  }
  return { playerId: null, bag: rest, reshuffled };
}

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------------------ protocol

export type LotStatus = 'open' | 'sold' | 'unsold' | 'cancelled';

/** a lot as every viewer sees it (public auction) */
export interface AuctionLotView {
  id: string;
  /** a running number for people (#123) */
  no: number;
  playerId: string;
  rarity: Rarity;
  status: LotStatus;
  listedAt: number;
  endsAt: number;
  currentPrice: number | null;
  /** the display name of the highest bidder (spec: public) */
  leaderName: string | null;
  /** true when the viewer is the highest bidder */
  leaderIsYou: boolean;
  bidCount: number;
  minNextBid: number;
  rules: LotRules;
}

export interface AuctionMarketView {
  open: boolean;
  mode: AuctionListingMode;
  lots: AuctionLotView[];
  serverNow: number;
  /** settings the client shows (rules text, exchange) */
  coinsPerGem: number;
  concurrentLots: number;
}

export interface AuctionWalletView {
  balance: number;
  held: number;
  available: number;
}

export type AuctionServerMessage =
  | { type: 'market'; market: AuctionMarketView }
  | { type: 'lot'; lot: AuctionLotView; serverNow: number }
  /** the viewer's own bid was overtaken */
  | { type: 'outbid'; lotId: string; playerId: string; price: number }
  /** the viewer won a lot */
  | { type: 'won'; lotId: string; playerId: string; price: number; levelAfter: number | null; points: number }
  | { type: 'ended'; lotId: string; status: LotStatus; price: number | null; winnerName: string | null; winnerIsYou: boolean }
  | { type: 'wallet'; wallet: AuctionWalletView }
  | { type: 'pong'; t: number; serverNow: number }
  | { type: 'error'; code: string; message?: string };

export type AuctionClientMessage = { type: 'ping'; t: number } | { type: 'hello' };
