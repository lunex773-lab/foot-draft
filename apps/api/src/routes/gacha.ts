import {
  ECONOMY_CONFIG,
  PPM,
  RARITIES,
  cardRatePpm,
  cryptoRandom,
  pityStatus,
  ratesSum,
  runGacha,
  splitPaidGems,
  type Currency,
  type DrawResult,
  type GachaBannerDef,
  type PityState,
  type Rarity,
} from '@fd/shared';
import { Hono } from 'hono';
import { track } from '../lib/analytics';
import { requireUser } from '../lib/auth';
import { randomId } from '../lib/crypto';
import { analyticsWhen, currencyStmts, missionCompletedAnalytics, missionProgressStmts, missionsCompletedBy, pointStmts, requestIdOf, runOperation, walletOf } from '../lib/economy';
import { ApiError, readJson } from '../lib/http';
import { loadCatalog } from '../lib/players';
import type { AppEnv, Env } from '../env';

/**
 * Gacha (spec 9, decisions 37-39). The server draws (crypto randomness), keeps
 * the pity state, converts duplicates into exchange points and writes the
 * whole draw in one D1 batch (docs/07-phase4-plan.md).
 */
export const gachaRoutes = new Hono<AppEnv>();
gachaRoutes.use('*', requireUser);

interface BannerRow {
  id: string;
  kind: 'standard' | 'premium';
  series_id: string;
  name: string;
  description: string;
  cost_currency: 'COINS' | 'GEMS_PAID';
  cost_single: number;
  cost_multi: number;
  rates_version: number;
  pity_json: string | null;
  starts_at: number;
  ends_at: number | null;
  status: string;
}

async function bannerDef(env: Env, row: BannerRow): Promise<GachaBannerDef> {
  const rates = await env.DB.prepare('SELECT rarity, rate_ppm FROM gacha_probabilities WHERE banner_id = ? AND rates_version = ?')
    .bind(row.id, row.rates_version)
    .all<{ rarity: Rarity; rate_ppm: number }>();
  const ratesPpm = Object.fromEntries(RARITIES.map((r) => [r, 0])) as Record<Rarity, number>;
  for (const r of rates.results) ratesPpm[r.rarity] = r.rate_ppm;
  if (ratesSum(ratesPpm) !== PPM) throw new ApiError('INTERNAL', 'gacha rates do not add up to 100%');
  return {
    id: row.id,
    kind: row.kind,
    seriesId: row.series_id,
    nameJa: row.name,
    descriptionJa: row.description,
    cost: { currency: row.cost_currency, single: row.cost_single, multi: row.cost_multi },
    ratesPpm,
    pity: row.pity_json ? JSON.parse(row.pity_json) : null,
    ratesVersion: row.rates_version,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}

const isOpen = (b: { status: string; starts_at: number; ends_at: number | null }, now: number) => b.status === 'published' && b.starts_at <= now && (b.ends_at === null || b.ends_at > now);

async function bannerRow(env: Env, id: string): Promise<BannerRow> {
  const row = await env.DB.prepare('SELECT * FROM gacha_banners WHERE id = ?').bind(id).first<BannerRow>();
  if (!row || row.status !== 'published') throw new ApiError('NOT_FOUND', 'gacha not found');
  return row;
}

/** cards of the banner by rarity (active cards only) */
async function bannerPoolOf(env: Env, bannerId: string): Promise<Record<Rarity, string[]>> {
  const rows = await env.DB.prepare(
    'SELECT p.id, p.rarity FROM gacha_pool_items g JOIN player_cards p ON p.id = g.player_id WHERE g.banner_id = ? AND p.is_active = 1 ORDER BY p.id',
  )
    .bind(bannerId)
    .all<{ id: string; rarity: Rarity }>();
  const pool = Object.fromEntries(RARITIES.map((r) => [r, [] as string[]])) as Record<Rarity, string[]>;
  for (const r of rows.results) pool[r.rarity].push(r.id);
  return pool;
}

async function pityOf(env: Env, userId: string, seriesId: string): Promise<PityState | null> {
  const row = await env.DB.prepare('SELECT since_epic, since_legendary, toward_bonus, total FROM gacha_pity WHERE user_id = ? AND series_id = ?')
    .bind(userId, seriesId)
    .first<{ since_epic: number; since_legendary: number; toward_bonus: number; total: number }>();
  return row ? { sinceEpic: row.since_epic, sinceLegendary: row.since_legendary, towardBonus: row.toward_bonus, total: row.total } : null;
}

function bannerSummary(b: GachaBannerDef, row: BannerRow, pity: PityState | null, now: number) {
  return {
    id: b.id,
    kind: b.kind,
    seriesId: b.seriesId,
    name: b.nameJa,
    description: b.descriptionJa,
    cost: b.cost,
    ratesPpm: b.ratesPpm,
    ratesVersion: b.ratesVersion,
    pityRules: b.pity,
    pity: pityStatus(b, pity),
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    open: isOpen(row, now),
  };
}

gachaRoutes.get('/banners', async (c) => {
  const user = c.get('user');
  const now = Date.now();
  const rows = await c.env.DB.prepare("SELECT * FROM gacha_banners WHERE status = 'published' AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?) ORDER BY sort_order")
    .bind(now, now)
    .all<BannerRow>();
  const items = [];
  for (const row of rows.results) items.push(bannerSummary(await bannerDef(c.env, row), row, await pityOf(c.env, user.id, row.series_id), now));
  return c.json({ items, wallet: await walletOf(c.env, user.id) });
});

/** transparency page (spec 9-6): rates, every card with its own rate, pity rules and state */
gachaRoutes.get('/banners/:id', async (c) => {
  const user = c.get('user');
  const now = Date.now();
  const row = await bannerRow(c.env, c.req.param('id'));
  const b = await bannerDef(c.env, row);
  const pool = await bannerPoolOf(c.env, b.id);
  const catalog = new Map((await loadCatalog(c.env)).map((p) => [p.id, p]));
  const owned = new Set(
    (await c.env.DB.prepare('SELECT player_id FROM user_collections WHERE user_id = ?').bind(user.id).all<{ player_id: string }>()).results.map((r) => r.player_id),
  );
  const cards = RARITIES.flatMap((r) =>
    pool[r].map((id) => {
      const p = catalog.get(id);
      return { playerId: id, name: p?.name ?? id, rarity: r, position: p?.primaryPosition ?? null, ovr: p?.ovr ?? null, ratePpm: cardRatePpm(b, pool, r), owned: owned.has(id) };
    }),
  );
  return c.json({
    banner: bannerSummary(b, row, await pityOf(c.env, user.id, b.seriesId), now),
    counts: Object.fromEntries(RARITIES.map((r) => [r, pool[r].length])),
    cards,
    duplicatePoints: { type: b.kind, values: ECONOMY_CONFIG.duplicatePoints },
    paidGemsSpendOrder: b.cost.currency === 'GEMS_PAID' ? ECONOMY_CONFIG.paidGemsSpendOrder : null,
  });
});

interface DrawResponse {
  drawId: string;
  bannerId: string;
  count: number;
  cost: { currency: 'COINS' | 'GEMS_PAID'; amount: number; split: Partial<Record<Currency, number>> };
  results: (DrawResult & { name: string })[];
  pointsGained: { type: 'standard' | 'premium'; amount: number };
  pity: ReturnType<typeof pityStatus>;
  ratesVersion: number;
  wallet: Awaited<ReturnType<typeof walletOf>>;
  missionsCompleted: string[];
}

gachaRoutes.post('/banners/:id/draw', async (c) => {
  const user = c.get('user');
  const body = await readJson<{ count?: unknown; requestId?: unknown }>(c);
  const count = body.count === 10 ? 10 : body.count === 1 ? 1 : 0;
  if (!count) throw new ApiError('BAD_REQUEST', 'count must be 1 or 10');
  const requestId = requestIdOf(body.requestId);
  const row = await bannerRow(c.env, c.req.param('id'));
  if (!isOpen(row, Date.now())) throw new ApiError('CONFLICT', 'this gacha is not open');
  const banner = await bannerDef(c.env, row);
  const pool = await bannerPoolOf(c.env, banner.id);
  const names = new Map((await loadCatalog(c.env)).map((p) => [p.id, p.name]));
  await track(c.env, { name: 'gacha_started', userId: user.id, properties: { bannerId: banner.id, count } });

  const result = await runOperation<DrawResponse>(c.env, user.id, requestId, 'gacha', async ({ opId, now }) => {
    const wallet = await walletOf(c.env, user.id);
    const cost = count === 10 ? banner.cost.multi : banner.cost.single;
    let split: Partial<Record<Currency, number>> | null;
    if (banner.cost.currency === 'COINS') split = wallet.coins >= cost ? { COINS: cost } : null;
    else split = splitPaidGems(cost, { GEMS_PAID_GRANTED: wallet.gems.paidGranted, GEMS_PAID_PURCHASED: wallet.gems.paidPurchased });
    if (!split) throw new ApiError('INSUFFICIENT_FUNDS', banner.cost.currency === 'COINS' ? 'not enough COINS' : 'not enough PAID GEMS');
    const owned = new Set(
      (await c.env.DB.prepare('SELECT player_id FROM user_collections WHERE user_id = ?').bind(user.id).all<{ player_id: string }>()).results.map((r) => r.player_id),
    );
    const pityBefore = await pityOf(c.env, user.id, banner.seriesId);
    const run = runGacha(banner, pool, owned, pityBefore, count, cryptoRandom());
    const drawId = randomId();
    const metrics = { gacha_draw: count };
    const completed = await missionsCompletedBy(c.env, user.id, metrics, now);
    const stmts: D1PreparedStatement[] = [];
    for (const [currency, amount] of Object.entries(split) as [Currency, number][]) {
      stmts.push(...currencyStmts(c.env, { userId: user.id, currency, amount: -amount, reason: 'gacha', refType: 'gacha_draw', refId: drawId, opId, now }));
    }
    stmts.push(
      c.env.DB.prepare(
        'INSERT INTO gacha_draws (id, user_id, banner_id, series_id, draw_count, cost_currency, cost_amount, cost_split_json, rates_version, pity_before_json, pity_after_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(drawId, user.id, banner.id, banner.seriesId, count, banner.cost.currency, cost, JSON.stringify(split), banner.ratesVersion, pityBefore ? JSON.stringify(pityBefore) : null, run.pity ? JSON.stringify(run.pity) : null, now),
    );
    // all cards of the draw in one statement each (bound parameters stay small)
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO gacha_history (draw_id, idx, user_id, player_id, rarity, guarantee, is_free, is_duplicate, point_type, points, created_at)
         SELECT ?1, j.key, ?2, json_extract(j.value, '$.playerId'), json_extract(j.value, '$.rarity'), json_extract(j.value, '$.guarantee'),
                json_extract(j.value, '$.free'), json_extract(j.value, '$.duplicate'), json_extract(j.value, '$.pointType'), json_extract(j.value, '$.points'), ?3
           FROM json_each(?4) j`,
      ).bind(drawId, user.id, now, JSON.stringify(run.results.map((r) => ({ ...r, free: r.free ? 1 : 0, duplicate: r.duplicate ? 1 : 0 })))),
    );
    const newCards = run.results.filter((r) => !r.duplicate).map((r) => r.playerId);
    if (newCards.length > 0) {
      // a card owned before this operation makes the batch fail (primary key) and the draw is computed again
      stmts.push(
        c.env.DB.prepare("INSERT INTO user_collections (user_id, player_id, source, source_ref, obtained_at) SELECT ?1, j.value, 'gacha', ?2, ?3 FROM json_each(?4) j").bind(
          user.id,
          drawId,
          now,
          JSON.stringify(newCards),
        ),
      );
    }
    if (run.pointsTotal > 0) {
      stmts.push(...pointStmts(c.env, { userId: user.id, pointType: banner.kind, amount: run.pointsTotal, reason: 'duplicate', refType: 'gacha_draw', refId: drawId, opId, now }));
      stmts.push(analyticsWhen(c.env, 'duplicate_converted', user.id, { drawId, pointType: banner.kind, points: run.pointsTotal, cards: run.results.filter((r) => r.duplicate).length }, now));
    }
    if (run.pity) {
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO gacha_pity (user_id, series_id, since_epic, since_legendary, toward_bonus, total, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7)
           ON CONFLICT (user_id, series_id) DO UPDATE SET since_epic = ?3, since_legendary = ?4, toward_bonus = ?5, total = ?6, updated_at = ?7`,
        ).bind(user.id, banner.seriesId, run.pity.sinceEpic, run.pity.sinceLegendary, run.pity.towardBonus, run.pity.total, now),
      );
    }
    stmts.push(...missionProgressStmts(c.env, user.id, metrics, now), ...missionCompletedAnalytics(c.env, user.id, completed, now));
    stmts.push(
      analyticsWhen(
        c.env,
        'gacha_completed',
        user.id,
        {
          drawId,
          bannerId: banner.id,
          count,
          ratesVersion: banner.ratesVersion,
          rarities: Object.fromEntries(RARITIES.map((r) => [r, run.results.filter((x) => x.rarity === r).length])),
          guarantees: run.results.filter((x) => x.guarantee !== 'none').map((x) => x.guarantee),
          duplicates: run.results.filter((x) => x.duplicate).length,
          cost,
          currency: banner.cost.currency,
        },
        now,
      ),
    );
    const after = { ...wallet };
    const spent = (k: Currency) => split![k] ?? 0;
    const response: DrawResponse = {
      drawId,
      bannerId: banner.id,
      count,
      cost: { currency: banner.cost.currency, amount: cost, split },
      results: run.results.map((r) => ({ ...r, name: names.get(r.playerId) ?? r.playerId })),
      pointsGained: { type: banner.kind, amount: run.pointsTotal },
      pity: pityStatus(banner, run.pity),
      ratesVersion: banner.ratesVersion,
      wallet: {
        coins: after.coins - spent('COINS'),
        gems: {
          free: after.gems.free,
          paidPurchased: after.gems.paidPurchased - spent('GEMS_PAID_PURCHASED'),
          paidGranted: after.gems.paidGranted - spent('GEMS_PAID_GRANTED'),
          paid: after.gems.paid - spent('GEMS_PAID_PURCHASED') - spent('GEMS_PAID_GRANTED'),
          total: after.gems.total - spent('GEMS_PAID_PURCHASED') - spent('GEMS_PAID_GRANTED'),
        },
        points: { ...after.points, [banner.kind]: after.points[banner.kind] + run.pointsTotal },
      },
      missionsCompleted: completed,
    };
    return { statements: stmts, response };
  });
  return c.json(result);
});

/** draw history (spec 9-6) */
gachaRoutes.get('/history', async (c) => {
  const user = c.get('user');
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 200);
  const rows = await c.env.DB.prepare(
    `SELECT h.draw_id, h.idx, h.player_id, p.name, h.rarity, h.guarantee, h.is_free, h.is_duplicate, h.point_type, h.points, h.created_at, d.banner_id, b.name AS banner_name, d.rates_version
       FROM gacha_history h JOIN gacha_draws d ON d.id = h.draw_id JOIN gacha_banners b ON b.id = d.banner_id JOIN player_cards p ON p.id = h.player_id
      WHERE h.user_id = ? ORDER BY h.created_at DESC, h.idx ASC LIMIT ?`,
  )
    .bind(user.id, limit)
    .all();
  return c.json({ items: rows.results });
});
