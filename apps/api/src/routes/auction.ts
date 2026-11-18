import { splitGemsFreeFirst, type AuctionMarketView, type AuctionWalletView, type Currency } from '@fd/shared';
import { Hono } from 'hono';
import { auctionBalanceStmts, auctionSettings, auctionStub, auctionWalletOf, ensureAuctionFunds, ensureAuctionWalletStmt, networkHash } from '../lib/auction';
import { ipOf } from '../lib/audit';
import { requireUser } from '../lib/auth';
import { signTicket, verifyTicket } from '../lib/crypto';
import { analyticsWhen, currencyStmts, requestIdOf, runOperation, walletOf, type WalletView } from '../lib/economy';
import { ApiError } from '../lib/http';
import type { AppEnv, Env } from '../env';

/**
 * PLAYER AUCTION (decisions 97-106, docs/14-auction-plan.md): the market lives
 * in AuctionDO; these routes add the user (login, initial funds, network hash)
 * and the parts that are not the market itself (GEMS exchange, history).
 */
export const auctionRoutes = new Hono<AppEnv>();

auctionRoutes.use('*', async (c, next) => {
  // the websocket endpoint authenticates with a ticket instead of a bearer token
  if (c.req.path.endsWith('/ws')) return next();
  return requireUser(c, next);
});

/** calls the market and converts its errors to ApiError */
export async function callAuction<T = Record<string, unknown>>(env: Env, path: string, body?: Record<string, unknown>, query?: Record<string, string>): Promise<T> {
  const url = new URL(`https://auction${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await auctionStub(env).fetch(url.toString(), {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as { error?: { code: string; message: string } } & T;
  if (!res.ok) throw new ApiError(data.error?.code ?? 'INTERNAL', data.error?.message ?? 'auction error', res.status);
  return data;
}

/** the market, the user's coins, owned card levels and the last results */
auctionRoutes.get('/state', async (c) => {
  const user = c.get('user');
  const settings = await auctionSettings(c.env);
  await ensureAuctionFunds(c.env, user.id, settings);
  const { market } = await callAuction<{ market: AuctionMarketView }>(c.env, '/market', undefined, { userId: user.id });
  const [wallet, owned, wins, gems] = await Promise.all([
    auctionWalletOf(c.env, user.id),
    c.env.DB.prepare('SELECT player_id, level FROM user_collections WHERE user_id = ?').bind(user.id).all<{ player_id: string; level: number }>(),
    recentWins(c.env, user.id, 20),
    walletOf(c.env, user.id),
  ]);
  return c.json({
    market,
    wallet,
    gems: gems.gems,
    owned: Object.fromEntries(owned.results.map((r) => [r.player_id, r.level])),
    wins,
    rules: {
      initialFunds: settings.initialFunds,
      bidSeconds: settings.bidSeconds,
      extendWindowSeconds: settings.extendWindowSeconds,
      extendSeconds: settings.extendSeconds,
      minRaisePercent: settings.minRaisePercent,
      minRaiseAmount: settings.minRaiseAmount,
      startPrice: settings.startPrice,
      coinsPerGem: settings.coinsPerGem,
    },
  });
});

async function recentWins(env: Env, userId: string, limit: number) {
  const rows = await env.DB.prepare(
    `SELECT r.lot_id, l.no, r.player_id, r.rarity, r.price, r.outcome, r.level_after, r.points, r.created_at
       FROM auction_results r JOIN auction_lots l ON l.id = r.lot_id WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT ?`,
  )
    .bind(userId, limit)
    .all<{ lot_id: string; no: number; player_id: string; rarity: string; price: number; outcome: string; level_after: number | null; points: number; created_at: number }>();
  return rows.results.map((r) => ({ lotId: r.lot_id, no: r.no, playerId: r.player_id, rarity: r.rarity, price: r.price, outcome: r.outcome, levelAfter: r.level_after, points: r.points, at: r.created_at }));
}

/** spec 2: a public ascending bid (decided by the market) */
auctionRoutes.post('/bid', async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => null)) as { lotId?: unknown; amount?: unknown } | null;
  if (!body || typeof body.lotId !== 'string') throw new ApiError('BAD_REQUEST', 'lotId and amount are required');
  await ensureAuctionFunds(c.env, user.id, await auctionSettings(c.env));
  const ipHash = await networkHash(c.env, ipOf(c));
  const res = await callAuction<{ lot: unknown; wallet: AuctionWalletView }>(c.env, '/bid', { userId: user.id, displayName: user.displayName, lotId: body.lotId, amount: body.amount, ipHash });
  return c.json({ lot: res.lot, wallet: res.wallet });
});

/** decisions 101-102: GEMS (FREE first, then PAID: distributed, purchased) to auction coins, one way */
auctionRoutes.post('/exchange', async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => null)) as { gems?: unknown; requestId?: unknown } | null;
  const requestId = requestIdOf(body?.requestId);
  const gems = body?.gems;
  if (typeof gems !== 'number' || !Number.isInteger(gems) || gems < 1 || gems > 1_000_000) throw new ApiError('BAD_REQUEST', 'gems must be a whole number from 1');
  const settings = await auctionSettings(c.env);
  await ensureAuctionFunds(c.env, user.id, settings);
  const result = await runOperation<{ gems: number; coins: number; split: Partial<Record<Currency, number>>; wallet: WalletView; auction: AuctionWalletView }>(
    c.env,
    user.id,
    requestId,
    'auction_exchange',
    async ({ opId, now }) => {
      const wallet = await walletOf(c.env, user.id);
      const split = splitGemsFreeFirst(gems, { GEMS_FREE: wallet.gems.free, GEMS_PAID_GRANTED: wallet.gems.paidGranted, GEMS_PAID_PURCHASED: wallet.gems.paidPurchased });
      if (!split) throw new ApiError('INSUFFICIENT_FUNDS', 'not enough GEMS');
      const coins = gems * settings.coinsPerGem;
      const stmts: D1PreparedStatement[] = [];
      for (const [currency, amount] of Object.entries(split) as [Currency, number][]) {
        stmts.push(...currencyStmts(c.env, { userId: user.id, currency, amount: -amount, reason: 'auction_exchange', refType: 'auction_exchange', refId: opId, opId, now }));
      }
      stmts.push(
        ensureAuctionWalletStmt(c.env, user.id, now),
        ...auctionBalanceStmts(c.env, { userId: user.id, amount: coins, reason: 'exchange', refType: 'auction_exchange', refId: opId, opId, now }),
        analyticsWhen(c.env, 'auction_exchange', user.id, { gems, coins, split, coinsPerGem: settings.coinsPerGem }, now),
      );
      const auction = await auctionWalletOf(c.env, user.id);
      const spent = (k: Currency) => split[k as 'GEMS_FREE'] ?? 0;
      return {
        statements: stmts,
        response: {
          gems,
          coins,
          split,
          wallet: {
            ...wallet,
            gems: {
              free: wallet.gems.free - spent('GEMS_FREE'),
              paidPurchased: wallet.gems.paidPurchased - spent('GEMS_PAID_PURCHASED'),
              paidGranted: wallet.gems.paidGranted - spent('GEMS_PAID_GRANTED'),
              paid: wallet.gems.paid - spent('GEMS_PAID_PURCHASED') - spent('GEMS_PAID_GRANTED'),
              total: wallet.gems.total - gems,
            },
          },
          auction: { balance: auction.balance + coins, held: auction.held, available: auction.available + coins },
        },
      };
    },
  );
  return c.json(result);
});

/** the user's own bids and wins */
auctionRoutes.get('/history', async (c) => {
  const user = c.get('user');
  const bids = await c.env.DB.prepare(
    `SELECT b.lot_id, l.no, l.player_id, l.rarity, b.amount, b.created_at, l.status, l.current_price, l.leader_id = ?1 AS leading
       FROM auction_bids b JOIN auction_lots l ON l.id = b.lot_id WHERE b.user_id = ?1 ORDER BY b.created_at DESC LIMIT 60`,
  )
    .bind(user.id)
    .all<{ lot_id: string; no: number; player_id: string; rarity: string; amount: number; created_at: number; status: string; current_price: number | null; leading: number }>();
  return c.json({
    bids: bids.results.map((r) => ({ lotId: r.lot_id, no: r.no, playerId: r.player_id, rarity: r.rarity, amount: r.amount, at: r.created_at, status: r.status, price: r.current_price, leading: r.leading === 1 })),
    wins: await recentWins(c.env, user.id, 60),
    wallet: await auctionWalletOf(c.env, user.id),
  });
});

auctionRoutes.post('/ticket', async (c) => {
  const user = c.get('user');
  return c.json({ ticket: await signTicket(c.env.WS_TICKET_SECRET, { u: user.id, r: 'auction', e: Date.now() + 60_000 }) });
});

auctionRoutes.get('/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') throw new ApiError('BAD_REQUEST', 'expected websocket upgrade', 426);
  const t = await verifyTicket(c.env.WS_TICKET_SECRET, c.req.query('ticket') ?? '');
  if (!t || t.r !== 'auction') throw new ApiError('UNAUTHORIZED', 'invalid ticket');
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-User-Id', t.u);
  return auctionStub(c.env).fetch(new Request('https://auction/ws', { headers }));
});
