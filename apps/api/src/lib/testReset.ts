import type { Env } from '../env';
import { analyticsStatement } from './analytics';
import { randomId } from './crypto';

/**
 * Test data reset (spec 15-2, decision 67): sets a player's belongings back to
 * the start. Balances are emptied through the ledgers (reason "test_reset"),
 * the MATCH teams are removed (the first 11 cards come again, lib/team.ts),
 * so ledger and balance stay equal. Kept: account, tags, match / draft
 * records, ranked rating, gacha / exchange / purchase / auction history,
 * feedback, analytics, login-bonus and distribution claims, membership.
 */

const CURRENCIES = [
  ['COINS', 'coins'],
  ['GEMS_FREE', 'gems_free'],
  ['GEMS_PAID_PURCHASED', 'gems_paid_purchased'],
  ['GEMS_PAID_GRANTED', 'gems_paid_granted'],
] as const;
const POINTS = [
  ['standard', 'standard_points'],
  ['premium', 'premium_points'],
] as const;

export interface ResetSummary {
  wallet: Record<string, number>;
  points: Record<string, number>;
  cards: number;
  passXp: number;
}

/** what a reset will take away (shown in the result and kept with the run) */
export async function resetSummaryOf(env: Env, userId: string): Promise<ResetSummary> {
  const w = await env.DB.prepare('SELECT coins, gems_free, gems_paid_purchased, gems_paid_granted FROM currency_wallets WHERE user_id = ?').bind(userId).first<Record<string, number>>();
  const p = await env.DB.prepare('SELECT standard_points, premium_points FROM exchange_wallets WHERE user_id = ?').bind(userId).first<Record<string, number>>();
  const cards = await env.DB.prepare('SELECT COUNT(*) AS n FROM user_collections WHERE user_id = ?').bind(userId).first<{ n: number }>();
  const xp = await env.DB.prepare('SELECT COALESCE(SUM(xp), 0) AS n FROM season_pass_progress WHERE user_id = ?').bind(userId).first<{ n: number }>();
  return {
    wallet: Object.fromEntries(CURRENCIES.map(([c, col]) => [c, w?.[col] ?? 0])),
    points: Object.fromEntries(POINTS.map(([t, col]) => [t, p?.[col] ?? 0])),
    cards: cards?.n ?? 0,
    passXp: xp?.n ?? 0,
  };
}

/** statements of one player's reset; running them twice changes nothing more */
export function resetStmts(env: Env, userId: string, runId: string, summary: ResetSummary, now: number): D1PreparedStatement[] {
  const opId = randomId();
  const stmts: D1PreparedStatement[] = [];
  for (const [currency, col] of CURRENCIES) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO currency_transactions (id, user_id, currency, amount, balance_after, reason, ref_type, ref_id, op_id, created_at)
         SELECT ?, user_id, ?, -${col}, 0, 'test_reset', 'test_reset_run', ?, ?, ? FROM currency_wallets WHERE user_id = ? AND ${col} > 0`,
      ).bind(randomId(), currency, runId, opId, now, userId),
    );
  }
  stmts.push(env.DB.prepare('UPDATE currency_wallets SET coins = 0, gems_free = 0, gems_paid_purchased = 0, gems_paid_granted = 0, updated_at = ? WHERE user_id = ?').bind(now, userId));
  for (const [type, col] of POINTS) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO exchange_transactions (id, user_id, point_type, amount, balance_after, reason, ref_type, ref_id, op_id, created_at)
         SELECT ?, user_id, ?, -${col}, 0, 'test_reset', 'test_reset_run', ?, ?, ? FROM exchange_wallets WHERE user_id = ? AND ${col} > 0`,
      ).bind(randomId(), type, runId, opId, now, userId),
    );
  }
  stmts.push(
    env.DB.prepare('UPDATE exchange_wallets SET standard_points = 0, premium_points = 0, updated_at = ? WHERE user_id = ?').bind(now, userId),
    // the Collection Draft roster refers to the collection, so it goes first
    env.DB.prepare('DELETE FROM collection_draft_rosters WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_collections WHERE user_id = ?').bind(userId),
    // MATCH teams (decision 73); the first 11 cards are given again on the next visit
    env.DB.prepare('DELETE FROM user_squads WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_squad_active WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM gacha_pity WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM mission_progress WHERE user_id = ?').bind(userId),
    env.DB.prepare("DELETE FROM reward_claims WHERE user_id = ? AND (reward_key LIKE 'mission:%' OR reward_key LIKE 'pass:%')").bind(userId),
    env.DB.prepare('DELETE FROM season_pass_progress WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM season_pass_xp WHERE user_id = ?').bind(userId),
    // auction coins (decision 100): holds released, balance emptied through the ledger, and the
    // initial funds come again on the next visit; a lot the player leads is then not paid and is cancelled
    env.DB.prepare("UPDATE auction_holds SET status = 'released', closed_at = ?, close_op = ? WHERE user_id = ? AND status = 'active'").bind(now, opId, userId),
    env.DB.prepare(
      `INSERT INTO auction_transactions (id, user_id, amount, balance_after, reason, ref_type, ref_id, op_id, created_at)
       SELECT ?, user_id, -balance, 0, 'test_reset', 'test_reset_run', ?, ?, ? FROM auction_wallets WHERE user_id = ? AND balance > 0`,
    ).bind(randomId(), runId, opId, now, userId),
    env.DB.prepare('UPDATE auction_wallets SET balance = 0, held = 0, updated_at = ? WHERE user_id = ?').bind(now, userId),
    env.DB.prepare("DELETE FROM reward_claims WHERE user_id = ? AND reward_key = 'auction:initial'").bind(userId),
    env.DB.prepare('UPDATE test_resets SET done_at = COALESCE(done_at, ?), summary_json = COALESCE(summary_json, ?) WHERE run_id = ? AND user_id = ?').bind(now, JSON.stringify(summary), runId, userId),
    analyticsStatement(env, { name: 'test_data_reset', userId, properties: { runId } }),
  );
  return stmts;
}
