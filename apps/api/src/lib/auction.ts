import { DEFAULT_AUCTION_SETTINGS, availableFunds, normalizeStoredAuctionSettings, type AuctionSettings, type AuctionWalletView } from '@fd/shared';
import type { Env } from '../env';
import { hmacSha256, randomId } from './crypto';
import { analyticsWhen, claimedNow, type Condition } from './economy';
import { settingOf } from './settings';

/**
 * Auction coins (decision 100): a wallet and a ledger of their own, apart from
 * COINS and GEMS. Holds (the highest bids) live in the same wallet row and can
 * never exceed the balance (CHECK in migration 0012).
 */

export const AUCTION_SETTINGS_KEY = 'auction';
export const AUCTION_INITIAL_KEY = 'auction:initial';

/** automated tests may use lots shorter than one day (never in production, decision 107) */
export function auctionTestTimings(env: Env): boolean {
  return env.ALLOW_TEST_TIMINGS === 'true' && env.ENVIRONMENT !== 'production';
}

/** the admin's settings (values outside the bounds moved to the nearest bound), or the defaults */
export async function auctionSettings(env: Env): Promise<AuctionSettings> {
  const v = (await settingOf(env, AUCTION_SETTINGS_KEY))?.value;
  if (!v) return DEFAULT_AUCTION_SETTINGS;
  return normalizeStoredAuctionSettings(v, { testTimings: auctionTestTimings(env) });
}

export function ensureAuctionWalletStmt(env: Env, userId: string, now: number): D1PreparedStatement {
  return env.DB.prepare('INSERT OR IGNORE INTO auction_wallets (user_id, updated_at) VALUES (?, ?)').bind(userId, now);
}

export interface AuctionChange {
  userId: string;
  /** positive = credit, negative = debit (the balance; holds are changed by the market) */
  amount: number;
  reason: string;
  refType?: string | null;
  refId?: string | null;
  opId: string;
  now: number;
}

/** balance update + ledger row (optionally only when `cond` holds) */
export function auctionBalanceStmts(env: Env, c: AuctionChange, cond?: Condition): D1PreparedStatement[] {
  if (!Number.isInteger(c.amount) || c.amount === 0) throw new Error('invalid amount');
  const where = cond ? ` AND ${cond.sql}` : '';
  const binds = cond?.binds ?? [];
  return [
    env.DB.prepare(`UPDATE auction_wallets SET balance = balance + ?, updated_at = ? WHERE user_id = ?${where}`).bind(c.amount, c.now, c.userId, ...binds),
    env.DB.prepare(
      `INSERT INTO auction_transactions (id, user_id, amount, balance_after, reason, ref_type, ref_id, op_id, created_at)
       SELECT ?, ?, ?, balance, ?, ?, ?, ?, ? FROM auction_wallets WHERE user_id = ?${where}`,
    ).bind(randomId(), c.userId, c.amount, c.reason, c.refType ?? null, c.refId ?? null, c.opId, c.now, c.userId, ...binds),
  ];
}

export async function auctionWalletOf(env: Env, userId: string): Promise<AuctionWalletView> {
  const row = await env.DB.prepare('SELECT balance, held FROM auction_wallets WHERE user_id = ?').bind(userId).first<{ balance: number; held: number }>();
  const balance = row?.balance ?? 0;
  const held = row?.held ?? 0;
  return { balance, held, available: availableFunds(balance, held) };
}

/**
 * Decision 100: every account receives the initial funds once (again after a
 * test data reset). Recorded in reward_claims so it is never paid twice.
 */
export async function ensureAuctionFunds(env: Env, userId: string, settings: AuctionSettings): Promise<void> {
  const claimed = await env.DB.prepare('SELECT 1 FROM reward_claims WHERE user_id = ? AND reward_key = ?').bind(userId, AUCTION_INITIAL_KEY).first();
  const now = Date.now();
  if (claimed) {
    await ensureAuctionWalletStmt(env, userId, now).run();
    return;
  }
  const opId = randomId();
  const amount = settings.initialFunds;
  const stmts: D1PreparedStatement[] = [
    ensureAuctionWalletStmt(env, userId, now),
    env.DB.prepare("INSERT OR IGNORE INTO reward_claims (id, user_id, reward_key, kind, currency, amount, op_id, created_at) VALUES (?, ?, ?, 'auction_initial', 'AUCTION_COINS', ?, ?, ?)").bind(
      randomId(),
      userId,
      AUCTION_INITIAL_KEY,
      amount,
      opId,
      now,
    ),
  ];
  if (amount > 0) {
    const cond = claimedNow({ userId, key: AUCTION_INITIAL_KEY, opId });
    stmts.push(
      ...auctionBalanceStmts(env, { userId, amount, reason: 'initial', refType: 'reward_claim', refId: AUCTION_INITIAL_KEY, opId, now }, cond),
      analyticsWhen(env, 'auction_funds_granted', userId, { amount }, now, cond),
    );
  }
  await env.DB.batch(stmts);
}

/** spec 7 fraud log: the network address only as a keyed hash (never stored as is) */
export async function networkHash(env: Env, ip: string | null | undefined): Promise<string | null> {
  if (!ip) return null;
  return (await hmacSha256(env.WS_TICKET_SECRET, `auction-ip:${ip}`)).slice(0, 24);
}

export function auctionStub(env: Env) {
  return env.AUCTION.get(env.AUCTION.idFromName('market'));
}
