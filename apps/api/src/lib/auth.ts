import type { MiddlewareHandler } from 'hono';
import type { AppEnv, AuthAdmin, AuthUser, Env } from '../env';
import { randomToken, sha256Hex } from './crypto';
import { ApiError } from './http';

export const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1].trim() : null;
}

export async function createUserSession(env: Env, userId: string, userAgent: string | null): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO user_sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)')
    .bind(await sha256Hex(token), userId, now, now + USER_SESSION_TTL_MS, userAgent?.slice(0, 200) ?? null)
    .run();
  return token;
}

export async function findUserByToken(env: Env, token: string): Promise<AuthUser | null> {
  const sid = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'`,
  )
    .bind(sid, Date.now())
    .first<{ id: string; username: string; display_name: string }>();
  return row ? { id: row.id, username: row.username, displayName: row.display_name, sessionId: sid } : null;
}

/** Requires a logged-in player (game client). */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c.req.header('Authorization'));
  if (!token) throw new ApiError('UNAUTHORIZED', 'login required');
  const user = await findUserByToken(c.env, token);
  if (!user) throw new ApiError('UNAUTHORIZED', 'invalid or expired session');
  c.set('user', user);
  await next();
};

export async function createAdminSession(env: Env, adminId: string, ip: string | null, userAgent: string | null): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO admin_sessions (id, admin_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)')
    .bind(await sha256Hex(token), adminId, now, now + ADMIN_SESSION_TTL_MS, ip, userAgent?.slice(0, 200) ?? null)
    .run();
  return token;
}

/**
 * Requires an admin session. Player tokens are never accepted here because
 * admin sessions live in a separate table (spec 0-4: admin API must not be
 * exposed to players).
 */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c.req.header('Authorization'));
  if (!token) throw new ApiError('UNAUTHORIZED', 'admin login required');
  const sid = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT a.id, a.username, a.role FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_id
     WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND a.status = 'active'`,
  )
    .bind(sid, Date.now())
    .first<{ id: string; username: string; role: AuthAdmin['role'] }>();
  if (!row) throw new ApiError('UNAUTHORIZED', 'invalid or expired admin session');
  c.set('admin', { id: row.id, username: row.username, role: row.role, sessionId: sid });
  await next();
};

/** RBAC (decision 45): owner / admin / support / viewer */
export type AdminPermission =
  | 'cards.read'
  | 'audit.read'
  | 'events.read'
  | 'events.write'
  | 'seasons.read'
  /** aggregated economy figures */
  | 'economy.read'
  /** staging / local only (decision 42) */
  | 'economy.test_grant'
  /** aggregated analytics (overview, analytics, retention) */
  | 'analytics.read'
  /** individual players: search and details */
  | 'users.read'
  /** individual players: balances and ledgers */
  | 'users.wallet'
  /** tags, suspend */
  | 'users.write'
  | 'feedback.read'
  | 'feedback.write'
  | 'distribution.read'
  | 'distribution.write'
  /** add admins, change roles, disable, reset 2FA */
  | 'admins.manage'
  /** gacha banners: read all (drafts too) / create, edit, publish, end */
  | 'gacha.read'
  | 'gacha.write'
  /** products for real money */
  | 'products.write'
  /** individual purchases and refunds */
  | 'purchases.read'
  | 'purchases.write'
  /** aggregated revenue */
  | 'revenue.read'
  /** beta test tools: bulk tags, test data reset, draft timer setting (Phase 7) */
  | 'beta.manage'
  /** player auction: aggregated figures, lots, settings and queue (read) */
  | 'auction.read'
  /** player auction: settings, open / pause, listing queue, cancel a lot (decision 105) */
  | 'auction.write';

const ALL: AdminPermission[] = [
  'cards.read',
  'audit.read',
  'events.read',
  'events.write',
  'seasons.read',
  'economy.read',
  'economy.test_grant',
  'analytics.read',
  'users.read',
  'users.wallet',
  'users.write',
  'feedback.read',
  'feedback.write',
  'distribution.read',
  'distribution.write',
  'admins.manage',
  'gacha.read',
  'gacha.write',
  'products.write',
  'purchases.read',
  'purchases.write',
  'revenue.read',
  'beta.manage',
  'auction.read',
  'auction.write',
];

const ROLE_PERMISSIONS: Record<AuthAdmin['role'], AdminPermission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== 'admins.manage'),
  // player search and feedback; balances read only
  support: ['cards.read', 'events.read', 'seasons.read', 'users.read', 'users.wallet', 'feedback.read', 'feedback.write', 'purchases.read', 'gacha.read', 'auction.read'],
  // aggregated figures only, nothing that identifies a player
  viewer: ['cards.read', 'events.read', 'seasons.read', 'analytics.read', 'economy.read', 'revenue.read', 'gacha.read', 'auction.read'],
};

export const ADMIN_ROLES: AuthAdmin['role'][] = ['owner', 'admin', 'support', 'viewer'];

export function can(role: AuthAdmin['role'], p: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(p) ?? false;
}

/** test grants of currencies (decision 42): never in production */
export function testGrantsEnabled(env: { ENVIRONMENT: string }): boolean {
  return env.ENVIRONMENT === 'local' || env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'staging';
}

export function permissionsOf(role: AuthAdmin['role']): AdminPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function requirePermission(p: AdminPermission): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const admin = c.get('admin');
    if (!admin || !ROLE_PERMISSIONS[admin.role].includes(p)) throw new ApiError('FORBIDDEN', 'permission denied');
    await next();
  };
}
