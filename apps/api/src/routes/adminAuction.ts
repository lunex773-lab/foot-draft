import { RARITIES, validateAuctionSettings } from '@fd/shared';
import { Hono } from 'hono';
import { AUCTION_SETTINGS_KEY, auctionSettings } from '../lib/auction';
import { audit, auditStatement, ipOf } from '../lib/audit';
import { can, requirePermission } from '../lib/auth';
import { ApiError, readJson } from '../lib/http';
import type { AppEnv } from '../env';
import { callAuction } from './auction';

/**
 * Admin site: PLAYER AUCTION (spec 7, decision 105). Aggregated figures for
 * auction.read; anything naming a player (balances, bids, winners, fraud log)
 * also needs users.wallet. Changes need auction.write and are audit-logged.
 */
export const adminAuctionRoutes = new Hono<AppEnv>();

const DAY = 86_400_000;

const clampInt = (v: string | undefined, def: number, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isInteger(n) ? Math.max(lo, Math.min(hi, n)) : def;
};

/** spec 7: total and average prices, by rarity, the live market */
adminAuctionRoutes.get('/auction/overview', requirePermission('auction.read'), async (c) => {
  const days = clampInt(c.req.query('days'), 30, 1, 365);
  const since = Date.now() - days * DAY;
  const db = c.env.DB;
  const [totals, byRarity, lotCounts, wallets, fraud, exchange, status] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS sold, COALESCE(SUM(price), 0) AS total, COALESCE(AVG(price), 0) AS avg, COALESCE(MAX(price), 0) AS max FROM auction_results WHERE created_at >= ?').bind(since).first<{ sold: number; total: number; avg: number; max: number }>(),
    db.prepare('SELECT rarity, COUNT(*) AS sold, AVG(price) AS avg, MIN(price) AS min, MAX(price) AS max FROM auction_results WHERE created_at >= ? GROUP BY rarity').bind(since).all<{ rarity: string; sold: number; avg: number; min: number; max: number }>(),
    db.prepare('SELECT status, COUNT(*) AS n FROM auction_lots WHERE listed_at >= ? GROUP BY status').bind(since).all<{ status: string; n: number }>(),
    db.prepare('SELECT COUNT(*) AS users, COALESCE(SUM(balance), 0) AS balance, COALESCE(SUM(held), 0) AS held FROM auction_wallets').first<{ users: number; balance: number; held: number }>(),
    db.prepare('SELECT severity, COUNT(*) AS n FROM auction_fraud_logs WHERE created_at >= ? GROUP BY severity').bind(Date.now() - DAY).all<{ severity: string; n: number }>(),
    db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS coins FROM auction_transactions WHERE reason = 'exchange' AND created_at >= ?").bind(since).first<{ n: number; coins: number }>(),
    callAuction<Record<string, unknown>>(c.env, '/status'),
  ]);
  const bids = await db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS users FROM auction_bids WHERE created_at >= ?').bind(since).first<{ n: number; users: number }>();
  return c.json({
    days,
    totals: { sold: totals?.sold ?? 0, totalPrice: totals?.total ?? 0, averagePrice: Math.round(totals?.avg ?? 0), maxPrice: totals?.max ?? 0, bids: bids?.n ?? 0, bidders: bids?.users ?? 0 },
    byRarity: RARITIES.map((r) => {
      const x = byRarity.results.find((b) => b.rarity === r);
      return { rarity: r, sold: x?.sold ?? 0, averagePrice: Math.round(x?.avg ?? 0), minPrice: x?.min ?? 0, maxPrice: x?.max ?? 0 };
    }),
    lots: Object.fromEntries(lotCounts.results.map((r) => [r.status, r.n])),
    wallets: { users: wallets?.users ?? 0, balance: wallets?.balance ?? 0, held: wallets?.held ?? 0 },
    exchange: { count: exchange?.n ?? 0, coins: exchange?.coins ?? 0 },
    fraud24h: Object.fromEntries(fraud.results.map((r) => [r.severity, r.n])),
    market: status,
  });
});

/** spec 7: prices by player, and players that did not sell */
adminAuctionRoutes.get('/auction/players', requirePermission('auction.read'), async (c) => {
  const days = clampInt(c.req.query('days'), 30, 1, 365);
  const since = Date.now() - days * DAY;
  const rows = await c.env.DB.prepare(
    `SELECT l.player_id, p.name, p.rarity, p.ovr, p.primary_position,
            COUNT(*) AS listed,
            SUM(CASE WHEN l.status = 'sold' THEN 1 ELSE 0 END) AS sold,
            SUM(CASE WHEN l.status = 'unsold' THEN 1 ELSE 0 END) AS unsold,
            AVG(r.price) AS avg_price, MIN(r.price) AS min_price, MAX(r.price) AS max_price,
            (SELECT r2.price FROM auction_results r2 WHERE r2.player_id = l.player_id ORDER BY r2.created_at DESC LIMIT 1) AS last_price
       FROM auction_lots l JOIN player_cards p ON p.id = l.player_id LEFT JOIN auction_results r ON r.lot_id = l.id
      WHERE l.listed_at >= ? AND l.status <> 'open'
      GROUP BY l.player_id ORDER BY sold DESC, avg_price DESC`,
  )
    .bind(since)
    .all<{ player_id: string; name: string; rarity: string; ovr: number; primary_position: string; listed: number; sold: number; unsold: number; avg_price: number | null; min_price: number | null; max_price: number | null; last_price: number | null }>();
  return c.json({
    days,
    players: rows.results.map((r) => ({
      playerId: r.player_id,
      name: r.name,
      rarity: r.rarity,
      ovr: r.ovr,
      position: r.primary_position,
      listed: r.listed,
      sold: r.sold,
      unsold: r.unsold,
      averagePrice: r.avg_price === null ? null : Math.round(r.avg_price),
      minPrice: r.min_price,
      maxPrice: r.max_price,
      lastPrice: r.last_price,
    })),
  });
});

/** lots (newest first); winner names need users.wallet */
adminAuctionRoutes.get('/auction/lots', requirePermission('auction.read'), async (c) => {
  const status = c.req.query('status');
  const limit = clampInt(c.req.query('limit'), 50, 1, 200);
  const offset = clampInt(c.req.query('offset'), 0, 0, 100_000);
  const showUsers = can(c.get('admin').role, 'users.wallet');
  const where = status && ['open', 'sold', 'unsold', 'cancelled'].includes(status) ? 'WHERE l.status = ?' : '';
  const stmt = c.env.DB.prepare(
    `SELECT l.id, l.no, l.player_id, p.name, l.rarity, l.status, l.source, l.listed_at, l.ends_at, l.closed_at, l.current_price, l.bid_count, l.close_note,
            u.username AS leader_username, r.outcome, r.level_after
       FROM auction_lots l JOIN player_cards p ON p.id = l.player_id
       LEFT JOIN users u ON u.id = l.leader_id LEFT JOIN auction_results r ON r.lot_id = l.id
       ${where} ORDER BY l.no DESC LIMIT ? OFFSET ?`,
  );
  const rows = await (where ? stmt.bind(status, limit, offset) : stmt.bind(limit, offset)).all<Record<string, unknown>>();
  return c.json({ lots: rows.results.map((r) => ({ ...r, leader_username: showUsers ? r.leader_username : undefined })) });
});

/** spec 7: bid history (by user name, lot number or player) */
adminAuctionRoutes.get('/auction/bids', requirePermission('auction.read'), requirePermission('users.wallet'), async (c) => {
  const limit = clampInt(c.req.query('limit'), 100, 1, 500);
  const conds: string[] = [];
  const binds: unknown[] = [];
  const username = c.req.query('username');
  const lotNo = c.req.query('lotNo');
  const playerId = c.req.query('playerId');
  if (username) {
    conds.push('u.username = ?');
    binds.push(username);
  }
  if (lotNo && Number.isInteger(Number(lotNo))) {
    conds.push('l.no = ?');
    binds.push(Number(lotNo));
  }
  if (playerId) {
    conds.push('l.player_id = ?');
    binds.push(playerId);
  }
  const rows = await c.env.DB.prepare(
    `SELECT b.id, b.lot_id, l.no, l.player_id, p.name, l.rarity, b.amount, b.bid_no, b.extended, b.created_at, u.username, u.display_name, l.status, l.leader_id = b.user_id AS leading
       FROM auction_bids b JOIN auction_lots l ON l.id = b.lot_id JOIN users u ON u.id = b.user_id JOIN player_cards p ON p.id = l.player_id
       ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY b.created_at DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all();
  return c.json({ bids: rows.results });
});

/** spec 7: coins by player */
adminAuctionRoutes.get('/auction/balances', requirePermission('auction.read'), requirePermission('users.wallet'), async (c) => {
  const limit = clampInt(c.req.query('limit'), 100, 1, 500);
  const q = c.req.query('q');
  const rows = await c.env.DB.prepare(
    `SELECT u.username, u.display_name, w.balance, w.held, w.balance - w.held AS available, w.updated_at,
            (SELECT COALESCE(SUM(-amount), 0) FROM auction_transactions t WHERE t.user_id = w.user_id AND t.reason = 'win') AS spent,
            (SELECT COALESCE(SUM(amount), 0) FROM auction_transactions t WHERE t.user_id = w.user_id AND t.reason = 'exchange') AS exchanged,
            (SELECT COUNT(*) FROM auction_results r WHERE r.user_id = w.user_id) AS wins
       FROM auction_wallets w JOIN users u ON u.id = w.user_id
      ${q ? 'WHERE u.username LIKE ? OR u.display_name LIKE ?' : ''}
      ORDER BY w.balance DESC LIMIT ?`,
  )
    .bind(...(q ? [`%${q}%`, `%${q}%`] : []), limit)
    .all();
  return c.json({ balances: rows.results });
});

/** spec 7: fraud detection log */
adminAuctionRoutes.get('/auction/fraud', requirePermission('auction.read'), requirePermission('users.wallet'), async (c) => {
  const limit = clampInt(c.req.query('limit'), 100, 1, 500);
  const severity = c.req.query('severity');
  const conds: string[] = [];
  const binds: unknown[] = [];
  if (severity && ['info', 'warn', 'alert'].includes(severity)) {
    conds.push('f.severity = ?');
    binds.push(severity);
  } else if (c.req.query('all') !== '1') {
    // the ordinary refusals (too low, closed) are many: warnings and alerts by default
    conds.push("f.severity IN ('warn', 'alert')");
  }
  const rows = await c.env.DB.prepare(
    `SELECT f.id, f.kind, f.severity, f.detail_json, f.ip_hash, f.created_at, u.username, l.no AS lot_no
       FROM auction_fraud_logs f LEFT JOIN users u ON u.id = f.user_id LEFT JOIN auction_lots l ON l.id = f.lot_id
      ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY f.created_at DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all();
  return c.json({ logs: rows.results });
});

// ------------------------------------------------------------------ operation (decision 105)

adminAuctionRoutes.get('/auction/settings', requirePermission('auction.read'), async (c) => {
  const row = await c.env.DB.prepare('SELECT updated_at, updated_by FROM app_settings WHERE key = ?').bind(AUCTION_SETTINGS_KEY).first<{ updated_at: number; updated_by: string | null }>();
  return c.json({ settings: await auctionSettings(c.env), updatedAt: row?.updated_at ?? null });
});

/** all settings in one (open / pause and the listing mode are fields of it) */
adminAuctionRoutes.put('/auction/settings', requirePermission('auction.write'), async (c) => {
  const admin = c.get('admin');
  const body = await readJson<Record<string, unknown>>(c);
  const before = await auctionSettings(c.env);
  const v = validateAuctionSettings(body, before);
  if (!v.ok) throw new ApiError('VALIDATION', `invalid: ${v.errors.join(', ')}`);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO app_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at',
    ).bind(AUCTION_SETTINGS_KEY, JSON.stringify(v.settings), admin.id, now),
    auditStatement(c.env, admin.id, 'auction.settings', { type: 'auction', id: 'settings' }, { before, after: v.settings }, ipOf(c)),
  ]);
  await callAuction(c.env, '/reload', {});
  return c.json({ settings: v.settings, updatedAt: now });
});

/** decision 105: the cards an admin chose (listing mode "manual") */
adminAuctionRoutes.get('/auction/queue', requirePermission('auction.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT q.player_id, q.position, q.added_by, q.added_at, p.name, p.rarity, p.ovr, p.primary_position FROM auction_queue q JOIN player_cards p ON p.id = q.player_id ORDER BY q.position',
  ).all();
  return c.json({ queue: rows.results });
});

adminAuctionRoutes.put('/auction/queue', requirePermission('auction.write'), async (c) => {
  const admin = c.get('admin');
  const body = await readJson<{ playerIds?: unknown }>(c);
  const ids = body.playerIds;
  if (!Array.isArray(ids) || ids.length > 300 || ids.some((id) => typeof id !== 'string')) throw new ApiError('VALIDATION', 'playerIds must be a list of card ids (at most 300)');
  const unique = [...new Set(ids as string[])];
  const known = await c.env.DB.prepare('SELECT id FROM player_cards WHERE is_active = 1 AND id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(unique)).all<{ id: string }>();
  const knownSet = new Set(known.results.map((r) => r.id));
  const unknown = unique.filter((id) => !knownSet.has(id));
  if (unknown.length) throw new ApiError('VALIDATION', `unknown cards: ${unknown.slice(0, 5).join(', ')}`);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM auction_queue'),
    ...(unique.length
      ? [
          c.env.DB.prepare('INSERT INTO auction_queue (player_id, position, added_by, added_at) SELECT j.value, j.key + 1, ?, ? FROM json_each(?) j').bind(admin.id, now, JSON.stringify(unique)),
        ]
      : []),
    auditStatement(c.env, admin.id, 'auction.queue', { type: 'auction', id: 'queue' }, { count: unique.length, first: unique.slice(0, 10) }, ipOf(c)),
  ]);
  await callAuction(c.env, '/reload', {});
  return c.json({ count: unique.length });
});

/** decision 105: cancel a running lot (holds released, nobody pays) */
adminAuctionRoutes.post('/auction/lots/:id/cancel', requirePermission('auction.write'), async (c) => {
  const admin = c.get('admin');
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : '';
  const id = c.req.param('id');
  const res = await callAuction(c.env, '/cancel', { lotId: id, adminId: admin.id, reason });
  await audit(c.env, admin.id, 'auction.cancel', { type: 'auction_lot', id }, { reason }, ipOf(c));
  return c.json(res);
});
