import { ECONOMY_CONFIG, RARITIES, type PointType, type Rarity } from '@fd/shared';
import { Hono } from 'hono';
import { track } from '../lib/analytics';
import { requireUser } from '../lib/auth';
import { randomId } from '../lib/crypto';
import { analyticsWhen, pointStmts, requestIdOf, runOperation, walletOf } from '../lib/economy';
import { ApiError, readJson } from '../lib/http';
import { loadCatalog } from '../lib/players';
import type { AppEnv, Env } from '../env';
import { ensureStarter } from '../lib/team';
import { createRoom, joinOpenRoom } from './rooms';

/**
 * Collection (spec 2-4, 9), the exchange shop (spec 9-5, decision 43) and
 * Collection Draft matchmaking (decision 36).
 */
export const collectionRoutes = new Hono<AppEnv>();
collectionRoutes.use('*', requireUser);

async function rosterOf(env: Env, userId: string): Promise<(string | null)[]> {
  const rows = await env.DB.prepare('SELECT slot, player_id FROM collection_draft_rosters WHERE user_id = ? ORDER BY slot').bind(userId).all<{ slot: number; player_id: string }>();
  const slots: (string | null)[] = Array.from({ length: ECONOMY_CONFIG.collectionDraftSlots }, () => null);
  for (const r of rows.results) slots[r.slot - 1] = r.player_id;
  return slots;
}

/** owned cards, Collection Draft roster and the size of the whole catalog */
collectionRoutes.get('/', async (c) => {
  const user = c.get('user');
  await ensureStarter(c.env, user.id);
  const rows = await c.env.DB.prepare('SELECT player_id, source, obtained_at, level, favorite FROM user_collections WHERE user_id = ? ORDER BY obtained_at DESC').bind(user.id).all<{
    player_id: string;
    source: string;
    obtained_at: number;
    level: number;
    favorite: number;
  }>();
  const catalog = await loadCatalog(c.env);
  const total = Object.fromEntries(RARITIES.map((r) => [r, catalog.filter((p) => p.rarity === r).length])) as Record<Rarity, number>;
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const owned = rows.results.filter((r) => byId.has(r.player_id));
  const ownedByRarity = Object.fromEntries(RARITIES.map((r) => [r, owned.filter((o) => byId.get(o.player_id)!.rarity === r).length])) as Record<Rarity, number>;
  return c.json({
    items: owned.map((r) => ({ playerId: r.player_id, source: r.source, obtainedAt: r.obtained_at, level: r.level, favorite: r.favorite === 1 })),
    roster: await rosterOf(c.env, user.id),
    slots: ECONOMY_CONFIG.collectionDraftSlots,
    counts: { owned: owned.length, total: catalog.length, ownedByRarity, totalByRarity: total },
  });
});

/** register up to 3 owned cards for Collection Draft (decision 36) */
collectionRoutes.put('/roster', async (c) => {
  const user = c.get('user');
  const body = await readJson<{ playerIds?: unknown }>(c);
  if (!Array.isArray(body.playerIds) || body.playerIds.some((x) => typeof x !== 'string')) throw new ApiError('BAD_REQUEST', 'playerIds must be a list of player ids');
  const ids = body.playerIds as string[];
  if (ids.length > ECONOMY_CONFIG.collectionDraftSlots) throw new ApiError('BAD_REQUEST', `at most ${ECONOMY_CONFIG.collectionDraftSlots} cards`);
  if (new Set(ids).size !== ids.length) throw new ApiError('BAD_REQUEST', 'the same card twice');
  if (ids.length > 0) {
    const owned = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM user_collections WHERE user_id = ? AND player_id IN (${ids.map(() => '?').join(',')})`)
      .bind(user.id, ...ids)
      .first<{ n: number }>();
    if ((owned?.n ?? 0) !== ids.length) throw new ApiError('FORBIDDEN', 'only owned cards can be registered');
  }
  const now = Date.now();
  const before = await rosterOf(c.env, user.id);
  const added = ids.filter((id) => !before.includes(id));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM collection_draft_rosters WHERE user_id = ?').bind(user.id),
    ...(ids.length
      ? [
          c.env.DB.prepare(
            'INSERT INTO collection_draft_rosters (user_id, slot, player_id, updated_at) SELECT ?1, j.key + 1, j.value, ?2 FROM json_each(?3) j',
          ).bind(user.id, now, JSON.stringify(ids)),
        ]
      : []),
    ...(added.length ? [analyticsWhen(c.env, 'collection_player_registered', user.id, { playerIds: added, slots: ids.length }, now)] : []),
  ]);
  return c.json({ roster: await rosterOf(c.env, user.id) });
});

/** Collection Draft matchmaking: join an open Collection Draft room or create one */
collectionRoutes.post('/draft/quick', async (c) => {
  const user = c.get('user');
  // settings are only test timings, honoured outside production (see createRoom)
  const body = await readJson<{ settings?: Record<string, unknown> }>(c).catch(() => ({}) as { settings?: Record<string, unknown> });
  await track(c.env, { name: 'mode_selected', userId: user.id, properties: { mode: 'collection' } });
  const joined = await joinOpenRoom(c.env, user, "mode = 'collection'", []);
  if (joined) return c.json(joined);
  return c.json(await createRoom(c.env, user, 'collection', (body.settings ?? {}) as never, { variant: { kind: 'collection' } }), 201);
});

// ---------------------------------------------------------------- exchange shop

export const exchangeRoutes = new Hono<AppEnv>();
exchangeRoutes.use('*', requireUser);

const POINT_TYPES: PointType[] = ['standard', 'premium'];

async function catalogPrices(env: Env): Promise<Map<string, number>> {
  const rows = await env.DB.prepare('SELECT point_type, rarity, price FROM exchange_catalog WHERE active = 1').all<{ point_type: PointType; rarity: Rarity; price: number }>();
  return new Map(rows.results.map((r) => [`${r.point_type}|${r.rarity}`, r.price]));
}

/** what each kind of point can buy (cards not owned yet) */
exchangeRoutes.get('/catalog', async (c) => {
  const user = c.get('user');
  const prices = await catalogPrices(c.env);
  const owned = new Set(
    (await c.env.DB.prepare('SELECT player_id FROM user_collections WHERE user_id = ?').bind(user.id).all<{ player_id: string }>()).results.map((r) => r.player_id),
  );
  const catalog = await loadCatalog(c.env);
  const wallet = await walletOf(c.env, user.id);
  return c.json({
    points: wallet.points,
    sections: POINT_TYPES.map((t) => ({
      pointType: t,
      prices: RARITIES.filter((r) => prices.has(`${t}|${r}`)).map((r) => ({ rarity: r, price: prices.get(`${t}|${r}`)! })),
      cards: catalog.filter((p) => prices.has(`${t}|${p.rarity}`) && !owned.has(p.id)).map((p) => ({ playerId: p.id, rarity: p.rarity, price: prices.get(`${t}|${p.rarity}`)! })),
    })),
  });
});

interface RedeemResponse {
  redemptionId: string;
  playerId: string;
  pointType: PointType;
  price: number;
  wallet: Awaited<ReturnType<typeof walletOf>>;
}

exchangeRoutes.post('/redeem', async (c) => {
  const user = c.get('user');
  const body = await readJson<{ playerId?: unknown; pointType?: unknown; requestId?: unknown }>(c);
  const requestId = requestIdOf(body.requestId);
  const pointType = body.pointType as PointType;
  if (!POINT_TYPES.includes(pointType)) throw new ApiError('BAD_REQUEST', 'pointType must be standard or premium');
  const player = (await loadCatalog(c.env)).find((p) => p.id === body.playerId);
  if (!player) throw new ApiError('NOT_FOUND', 'card not found');
  const price = (await catalogPrices(c.env)).get(`${pointType}|${player.rarity}`);
  if (!price) throw new ApiError('BAD_REQUEST', `${player.rarity} cards cannot be exchanged for ${pointType} points`);

  const result = await runOperation<RedeemResponse>(c.env, user.id, requestId, 'exchange', async ({ opId, now }) => {
    const owned = await c.env.DB.prepare('SELECT 1 AS x FROM user_collections WHERE user_id = ? AND player_id = ?').bind(user.id, player.id).first();
    if (owned) throw new ApiError('CONFLICT', 'you already own this card');
    const wallet = await walletOf(c.env, user.id);
    if (wallet.points[pointType] < price) throw new ApiError('INSUFFICIENT_FUNDS', `not enough ${pointType} points`);
    const redemptionId = randomId();
    const statements = [
      ...pointStmts(c.env, { userId: user.id, pointType, amount: -price, reason: 'redeem', refType: 'exchange_redemption', refId: redemptionId, opId, now }),
      c.env.DB.prepare("INSERT INTO user_collections (user_id, player_id, source, source_ref, obtained_at) VALUES (?,?,'exchange',?,?)").bind(user.id, player.id, redemptionId, now),
      c.env.DB.prepare('INSERT INTO exchange_redemptions (id, user_id, point_type, player_id, price, created_at) VALUES (?,?,?,?,?,?)').bind(redemptionId, user.id, pointType, player.id, price, now),
      analyticsWhen(c.env, 'exchange_completed', user.id, { redemptionId, pointType, playerId: player.id, rarity: player.rarity, price }, now),
    ];
    return {
      statements,
      response: { redemptionId, playerId: player.id, pointType, price, wallet: { ...wallet, points: { ...wallet.points, [pointType]: wallet.points[pointType] - price } } },
    };
  });
  return c.json(result);
});

exchangeRoutes.get('/history', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT e.id, e.point_type, e.player_id, p.name, p.rarity, e.price, e.created_at FROM exchange_redemptions e JOIN player_cards p ON p.id = e.player_id WHERE e.user_id = ? ORDER BY e.created_at DESC LIMIT 100',
  )
    .bind(user.id)
    .all();
  return c.json({ items: rows.results });
});
