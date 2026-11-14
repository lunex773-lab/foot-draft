import { PPM, RARITIES, ratesSum, type Rarity } from '@fd/shared';
import { Hono } from 'hono';
import { audit, auditStatement, ipOf } from '../lib/audit';
import { requirePermission } from '../lib/auth';
import { ApiError, readJson, str } from '../lib/http';
import { loadCatalog } from '../lib/players';
import type { AppEnv, Env } from '../env';

/**
 * Gacha management (spec 18-8, decision 58): create drafts, publish, edit and
 * end banners. A change of a published banner becomes a new version: its
 * rates, pool, cost, pity and period are kept in gacha_banner_versions and
 * every draw records the version it used.
 */
export const adminGachaRoutes = new Hono<AppEnv>();

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
  status: 'draft' | 'published' | 'archived';
  sort_order: number;
}

interface BannerInput {
  seriesId: string;
  name: string;
  description: string;
  costSingle: number;
  costMulti: number;
  ratesPpm: Record<Rarity, number>;
  pity: { epicAt: number; legendaryAt: number; bonusEvery: number } | null;
  poolIds: string[];
  startsAt: number;
  endsAt: number | null;
  sortOrder: number;
}

const int = (v: unknown, field: string, min: number, max: number) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ApiError('BAD_REQUEST', `${field}: integer ${min}-${max}`);
  return n;
};

async function validate(env: Env, kind: 'standard' | 'premium', b: Record<string, unknown>): Promise<BannerInput> {
  const rates = (b.ratesPpm ?? {}) as Record<string, unknown>;
  const ratesPpm = Object.fromEntries(RARITIES.map((r) => [r, int(rates[r] ?? 0, `ratesPpm.${r}`, 0, PPM)])) as Record<Rarity, number>;
  if (ratesSum(ratesPpm) !== PPM) throw new ApiError('BAD_REQUEST', `the rates must add up to 100% (now ${ratesSum(ratesPpm) / 10_000}%)`);
  if (!Array.isArray(b.poolIds) || b.poolIds.length === 0) throw new ApiError('BAD_REQUEST', 'poolIds: at least one card');
  const poolIds = [...new Set(b.poolIds.map(String))].sort();
  const catalog = new Map((await loadCatalog(env, { fresh: true })).map((p) => [p.id, p]));
  const unknown = poolIds.filter((id) => !catalog.has(id));
  if (unknown.length) throw new ApiError('BAD_REQUEST', `unknown or inactive cards: ${unknown.slice(0, 5).join(', ')}`);
  for (const r of RARITIES) {
    const n = poolIds.filter((id) => catalog.get(id)!.rarity === r).length;
    if (ratesPpm[r] > 0 && n === 0) throw new ApiError('BAD_REQUEST', `${r} has a rate but no card in the pool`);
    if (ratesPpm[r] === 0 && n > 0) throw new ApiError('BAD_REQUEST', `${r} cards are in the pool but the rate is 0%`);
  }
  let pity: BannerInput['pity'] = null;
  if (b.pity) {
    if (kind !== 'premium') throw new ApiError('BAD_REQUEST', 'only Premium gacha has pity (spec 9-1)');
    const pv = b.pity as Record<string, unknown>;
    pity = { epicAt: int(pv.epicAt, 'pity.epicAt', 1, 1000), legendaryAt: int(pv.legendaryAt, 'pity.legendaryAt', 1, 1000), bonusEvery: int(pv.bonusEvery, 'pity.bonusEvery', 1, 10000) };
    if (ratesPpm.epic + ratesPpm.legendary + ratesPpm.icon === 0 || ratesPpm.legendary + ratesPpm.icon === 0) throw new ApiError('BAD_REQUEST', 'pity needs Epic and Legendary-or-better cards with a rate');
  }
  const startsAt = int(b.startsAt, 'startsAt', 0, Number.MAX_SAFE_INTEGER);
  const endsAt = b.endsAt === null || b.endsAt === undefined || b.endsAt === '' ? null : int(b.endsAt, 'endsAt', 0, Number.MAX_SAFE_INTEGER);
  if (endsAt !== null && endsAt <= startsAt) throw new ApiError('BAD_REQUEST', 'endsAt must be after startsAt');
  return {
    seriesId: str(b.seriesId, 'seriesId', { pattern: /^[a-z0-9-]{3,40}$/ }),
    name: str(b.name, 'name', { min: 1, max: 60 }),
    description: str(b.description, 'description', { min: 1, max: 1000 }),
    costSingle: int(b.costSingle, 'costSingle', 1, 1_000_000),
    costMulti: int(b.costMulti, 'costMulti', 1, 10_000_000),
    ratesPpm,
    pity,
    poolIds,
    startsAt,
    endsAt,
    sortOrder: int(b.sortOrder ?? 0, 'sortOrder', 0, 1000),
  };
}

const snapshot = (kind: string, i: BannerInput) =>
  JSON.stringify({
    kind,
    seriesId: i.seriesId,
    name: i.name,
    description: i.description,
    cost: { currency: kind === 'standard' ? 'COINS' : 'GEMS_PAID', single: i.costSingle, multi: i.costMulti },
    rates: i.ratesPpm,
    pool: i.poolIds,
    pity: i.pity,
    startsAt: i.startsAt,
    endsAt: i.endsAt,
  });

/** statements that write rates (version) and the pool */
function writeStmts(env: Env, id: string, version: number, i: BannerInput): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM gacha_probabilities WHERE banner_id = ? AND rates_version = ?').bind(id, version),
    ...RARITIES.map((r) => env.DB.prepare('INSERT INTO gacha_probabilities (banner_id, rates_version, rarity, rate_ppm) VALUES (?,?,?,?)').bind(id, version, r, i.ratesPpm[r])),
    env.DB.prepare('DELETE FROM gacha_pool_items WHERE banner_id = ?').bind(id),
    env.DB.prepare('INSERT INTO gacha_pool_items (banner_id, player_id) SELECT ?, value FROM json_each(?)').bind(id, JSON.stringify(i.poolIds)),
  ];
}

async function bannerDetail(env: Env, id: string) {
  const b = await env.DB.prepare('SELECT * FROM gacha_banners WHERE id = ?').bind(id).first<BannerRow>();
  if (!b) throw new ApiError('NOT_FOUND', 'gacha not found');
  const [rates, pool, versions, draws] = await env.DB.batch([
    env.DB.prepare('SELECT rarity, rate_ppm FROM gacha_probabilities WHERE banner_id = ? AND rates_version = ?').bind(id, b.rates_version),
    env.DB.prepare('SELECT player_id FROM gacha_pool_items WHERE banner_id = ? ORDER BY player_id').bind(id),
    env.DB.prepare('SELECT v.version, v.change_note, v.created_at, a.username AS changed_by FROM gacha_banner_versions v LEFT JOIN admin_users a ON a.id = v.changed_by WHERE v.banner_id = ? ORDER BY v.version DESC').bind(id),
    env.DB.prepare('SELECT rates_version, COUNT(*) AS n, SUM(draw_count) AS cards FROM gacha_draws WHERE banner_id = ? GROUP BY rates_version').bind(id),
  ]);
  return {
    banner: { ...b, pity: b.pity_json ? JSON.parse(b.pity_json) : null },
    ratesPpm: Object.fromEntries((rates.results as { rarity: string; rate_ppm: number }[]).map((r) => [r.rarity, r.rate_ppm])),
    poolIds: (pool.results as { player_id: string }[]).map((r) => r.player_id),
    versions: versions.results,
    draws: draws.results,
  };
}

adminGachaRoutes.get('/gacha/banners', requirePermission('gacha.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT b.id, b.kind, b.series_id, b.name, b.status, b.rates_version, b.cost_currency, b.cost_single, b.cost_multi, b.starts_at, b.ends_at, b.sort_order,
            (SELECT COUNT(*) FROM gacha_pool_items i WHERE i.banner_id = b.id) AS pool_size,
            (SELECT COUNT(*) FROM gacha_draws d WHERE d.banner_id = b.id) AS draws
       FROM gacha_banners b ORDER BY CASE b.status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, b.sort_order, b.created_at DESC`,
  ).all();
  return c.json({ items: rows.results, now: Date.now() });
});

adminGachaRoutes.get('/gacha/banners/:id', requirePermission('gacha.read'), async (c) => c.json(await bannerDetail(c.env, c.req.param('id'))));

/** new banner (draft, not visible to players) */
adminGachaRoutes.post('/gacha/banners', requirePermission('gacha.write'), async (c) => {
  const a = c.get('admin');
  const body = await readJson<Record<string, unknown>>(c);
  const id = str(body.id, 'id', { pattern: /^[a-z0-9-]{3,40}$/ });
  const kind = body.kind === 'premium' ? 'premium' : body.kind === 'standard' ? 'standard' : null;
  if (!kind) throw new ApiError('BAD_REQUEST', 'kind must be standard or premium');
  if (await c.env.DB.prepare('SELECT 1 FROM gacha_banners WHERE id = ?').bind(id).first()) throw new ApiError('CONFLICT', 'this id is already used');
  const i = await validate(c.env, kind, body);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO gacha_banners (id, kind, series_id, name, description, cost_currency, cost_single, cost_multi, rates_version, pity_json, starts_at, ends_at, status, sort_order, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,1,?,?,?,'draft',?,?,?)`,
    ).bind(id, kind, i.seriesId, i.name, i.description, kind === 'standard' ? 'COINS' : 'GEMS_PAID', i.costSingle, i.costMulti, i.pity ? JSON.stringify(i.pity) : null, i.startsAt, i.endsAt, i.sortOrder, now, now),
    ...writeStmts(c.env, id, 1, i),
    auditStatement(c.env, a.id, 'gacha_created', { type: 'gacha', id }, { kind, name: i.name, seriesId: i.seriesId, pool: i.poolIds.length }, ipOf(c)),
  ]);
  return c.json(await bannerDetail(c.env, id), 201);
});

/**
 * edit: a draft changes in place; a published banner gets a new version
 * (decision 58) and needs a note describing the change
 */
adminGachaRoutes.patch('/gacha/banners/:id', requirePermission('gacha.write'), async (c) => {
  const a = c.get('admin');
  const id = c.req.param('id');
  const b = await c.env.DB.prepare('SELECT * FROM gacha_banners WHERE id = ?').bind(id).first<BannerRow>();
  if (!b) throw new ApiError('NOT_FOUND', 'gacha not found');
  if (b.status === 'archived') throw new ApiError('CONFLICT', 'an ended gacha cannot be edited');
  const body = await readJson<Record<string, unknown>>(c);
  const i = await validate(c.env, b.kind, body);
  if (b.status === 'published' && i.seriesId !== b.series_id) throw new ApiError('BAD_REQUEST', 'the series of a published gacha cannot change (the pity belongs to it)');
  const note = typeof body.changeNote === 'string' ? body.changeNote.trim().slice(0, 300) : '';
  if (b.status === 'published' && !note) throw new ApiError('BAD_REQUEST', 'changeNote is required for a published gacha (shown to players)');
  const version = b.status === 'published' ? b.rates_version + 1 : b.rates_version;
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE gacha_banners SET series_id = ?, name = ?, description = ?, cost_single = ?, cost_multi = ?, rates_version = ?, pity_json = ?, starts_at = ?, ends_at = ?, sort_order = ?, updated_at = ? WHERE id = ?',
    ).bind(i.seriesId, i.name, i.description, i.costSingle, i.costMulti, version, i.pity ? JSON.stringify(i.pity) : null, i.startsAt, i.endsAt, i.sortOrder, now, id),
    ...writeStmts(c.env, id, version, i),
    ...(b.status === 'published'
      ? [
          c.env.DB.prepare('INSERT INTO gacha_banner_versions (banner_id, version, snapshot_json, change_note, changed_by, created_at) VALUES (?,?,?,?,?,?)').bind(
            id,
            version,
            snapshot(b.kind, i),
            note,
            a.id,
            now,
          ),
        ]
      : []),
    auditStatement(c.env, a.id, b.status === 'published' ? 'gacha_version_published' : 'gacha_draft_updated', { type: 'gacha', id }, { version, note: note || undefined, pool: i.poolIds.length, rates: i.ratesPpm }, ipOf(c)),
  ]);
  return c.json(await bannerDetail(c.env, id));
});

adminGachaRoutes.post('/gacha/banners/:id/publish', requirePermission('gacha.write'), async (c) => {
  const a = c.get('admin');
  const id = c.req.param('id');
  const d = await bannerDetail(c.env, id);
  if (d.banner.status !== 'draft') throw new ApiError('CONFLICT', 'only a draft can be published');
  const i = await validate(c.env, d.banner.kind, {
    seriesId: d.banner.series_id,
    name: d.banner.name,
    description: d.banner.description,
    costSingle: d.banner.cost_single,
    costMulti: d.banner.cost_multi,
    ratesPpm: d.ratesPpm,
    pity: d.banner.pity,
    poolIds: d.poolIds,
    startsAt: d.banner.starts_at,
    endsAt: d.banner.ends_at,
    sortOrder: d.banner.sort_order,
  });
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE gacha_banners SET status = 'published', updated_at = ? WHERE id = ? AND status = 'draft'").bind(now, id),
    c.env.DB.prepare('INSERT OR REPLACE INTO gacha_banner_versions (banner_id, version, snapshot_json, change_note, changed_by, created_at) VALUES (?,?,?,?,?,?)').bind(
      id,
      d.banner.rates_version,
      snapshot(d.banner.kind, i),
      '公開',
      a.id,
      now,
    ),
  ]);
  await audit(c.env, a.id, 'gacha_published', { type: 'gacha', id }, { version: d.banner.rates_version }, ipOf(c));
  return c.json(await bannerDetail(c.env, id));
});

/** end now (the banner disappears from the game; history stays) */
adminGachaRoutes.post('/gacha/banners/:id/end', requirePermission('gacha.write'), async (c) => {
  const a = c.get('admin');
  const id = c.req.param('id');
  const now = Date.now();
  const r = await c.env.DB.prepare("UPDATE gacha_banners SET status = 'archived', ends_at = CASE WHEN ends_at IS NULL OR ends_at > ? THEN ? ELSE ends_at END, updated_at = ? WHERE id = ? AND status = 'published'")
    .bind(now, now, now, id)
    .run();
  if (r.meta.changes !== 1) throw new ApiError('CONFLICT', 'only a published gacha can be ended');
  await audit(c.env, a.id, 'gacha_ended', { type: 'gacha', id }, undefined, ipOf(c));
  return c.json(await bannerDetail(c.env, id));
});
