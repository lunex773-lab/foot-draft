/**
 * Products sold for real money (spec 11, decisions 52-55). Seeded into D1
 * (purchase_products) by migration 0007; the admin site can change them.
 */

export type ProductKind = 'gems' | 'membership';
export type Store = 'mock' | 'apple' | 'google';

export interface ProductDef {
  id: string;
  kind: ProductKind;
  nameJa: string;
  priceJpy: number;
  /** GEMS for the price (recorded as purchased PAID GEMS) */
  gemsBase: number;
  /** extra GEMS (recorded as distributed PAID GEMS) */
  gemsBonus: number;
  /** extra GEMS on the first purchase of this product only */
  firstTimeBonus: number;
  /** membership: days per period */
  periodDays: number | null;
  sortOrder: number;
}

/** decision 53: 1 yen = 1 GEMS, bigger packs give a bonus */
export const PRODUCTS: ProductDef[] = [
  { id: 'gems_300', kind: 'gems', nameJa: 'Starter Pack', priceJpy: 300, gemsBase: 300, gemsBonus: 0, firstTimeBonus: 150, periodDays: null, sortOrder: 1 },
  { id: 'gems_600', kind: 'gems', nameJa: 'Small Pack', priceJpy: 600, gemsBase: 600, gemsBonus: 0, firstTimeBonus: 0, periodDays: null, sortOrder: 2 },
  { id: 'gems_1200', kind: 'gems', nameJa: 'Medium Pack', priceJpy: 1200, gemsBase: 1200, gemsBonus: 50, firstTimeBonus: 0, periodDays: null, sortOrder: 3 },
  { id: 'gems_3000', kind: 'gems', nameJa: 'Large Pack', priceJpy: 3000, gemsBase: 3000, gemsBonus: 200, firstTimeBonus: 0, periodDays: null, sortOrder: 4 },
  { id: 'gems_5000', kind: 'gems', nameJa: 'Premium Pack', priceJpy: 5000, gemsBase: 5000, gemsBonus: 500, firstTimeBonus: 0, periodDays: null, sortOrder: 5 },
  { id: 'gems_10000', kind: 'gems', nameJa: 'Ultimate Pack', priceJpy: 10000, gemsBase: 10000, gemsBonus: 1500, firstTimeBonus: 0, periodDays: null, sortOrder: 6 },
  // decision 55: 30-day auto-renewing membership
  { id: 'membership_monthly', kind: 'membership', nameJa: 'Premium Membership', priceJpy: 500, gemsBase: 0, gemsBonus: 0, firstTimeBonus: 0, periodDays: 30, sortOrder: 10 },
];

export const MEMBERSHIP_CONFIG = {
  /** FREE GEMS per Japan day while the membership is active */
  dailyFreeGems: 20,
} as const;

/** GEMS a purchase grants: purchased part (price) and distributed part (bonus) */
export function gemsForPurchase(p: Pick<ProductDef, 'gemsBase' | 'gemsBonus' | 'firstTimeBonus'>, firstTime: boolean): { purchased: number; granted: number } {
  return { purchased: p.gemsBase, granted: p.gemsBonus + (firstTime ? p.firstTimeBonus : 0) };
}
