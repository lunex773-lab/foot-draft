import type { Env } from '../env';
import { randomId } from './crypto';

/**
 * Analytics event logging (spec 16). Event names follow snake_case
 * "<object>_<verb>". Properties must not contain personal information.
 */
export type AnalyticsEventName =
  | 'account_registered'
  | 'login_succeeded'
  | 'login_failed'
  | 'session_started'
  | 'mode_selected'
  | 'room_created'
  | 'room_joined'
  | 'room_left'
  | 'draft_started'
  | 'draft_pick_completed'
  | 'draft_timeout'
  | 'draft_completed'
  | 'match_started'
  | 'match_completed'
  | 'match_abandoned'
  | 'rating_updated'
  | 'solo_challenge_completed'
  | 'currency_earned'
  | 'currency_spent'
  | 'gacha_started'
  | 'gacha_completed'
  | 'duplicate_converted'
  | 'exchange_completed'
  | 'mission_completed'
  | 'reward_claimed'
  | 'collection_player_registered'
  | 'session_ended'
  | 'feedback_submitted'
  | 'server_error'
  | 'purchase_started'
  | 'purchase_completed'
  | 'purchase_failed'
  | 'purchase_refunded'
  | 'membership_started'
  | 'pass_purchased';

export interface AnalyticsInput {
  name: AnalyticsEventName;
  userId?: string | null;
  sessionId?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  properties?: Record<string, unknown>;
}

export function analyticsStatement(env: Env, e: AnalyticsInput, now = Date.now()): D1PreparedStatement {
  return env.DB.prepare(
    'INSERT INTO analytics_events (event_id, event_name, user_id, session_id, timestamp, platform, app_version, environment, properties_json) VALUES (?,?,?,?,?,?,?,?,?)',
  ).bind(randomId(), e.name, e.userId ?? null, e.sessionId ?? null, now, e.platform ?? null, e.appVersion ?? null, env.ENVIRONMENT, e.properties ? JSON.stringify(e.properties) : null);
}

export async function track(env: Env, e: AnalyticsInput): Promise<void> {
  try {
    await analyticsStatement(env, e).run();
  } catch (err) {
    // analytics must never break gameplay
    console.error('analytics failed', e.name, err);
  }
}
