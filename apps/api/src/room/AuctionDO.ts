import {
  DEFAULT_AUCTION_SETTINGS,
  ECONOMY_CONFIG,
  MAX_CARD_LEVEL,
  availableFunds,
  checkBid,
  endAfterBid,
  lotRulesOf,
  minNextBid,
  nextFromBag,
  type AuctionClientMessage,
  type AuctionLotView,
  type AuctionMarketView,
  type AuctionServerMessage,
  type AuctionSettings,
  type AuctionWalletView,
  type LotRules,
  type LotStatus,
  type Rarity,
} from '@fd/shared';
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { auctionSettings } from '../lib/auction';
import { randomId } from '../lib/crypto';
import { analyticsWhen, ensureWalletStmts, missionCompletedAnalytics, missionProgressStmts, missionsCompletedBy, pointStmts } from '../lib/economy';

/**
 * The player auction market (spec "PLAYER AUCTION SYSTEM v1.0", decisions
 * 97-106): one instance for every user. Up to N cards are listed at a time;
 * bids are public and ascending. Everything that decides an outcome runs
 * here, one step at a time (bids, endings, payments, grants), with the server
 * clock; D1 keeps every lot, bid, hold, result and refusal, so the market
 * comes back exactly after a restart and viewers get the state again on
 * reconnecting.
 */

interface Lot {
  id: string;
  no: number;
  playerId: string;
  rarity: Rarity;
  source: 'random' | 'manual';
  rules: LotRules;
  listedAt: number;
  endsAt: number;
  currentPrice: number | null;
  leaderId: string | null;
  leaderHoldId: string | null;
  bidCount: number;
  /** a settlement that could not be written is tried again at this time */
  retryAt?: number;
}

interface WsAttachment {
  userId: string;
}

type Ok = { ok: true } & Record<string, unknown>;
type Fail = { ok: false; code: string; message: string; status: number };
type Result = Ok | Fail;

const fail = (code: string, message: string, status = 400): Fail => ({ ok: false, code, message, status });

/** bids of one user within this window ... */
const RATE_WINDOW_MS = 5_000;
/** ... above this number are refused (and logged) */
const RATE_MAX_BIDS = 6;
const SETTLE_ATTEMPTS = 5;

function cryptoRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}

export class AuctionDO extends DurableObject<Env> {
  private settings: AuctionSettings = DEFAULT_AUCTION_SETTINGS;
  private lots = new Map<string, Lot>();
  private names = new Map<string, string>();
  private catalog = new Map<string, Rarity>();
  private bag: string[] = [];
  private nextNo = 1;
  private lock: Promise<unknown> = Promise.resolve();
  private recentBids = new Map<string, number[]>();
  /** lot -> network hash -> users (several accounts from one network on one lot) */
  private lotNetworks = new Map<string, Map<string, Set<string>>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(() => this.load());
  }

  private async load() {
    this.settings = await auctionSettings(this.env);
    await this.loadCatalog();
    const open = await this.env.DB.prepare(
      `SELECT l.id, l.no, l.player_id, l.rarity, l.source, l.rules_json, l.listed_at, l.ends_at, l.current_price, l.leader_id, l.leader_hold_id, l.bid_count, u.display_name
         FROM auction_lots l LEFT JOIN users u ON u.id = l.leader_id WHERE l.status = 'open' ORDER BY l.no`,
    ).all<{
      id: string;
      no: number;
      player_id: string;
      rarity: Rarity;
      source: 'random' | 'manual';
      rules_json: string;
      listed_at: number;
      ends_at: number;
      current_price: number | null;
      leader_id: string | null;
      leader_hold_id: string | null;
      bid_count: number;
      display_name: string | null;
    }>();
    this.lots.clear();
    for (const r of open.results) {
      this.lots.set(r.id, {
        id: r.id,
        no: r.no,
        playerId: r.player_id,
        rarity: r.rarity,
        source: r.source,
        rules: JSON.parse(r.rules_json) as LotRules,
        listedAt: r.listed_at,
        endsAt: r.ends_at,
        currentPrice: r.current_price,
        leaderId: r.leader_id,
        leaderHoldId: r.leader_hold_id,
        bidCount: r.bid_count,
      });
      if (r.leader_id && r.display_name) this.names.set(r.leader_id, r.display_name);
    }
    const max = await this.env.DB.prepare('SELECT COALESCE(MAX(no), 0) AS no FROM auction_lots').first<{ no: number }>();
    this.nextNo = (max?.no ?? 0) + 1;
    this.bag = (await this.ctx.storage.get<string[]>('bag')) ?? [];
  }

  private async loadCatalog() {
    const cards = await this.env.DB.prepare('SELECT id, rarity FROM player_cards WHERE is_active = 1 ORDER BY id').all<{ id: string; rarity: Rarity }>();
    this.catalog = new Map(cards.results.map((c) => [c.id, c.rarity]));
  }

  /** one change of the market at a time (D1 calls let other events in between) */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private connections(): number {
    return this.ctx.getWebSockets().length;
  }

  // ------------------------------------------------------------------ views

  private lotView(l: Lot, viewerId: string | null): AuctionLotView {
    return {
      id: l.id,
      no: l.no,
      playerId: l.playerId,
      rarity: l.rarity,
      status: 'open',
      listedAt: l.listedAt,
      endsAt: l.endsAt,
      currentPrice: l.currentPrice,
      leaderName: l.leaderId ? (this.names.get(l.leaderId) ?? 'プレイヤー') : null,
      leaderIsYou: !!viewerId && l.leaderId === viewerId,
      bidCount: l.bidCount,
      minNextBid: minNextBid(l.currentPrice, l.rules),
      rules: l.rules,
    };
  }

  private marketView(viewerId: string | null): AuctionMarketView {
    return {
      open: this.settings.open,
      mode: this.settings.mode,
      lots: [...this.lots.values()].sort((a, b) => a.no - b.no).map((l) => this.lotView(l, viewerId)),
      serverNow: Date.now(),
      coinsPerGem: this.settings.coinsPerGem,
      concurrentLots: this.settings.concurrentLots,
    };
  }

  private send(ws: WebSocket, msg: AuctionServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closed */
    }
  }

  private sockets(userId?: string): { ws: WebSocket; userId: string }[] {
    const out: { ws: WebSocket; userId: string }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as WsAttachment | null;
      if (a?.userId && (!userId || a.userId === userId)) out.push({ ws, userId: a.userId });
    }
    return out;
  }

  private broadcastLot(l: Lot) {
    const now = Date.now();
    for (const s of this.sockets()) this.send(s.ws, { type: 'lot', lot: this.lotView(l, s.userId), serverNow: now });
  }

  private broadcastMarket() {
    for (const s of this.sockets()) this.send(s.ws, { type: 'market', market: this.marketView(s.userId) });
  }

  private broadcastEnded(l: Lot, status: LotStatus, winnerId: string | null) {
    for (const s of this.sockets()) {
      this.send(s.ws, {
        type: 'ended',
        lotId: l.id,
        status,
        price: status === 'sold' ? l.currentPrice : null,
        winnerName: status === 'sold' && winnerId ? (this.names.get(winnerId) ?? 'プレイヤー') : null,
        winnerIsYou: status === 'sold' && s.userId === winnerId,
      });
    }
  }

  private async walletOf(userId: string): Promise<AuctionWalletView> {
    const row = await this.env.DB.prepare('SELECT balance, held FROM auction_wallets WHERE user_id = ?').bind(userId).first<{ balance: number; held: number }>();
    const balance = row?.balance ?? 0;
    const held = row?.held ?? 0;
    return { balance, held, available: availableFunds(balance, held) };
  }

  private async pushWallet(userId: string) {
    const targets = this.sockets(userId);
    if (targets.length === 0) return;
    const wallet = await this.walletOf(userId);
    for (const s of targets) this.send(s.ws, { type: 'wallet', wallet });
  }

  // ------------------------------------------------------------------ fraud log (spec 7)

  private async logFraud(kind: string, severity: 'info' | 'warn' | 'alert', userId: string | null, lotId: string | null, detail: Record<string, unknown>, ipHash: string | null = null) {
    try {
      await this.env.DB.prepare('INSERT INTO auction_fraud_logs (id, user_id, lot_id, kind, severity, detail_json, ip_hash, created_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(randomId(), userId, lotId, kind, severity, JSON.stringify(detail), ipHash, Date.now())
        .run();
    } catch (err) {
      console.error('auction fraud log failed', err);
    }
  }

  // ------------------------------------------------------------------ the clock

  /** ends lots whose time is up, then lists cards into empty places */
  private async touch(viewer: boolean) {
    const now = Date.now();
    for (const l of [...this.lots.values()]) {
      if (l.endsAt > now) continue;
      if (l.retryAt && l.retryAt > now) continue;
      if (l.leaderId) await this.settle(l);
      else await this.closeUnsold(l, now);
    }
    await this.fill(viewer);
  }

  private async fill(viewer: boolean) {
    const s = this.settings;
    if (!s.open) return;
    // decision 106: nobody watching -> no new listings (lots with bids still end on time)
    if (s.pauseWhenIdle && !viewer && this.connections() === 0) return;
    while (this.lots.size < s.concurrentLots) {
      if (!(await this.listOne())) break;
    }
  }

  private async listOne(): Promise<boolean> {
    const s = this.settings;
    const onMarket = new Set([...this.lots.values()].map((l) => l.playerId));
    let playerId: string | null = null;
    let source: 'random' | 'manual' = 'random';
    if (s.mode === 'manual') {
      // decision 105: the admin's queue, in order
      const row = await this.env.DB.prepare(
        `SELECT q.player_id FROM auction_queue q JOIN player_cards p ON p.id = q.player_id AND p.is_active = 1
          WHERE q.player_id NOT IN (SELECT value FROM json_each(?)) ORDER BY q.position LIMIT 1`,
      )
        .bind(JSON.stringify([...onMarket]))
        .first<{ player_id: string }>();
      if (!row) return false;
      playerId = row.player_id;
      source = 'manual';
    } else {
      const next = nextFromBag(this.bag, [...this.catalog.keys()], onMarket, cryptoRandom);
      this.bag = next.bag;
      playerId = next.playerId;
    }
    if (!playerId) return false;
    const rarity = this.catalog.get(playerId);
    if (!rarity) return false;
    const now = Date.now();
    const lot: Lot = {
      id: randomId(),
      no: this.nextNo,
      playerId,
      rarity,
      source,
      rules: lotRulesOf(s, rarity),
      listedAt: now,
      endsAt: now + s.bidSeconds * 1000,
      currentPrice: null,
      leaderId: null,
      leaderHoldId: null,
      bidCount: 0,
    };
    const stmts = [
      this.env.DB.prepare(
        "INSERT INTO auction_lots (id, no, player_id, rarity, status, source, rules_json, listed_at, ends_at, bid_count, environment) VALUES (?,?,?,?,'open',?,?,?,?,0,?)",
      ).bind(lot.id, lot.no, playerId, rarity, source, JSON.stringify(lot.rules), now, lot.endsAt, this.env.ENVIRONMENT),
    ];
    if (source === 'manual') stmts.push(this.env.DB.prepare('DELETE FROM auction_queue WHERE player_id = ?').bind(playerId));
    try {
      await this.env.DB.batch(stmts);
    } catch (err) {
      console.error('auction listing failed', err);
      // another instance number was used (e.g. a restart): take the next free one
      const max = await this.env.DB.prepare('SELECT COALESCE(MAX(no), 0) AS no FROM auction_lots').first<{ no: number }>();
      this.nextNo = (max?.no ?? 0) + 1;
      return false;
    }
    this.nextNo++;
    this.lots.set(lot.id, lot);
    await this.ctx.storage.put('bag', this.bag);
    this.broadcastLot(lot);
    return true;
  }

  private async closeUnsold(l: Lot, now: number) {
    const opId = randomId();
    const stmts = [
      this.env.DB.prepare("UPDATE auction_lots SET status = 'unsold', closed_at = ?, close_op = ? WHERE id = ? AND status = 'open' AND leader_id IS NULL").bind(now, opId, l.id),
    ];
    // spec 5: an unsold card can be listed again; in the admin's queue it goes to the end
    if (l.source === 'manual' && this.settings.mode === 'manual') {
      stmts.push(
        this.env.DB.prepare(
          "INSERT OR IGNORE INTO auction_queue (player_id, position, added_by, added_at) SELECT ?, COALESCE(MAX(position), 0) + 1, 'relist', ? FROM auction_queue",
        ).bind(l.playerId, now),
      );
    }
    await this.env.DB.batch(stmts);
    this.lots.delete(l.id);
    this.lotNetworks.delete(l.id);
    this.broadcastEnded(l, 'unsold', null);
  }

  /** spec 4: the winner pays and receives the card in one transaction */
  private async settle(l: Lot) {
    const winner = l.leaderId!;
    const price = l.currentPrice!;
    const holdId = l.leaderHoldId!;
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
      const now = Date.now();
      const wallet = await this.env.DB.prepare('SELECT balance, held FROM auction_wallets WHERE user_id = ?').bind(winner).first<{ balance: number; held: number }>();
      const hold = await this.env.DB.prepare('SELECT status, amount FROM auction_holds WHERE id = ?').bind(holdId).first<{ status: string; amount: number }>();
      if (!wallet || !hold || hold.status !== 'active' || hold.amount !== price || wallet.balance < price || wallet.held < price) {
        await this.settleFailed(l, 'payment_not_covered', { balance: wallet?.balance ?? null, held: wallet?.held ?? null, hold: hold?.status ?? null });
        return;
      }
      const owned = await this.env.DB.prepare('SELECT level FROM user_collections WHERE user_id = ? AND player_id = ?').bind(winner, l.playerId).first<{ level: number }>();
      // decision 99: a new card, +1, or premium exchange points when it is already +5
      const outcome: 'new' | 'enhanced' | 'points' = !owned ? 'new' : owned.level < MAX_CARD_LEVEL ? 'enhanced' : 'points';
      const levelAfter = outcome === 'new' ? 0 : outcome === 'enhanced' ? owned!.level + 1 : null;
      const points = outcome === 'points' ? ECONOMY_CONFIG.duplicatePoints[l.rarity] : 0;
      const seqRow = await this.env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM economy_ops WHERE user_id = ?').bind(winner).first<{ seq: number }>();
      const seq = (seqRow?.seq ?? 0) + 1;
      const opId = randomId();
      const metrics = outcome === 'enhanced' ? { card_enhanced: 1 } : {};
      const completed = outcome === 'enhanced' ? await missionsCompletedBy(this.env, winner, metrics, now) : [];
      const db = this.env.DB;
      const stmts: D1PreparedStatement[] = [
        // the per-user operation number: a gacha draw computed from the same collection cannot also commit
        db.prepare("INSERT INTO economy_ops (user_id, seq, op, op_id, created_at) VALUES (?, ?, 'auction_win', ?, ?)").bind(winner, seq, opId, now),
        ...ensureWalletStmts(this.env, winner, now),
        db.prepare("UPDATE auction_lots SET status = 'sold', closed_at = ?, close_op = ? WHERE id = ? AND status = 'open'").bind(now, opId, l.id),
        // one result per lot (primary key): never paid or granted twice
        db.prepare('INSERT INTO auction_results (lot_id, user_id, player_id, rarity, price, outcome, level_after, points, op_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(
          l.id,
          winner,
          l.playerId,
          l.rarity,
          price,
          outcome,
          levelAfter,
          points,
          opId,
          now,
        ),
        db.prepare("UPDATE auction_holds SET status = 'settled', closed_at = ?, close_op = ? WHERE id = ? AND status = 'active'").bind(now, opId, holdId),
        db.prepare('UPDATE auction_wallets SET balance = balance - ?, held = held - ?, updated_at = ? WHERE user_id = ?').bind(price, price, now, winner),
        db.prepare(
          "INSERT INTO auction_transactions (id, user_id, amount, balance_after, reason, ref_type, ref_id, op_id, created_at) SELECT ?, ?, ?, balance, 'win', 'auction_lot', ?, ?, ? FROM auction_wallets WHERE user_id = ?",
        ).bind(randomId(), winner, -price, l.id, opId, now, winner),
      ];
      if (outcome === 'new') {
        stmts.push(db.prepare("INSERT INTO user_collections (user_id, player_id, source, source_ref, obtained_at) VALUES (?, ?, 'auction', ?, ?)").bind(winner, l.playerId, l.id, now));
      } else if (outcome === 'enhanced') {
        stmts.push(
          db.prepare('UPDATE user_collections SET level = ? WHERE user_id = ? AND player_id = ? AND level = ?').bind(levelAfter, winner, l.playerId, owned!.level),
          analyticsWhen(this.env, 'card_enhanced', winner, { lotId: l.id, cards: 1, steps: 1, maxed: levelAfter === MAX_CARD_LEVEL ? 1 : 0, source: 'auction' }, now),
          ...missionProgressStmts(this.env, winner, metrics, now),
          ...missionCompletedAnalytics(this.env, winner, completed, now),
        );
      } else {
        stmts.push(...pointStmts(this.env, { userId: winner, pointType: 'premium', amount: points, reason: 'auction_duplicate', refType: 'auction_lot', refId: l.id, opId, now }));
      }
      stmts.push(analyticsWhen(this.env, 'auction_won', winner, { lotId: l.id, lotNo: l.no, playerId: l.playerId, rarity: l.rarity, price, outcome, bids: l.bidCount }, now));
      try {
        await db.batch(stmts);
      } catch (err) {
        // already settled (restart with stale memory)?
        const row = await db.prepare('SELECT status FROM auction_lots WHERE id = ?').bind(l.id).first<{ status: string }>();
        if (row && row.status !== 'open') {
          this.lots.delete(l.id);
          this.broadcastEnded(l, row.status as LotStatus, row.status === 'sold' ? winner : null);
          return;
        }
        console.warn('auction settlement retried', String(err));
        await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 60)));
        continue;
      }
      this.lots.delete(l.id);
      this.lotNetworks.delete(l.id);
      this.broadcastEnded(l, 'sold', winner);
      for (const s of this.sockets(winner)) this.send(s.ws, { type: 'won', lotId: l.id, playerId: l.playerId, price, levelAfter, points });
      await this.pushWallet(winner);
      return;
    }
    // could not be written now: try again shortly (the hold stays, nobody else can win it)
    l.retryAt = Date.now() + 3_000;
    await this.logFraud('settle_retry', 'warn', winner, l.id, { price });
  }

  /** the winner cannot pay (e.g. a test data reset): nobody pays, the hold is released */
  private async settleFailed(l: Lot, reason: string, detail: Record<string, unknown>) {
    const now = Date.now();
    const opId = randomId();
    await this.releaseAndClose(l, 'cancelled', `settle_failed:${reason}`, opId, now);
    await this.logFraud('settle_failed', 'alert', l.leaderId, l.id, { reason, price: l.currentPrice, ...detail });
    this.lots.delete(l.id);
    this.lotNetworks.delete(l.id);
    this.broadcastEnded(l, 'cancelled', null);
    if (l.leaderId) await this.pushWallet(l.leaderId);
  }

  /** closes a lot without a sale and gives the held coins back */
  private async releaseAndClose(l: Lot, status: 'cancelled', note: string, opId: string, now: number) {
    const db = this.env.DB;
    const stmts = [db.prepare('UPDATE auction_lots SET status = ?, closed_at = ?, close_op = ?, close_note = ? WHERE id = ? AND status = ?').bind(status, now, opId, note, l.id, 'open')];
    if (l.leaderHoldId && l.leaderId) {
      stmts.push(
        db.prepare("UPDATE auction_holds SET status = 'released', closed_at = ?, close_op = ? WHERE id = ? AND status = 'active'").bind(now, opId, l.leaderHoldId),
        db.prepare('UPDATE auction_wallets SET held = MAX(0, held - COALESCE((SELECT amount FROM auction_holds WHERE id = ? AND close_op = ?), 0)), updated_at = ? WHERE user_id = ?').bind(
          l.leaderHoldId,
          opId,
          now,
          l.leaderId,
        ),
      );
    }
    await db.batch(stmts);
  }

  // ------------------------------------------------------------------ bids

  private async bid(body: Record<string, unknown>): Promise<Result> {
    const userId = String(body.userId ?? '');
    const displayName = String(body.displayName ?? '');
    const lotId = String(body.lotId ?? '');
    const amount = body.amount;
    const ipHash = typeof body.ipHash === 'string' ? body.ipHash : null;
    const now = Date.now();
    if (!userId) return fail('BAD_REQUEST', 'user missing');

    // spec 6: repeated bids in a short time are refused and logged
    const recent = (this.recentBids.get(userId) ?? []).filter((t) => t > now - RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX_BIDS) {
      await this.logFraud('rate_limited', 'warn', userId, lotId || null, { bids: recent.length, windowMs: RATE_WINDOW_MS }, ipHash);
      return fail('RATE_LIMITED', '入札が多すぎます。少し待ってからもう一度お試しください', 429);
    }
    recent.push(now);
    this.recentBids.set(userId, recent);

    const lot = this.lots.get(lotId);
    if (lot && lot.endsAt <= now) await this.touch(false);
    const live = this.lots.get(lotId);
    const wallet = await this.walletOf(userId);
    const owned = live ? await this.env.DB.prepare('SELECT level FROM user_collections WHERE user_id = ? AND player_id = ?').bind(userId, live.playerId).first<{ level: number }>() : null;
    const refusal = checkBid({
      lotOpen: !!live,
      endsAt: live?.endsAt ?? 0,
      now,
      currentPrice: live?.currentPrice ?? null,
      leaderId: live?.leaderId ?? null,
      rules: live?.rules ?? lotRulesOf(this.settings, 'common'),
      bidderId: userId,
      amount,
      ownedLevel: owned ? owned.level : null,
      available: wallet.available,
    });
    if (refusal || !live) {
      const code = refusal ?? 'LOT_CLOSED';
      // ordinary races (too low, closed) are information; impossible requests are warnings
      const severity = code === 'BAD_AMOUNT' || code === 'MAX_LEVEL' ? 'warn' : 'info';
      await this.logFraud(`refused:${code}`, severity, userId, lotId || null, { amount, price: live?.currentPrice ?? null, available: wallet.available }, ipHash);
      return fail(code, code, code === 'LOT_CLOSED' ? 409 : 400);
    }

    const bidAmount = amount as number;
    const newEnd = endAfterBid(live.endsAt, now, live.rules);
    const extended = newEnd !== live.endsAt;
    const bidId = randomId();
    const holdId = randomId();
    const opId = randomId();
    const prevLeader = live.leaderId;
    const prevHold = live.leaderHoldId;
    const db = this.env.DB;
    const stmts: D1PreparedStatement[] = [
      db.prepare('INSERT INTO auction_bids (id, lot_id, user_id, amount, bid_no, ends_at_after, extended, ip_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(
        bidId,
        live.id,
        userId,
        bidAmount,
        live.bidCount + 1,
        newEnd,
        extended ? 1 : 0,
        ipHash,
        now,
      ),
    ];
    if (prevHold && prevLeader) {
      // spec 4: the previous highest bidder's coins are free again
      stmts.push(
        db.prepare("UPDATE auction_holds SET status = 'released', closed_at = ?, close_op = ? WHERE id = ? AND status = 'active'").bind(now, opId, prevHold),
        db.prepare('UPDATE auction_wallets SET held = MAX(0, held - COALESCE((SELECT amount FROM auction_holds WHERE id = ? AND close_op = ?), 0)), updated_at = ? WHERE user_id = ?').bind(
          prevHold,
          opId,
          now,
          prevLeader,
        ),
      );
    }
    stmts.push(
      db.prepare("INSERT INTO auction_holds (id, lot_id, user_id, bid_id, amount, status, created_at) VALUES (?,?,?,?,?,'active',?)").bind(holdId, live.id, userId, bidId, bidAmount, now),
      // CHECK (held <= balance): a bid that is not covered fails the whole batch
      db.prepare('UPDATE auction_wallets SET held = held + ?, updated_at = ? WHERE user_id = ?').bind(bidAmount, now, userId),
      db.prepare("UPDATE auction_lots SET current_price = ?, leader_id = ?, leader_hold_id = ?, bid_count = bid_count + 1, ends_at = ? WHERE id = ? AND status = 'open'").bind(
        bidAmount,
        userId,
        holdId,
        newEnd,
        live.id,
      ),
      analyticsWhen(this.env, 'auction_bid', userId, { lotId: live.id, lotNo: live.no, playerId: live.playerId, rarity: live.rarity, amount: bidAmount, bidNo: live.bidCount + 1, extended }, now),
    );
    try {
      await db.batch(stmts);
    } catch (err) {
      const text = String(err);
      const code = /CHECK|constraint/i.test(text) ? 'INSUFFICIENT_FUNDS' : 'INTERNAL';
      await this.logFraud(`refused:${code}`, code === 'INTERNAL' ? 'warn' : 'info', userId, live.id, { amount: bidAmount, error: text.slice(0, 200) }, ipHash);
      return fail(code, code, code === 'INTERNAL' ? 500 : 400);
    }
    live.currentPrice = bidAmount;
    live.leaderId = userId;
    live.leaderHoldId = holdId;
    live.bidCount += 1;
    live.endsAt = newEnd;
    if (displayName) this.names.set(userId, displayName);
    this.broadcastLot(live);
    if (prevLeader && prevLeader !== userId) {
      for (const s of this.sockets(prevLeader)) this.send(s.ws, { type: 'outbid', lotId: live.id, playerId: live.playerId, price: bidAmount });
      await this.pushWallet(prevLeader);
    }
    await this.pushWallet(userId);
    await this.watchNetwork(live, userId, ipHash);
    return { ok: true, lot: this.lotView(live, userId), wallet: await this.walletOf(userId) };
  }

  /** spec 7: several accounts from one network bidding on one lot (possible shill bidding) */
  private async watchNetwork(l: Lot, userId: string, ipHash: string | null) {
    if (!ipHash) return;
    const byNet = this.lotNetworks.get(l.id) ?? new Map<string, Set<string>>();
    this.lotNetworks.set(l.id, byNet);
    const users = byNet.get(ipHash) ?? new Set<string>();
    const isNew = !users.has(userId);
    users.add(userId);
    byNet.set(ipHash, users);
    if (isNew && users.size === 2) await this.logFraud('shared_network', 'alert', userId, l.id, { users: [...users], lotNo: l.no, price: l.currentPrice }, ipHash);
  }

  // ------------------------------------------------------------------ admin

  private async cancel(body: Record<string, unknown>): Promise<Result> {
    const l = this.lots.get(String(body.lotId ?? ''));
    if (!l) return fail('NOT_FOUND', 'the lot is not running', 404);
    const now = Date.now();
    const opId = randomId();
    const reason = String(body.reason ?? '').slice(0, 200);
    await this.releaseAndClose(l, 'cancelled', `admin:${String(body.adminId ?? '')}${reason ? `:${reason}` : ''}`, opId, now);
    this.lots.delete(l.id);
    this.lotNetworks.delete(l.id);
    this.broadcastEnded(l, 'cancelled', null);
    if (l.leaderId) {
      for (const s of this.sockets(l.leaderId)) this.send(s.ws, { type: 'outbid', lotId: l.id, playerId: l.playerId, price: l.currentPrice ?? 0 });
      await this.pushWallet(l.leaderId);
    }
    await this.fill(false);
    return { ok: true, lotId: l.id };
  }

  private async reload(): Promise<Result> {
    this.settings = await auctionSettings(this.env);
    await this.loadCatalog();
    this.broadcastMarket();
    await this.touch(false);
    return { ok: true, settings: this.settings };
  }

  private status(): Result {
    return {
      ok: true,
      settings: this.settings,
      connections: this.connections(),
      lots: [...this.lots.values()].sort((a, b) => a.no - b.no).map((l) => ({ ...this.lotView(l, null), leaderId: l.leaderId, source: l.source })),
      bagRemaining: this.bag.length,
      catalogSize: this.catalog.size,
      nextNo: this.nextNo,
      serverNow: Date.now(),
    };
  }

  // ------------------------------------------------------------------ alarm

  private nextDue(): number | null {
    const watching = this.connections() > 0 || !this.settings.pauseWhenIdle;
    let due: number | null = null;
    for (const l of this.lots.values()) {
      if (!l.leaderId && !watching) continue;
      const t = l.retryAt && l.retryAt > l.endsAt ? l.retryAt : l.endsAt;
      if (due === null || t < due) due = t;
    }
    return due;
  }

  private async scheduleAlarm() {
    const due = this.nextDue();
    if (due) await this.ctx.storage.setAlarm(Math.max(due, Date.now() + 10));
    else await this.ctx.storage.deleteAlarm();
  }

  override async alarm() {
    try {
      await this.exclusive(() => this.touch(false));
    } catch (err) {
      console.error('AuctionDO alarm failed', err);
    }
    await this.scheduleAlarm();
  }

  // ------------------------------------------------------------------ http

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws') return this.acceptWebSocket(request);
    let result: Result;
    try {
      const body = request.method === 'POST' ? ((await request.json()) as Record<string, unknown>) : {};
      switch (url.pathname) {
        case '/market': {
          const userId = url.searchParams.get('userId');
          result = await this.exclusive(async () => {
            await this.touch(true);
            return { ok: true, market: this.marketView(userId) } as Ok;
          });
          break;
        }
        case '/bid':
          result = await this.exclusive(() => this.bid(body));
          break;
        case '/cancel':
          result = await this.exclusive(() => this.cancel(body));
          break;
        case '/reload':
          result = await this.exclusive(() => this.reload());
          break;
        case '/status':
          result = this.status();
          break;
        default:
          result = fail('NOT_FOUND', 'unknown endpoint', 404);
      }
    } catch (err) {
      console.error('AuctionDO error', err);
      result = fail('INTERNAL', 'internal error', 500);
    }
    await this.scheduleAlarm();
    if (result.ok) return Response.json(result);
    return Response.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  }

  // ------------------------------------------------------------------ websocket

  private acceptWebSocket(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const userId = request.headers.get('X-User-Id');
    if (!userId) return new Response('missing user', { status: 403 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId } satisfies WsAttachment);
    // spec 6: a viewer (also after a disconnect) receives the whole current state
    this.send(server, { type: 'market', market: this.marketView(userId) });
    this.ctx.waitUntil(
      this.exclusive(() => this.touch(true))
        .then(() => this.scheduleAlarm())
        .catch((err) => console.error('AuctionDO touch failed', err)),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const a = ws.deserializeAttachment() as WsAttachment | null;
    if (!a?.userId) return;
    let msg: AuctionClientMessage;
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as AuctionClientMessage;
    } catch {
      this.send(ws, { type: 'error', code: 'BAD_MESSAGE' });
      return;
    }
    if (msg.type === 'ping') this.send(ws, { type: 'pong', t: msg.t, serverNow: Date.now() });
    else if (msg.type === 'hello') this.send(ws, { type: 'market', market: this.marketView(a.userId) });
  }

  override async webSocketClose() {
    await this.scheduleAlarm();
  }

  override async webSocketError() {
    await this.scheduleAlarm();
  }
}
