import { PASS_CONFIG, cryptoRandom, passLevel, passRewards, seasonAt, splitGemsFreeFirst, type PassReward, type PassTrack } from '@fd/shared';
import { Hono } from 'hono';
import { requireUser } from '../lib/auth';
import { analyticsWhen, claimedNow, currencyStmts, pointStmts, requestIdOf, rewardStmts, runOperation, walletOf } from '../lib/economy';
import { ApiError, readJson } from '../lib/http';
import { loadCatalog } from '../lib/players';
import type { AppEnv, Env } from '../env';

/**
 * Season Pass (decisions 54, 56): monthly (Japan time, same as the Ranked
 * season), 30 levels. XP comes from leagues (lib/rewards.ts). Every reward is
 * paid once through reward_claims ("pass:<season>:<track>:<level>:<n>").
 */
export const passRoutes = new Hono<AppEnv>();
passRoutes.use('*', requireUser);

const TRACKS: PassTrack[] = ['free', 'premium'];
const keyOf = (season: string, track: PassTrack, level: number, i: number) => `pass:${season}:${track}:${level}:${i}`;

async function progressOf(env: Env, userId: string, season: string) {
  const row = await env.DB.prepare('SELECT xp, premium, premium_at FROM season_pass_progress WHERE user_id = ? AND season_id = ?').bind(userId, season).first<{ xp: number; premium: number; premium_at: number | null }>();
  return { xp: row?.xp ?? 0, premium: !!row?.premium, premiumAt: row?.premium_at ?? null };
}

async function claimedKeys(env: Env, userId: string, season: string): Promise<Set<string>> {
  const rows = await env.DB.prepare('SELECT reward_key FROM reward_claims WHERE user_id = ? AND reward_key LIKE ?').bind(userId, `pass:${season}:%`).all<{ reward_key: string }>();
  return new Set(rows.results.map((r) => r.reward_key));
}

async function passView(env: Env, userId: string, now = Date.now()) {
  const season = seasonAt(now);
  const p = await progressOf(env, userId, season.id);
  const level = passLevel(p.xp);
  const claimed = await claimedKeys(env, userId, season.id);
  const levels = [];
  for (let l = 1; l <= PASS_CONFIG.levels; l++) {
    const track = (t: PassTrack) =>
      passRewards(t, l).map((r, i) => ({ reward: r, claimed: claimed.has(keyOf(season.id, t, l, i)), claimable: l <= level && (t === 'free' || p.premium) && !claimed.has(keyOf(season.id, t, l, i)) }));
    levels.push({ level: l, free: track('free'), premium: track('premium') });
  }
  return {
    season: { id: season.id, name: season.nameJa, startsAt: season.startsAt, endsAt: season.endsAt },
    xp: p.xp,
    level,
    xpPerLevel: PASS_CONFIG.xpPerLevel,
    nextLevelXp: level >= PASS_CONFIG.levels ? null : (level + 1) * PASS_CONFIG.xpPerLevel,
    premium: p.premium,
    premiumPriceGems: PASS_CONFIG.premiumPriceGems,
    levels,
    claimable: levels.reduce((n, l) => n + [...l.free, ...l.premium].filter((x) => x.claimable).length, 0),
  };
}

passRoutes.get('/', async (c) => c.json({ ...(await passView(c.env, c.get('user').id)), wallet: await walletOf(c.env, c.get('user').id) }));

/** premium track: 800 GEMS, FREE GEMS first (decision 56) */
passRoutes.post('/premium', async (c) => {
  const user = c.get('user');
  const requestId = requestIdOf((await readJson<{ requestId?: unknown }>(c)).requestId);
  const result = await runOperation(c.env, user.id, requestId, 'season_pass', async ({ opId, now }) => {
    const season = seasonAt(now);
    if ((await progressOf(c.env, user.id, season.id)).premium) throw new ApiError('CONFLICT', 'the premium pass is already active this season');
    const w = await walletOf(c.env, user.id);
    const split = splitGemsFreeFirst(PASS_CONFIG.premiumPriceGems, { GEMS_FREE: w.gems.free, GEMS_PAID_GRANTED: w.gems.paidGranted, GEMS_PAID_PURCHASED: w.gems.paidPurchased });
    if (!split) throw new ApiError('INSUFFICIENT_FUNDS', 'not enough GEMS');
    const statements: D1PreparedStatement[] = [];
    for (const [currency, amount] of Object.entries(split) as [keyof typeof split, number][]) {
      statements.push(...currencyStmts(c.env, { userId: user.id, currency, amount: -amount, reason: 'season_pass', refType: 'season_pass', refId: season.id, opId, now }));
    }
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO season_pass_progress (user_id, season_id, xp, premium, premium_at, updated_at) VALUES (?1, ?2, 0, 1, ?3, ?3)
         ON CONFLICT (user_id, season_id) DO UPDATE SET premium = 1, premium_at = ?3, updated_at = ?3`,
      ).bind(user.id, season.id, now),
      analyticsWhen(c.env, 'pass_purchased', user.id, { seasonId: season.id, split }, now),
    );
    return { statements, response: { seasonId: season.id, split } };
  });
  return c.json({ ...result, pass: await passView(c.env, user.id), wallet: await walletOf(c.env, user.id) });
});

interface Granted {
  level: number;
  track: PassTrack;
  reward: PassReward;
  /** card rewards: the card received (or the points instead) */
  playerId?: string | null;
  fallback?: boolean;
}

/** receive every reward reached so far (current season) */
passRoutes.post('/claim', async (c) => {
  const user = c.get('user');
  const requestId = requestIdOf((await readJson<{ requestId?: unknown }>(c)).requestId);
  const catalog = await loadCatalog(c.env);
  const result = await runOperation<{ granted: Granted[] }>(c.env, user.id, requestId, 'pass_claim', async ({ opId, now }) => {
    const season = seasonAt(now);
    const p = await progressOf(c.env, user.id, season.id);
    const level = passLevel(p.xp);
    const claimed = await claimedKeys(c.env, user.id, season.id);
    const owned = new Set(
      (await c.env.DB.prepare('SELECT player_id FROM user_collections WHERE user_id = ?').bind(user.id).all<{ player_id: string }>()).results.map((r) => r.player_id),
    );
    const rnd = cryptoRandom();
    const statements: D1PreparedStatement[] = [];
    const granted: Granted[] = [];
    const claimStmt = (key: string, kind: string, currency: string) =>
      c.env.DB.prepare('INSERT OR IGNORE INTO reward_claims (id, user_id, reward_key, kind, currency, amount, op_id, created_at) VALUES (?,?,?,?,?,1,?,?)').bind(
        crypto.randomUUID(),
        user.id,
        key,
        kind,
        currency,
        opId,
        now,
      );
    for (let l = 1; l <= level; l++) {
      for (const track of TRACKS) {
        if (track === 'premium' && !p.premium) continue;
        passRewards(track, l).forEach((r, i) => {
          const key = keyOf(season.id, track, l, i);
          if (claimed.has(key)) return;
          const g = { userId: user.id, key, kind: 'season_pass', opId, now, refType: 'season_pass', refId: season.id };
          if (r.type === 'currency') {
            statements.push(...rewardStmts(c.env, { ...g, currency: r.currency, amount: r.amount }));
            granted.push({ level: l, track, reward: r });
          } else if (r.type === 'points') {
            statements.push(claimStmt(key, 'season_pass', `POINTS_${r.pointType.toUpperCase()}`), ...pointStmts(c.env, { ...g, pointType: r.pointType, amount: r.amount, reason: 'season_pass' }, claimedNow(g)));
            granted.push({ level: l, track, reward: r });
          } else {
            // a card not owned yet; Standard points when every card of the rarity is owned
            const candidates = catalog.filter((x) => x.rarity === r.rarity && !owned.has(x.id));
            if (candidates.length === 0) {
              statements.push(claimStmt(key, 'season_pass', 'POINTS_STANDARD'), ...pointStmts(c.env, { ...g, pointType: 'standard', amount: r.fallbackPoints, reason: 'season_pass' }, claimedNow(g)));
              granted.push({ level: l, track, reward: r, playerId: null, fallback: true });
            } else {
              const pick = candidates[rnd.int(candidates.length)];
              owned.add(pick.id);
              const cond = claimedNow(g);
              statements.push(
                claimStmt(key, 'season_pass', 'CARD'),
                // a card received elsewhere in the meantime makes the batch fail (primary key) and the claim is computed again
                c.env.DB.prepare(`INSERT INTO user_collections (user_id, player_id, source, source_ref, obtained_at) SELECT ?, ?, 'season_pass', ?, ? WHERE ${cond.sql}`).bind(
                  user.id,
                  pick.id,
                  key,
                  now,
                  ...cond.binds,
                ),
              );
              granted.push({ level: l, track, reward: r, playerId: pick.id });
            }
          }
        });
      }
    }
    if (granted.length === 0) throw new ApiError('CONFLICT', 'nothing to claim');
    return { statements, response: { granted } };
  });
  return c.json({ ...result, pass: await passView(c.env, user.id), wallet: await walletOf(c.env, user.id) });
});

