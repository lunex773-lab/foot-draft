import { Hono } from 'hono';
import { analyticsStatement, track } from '../lib/analytics';
import { createUserSession, requireUser } from '../lib/auth';
import { hashPassword, randomId, verifyPassword } from '../lib/crypto';
import { ApiError, readJson, str } from '../lib/http';
import type { AppEnv, Env } from '../env';

export const authRoutes = new Hono<AppEnv>();

const USERNAME = /^[a-zA-Z0-9_]{3,20}$/;

function platformOf(c: { req: { header: (n: string) => string | undefined } }) {
  return c.req.header('X-FD-Platform')?.slice(0, 20) ?? 'web';
}

/**
 * Tag of a new account. The Staging check signs up "check_..." accounts; outside
 * production they are Developer accounts so that they stay out of the beta
 * figures (decision 60).
 */
export function initialTag(env: Env, username: string): 'normal' | 'developer' {
  return env.ENVIRONMENT !== 'production' && username.startsWith('check_') ? 'developer' : 'normal';
}

authRoutes.post('/register', async (c) => {
  const body = await readJson(c);
  const username = str(body.username, 'username', { pattern: USERNAME });
  const password = str(body.password, 'password', { min: 8, max: 128 });
  const displayName = str(body.displayName ?? username, 'displayName', { min: 1, max: 24 });
  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
  if (exists) throw new ApiError('CONFLICT', 'username is already taken');
  const { hash, salt, iterations } = await hashPassword(password);
  const id = randomId();
  const now = Date.now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO users (id, username, display_name, password_hash, password_salt, password_iterations, status, created_at, updated_at, last_login_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      ).bind(id, username, displayName, hash, salt, iterations, 'active', now, now, now),
      c.env.DB.prepare('INSERT INTO user_tags (user_id, tag, created_at) VALUES (?, ?, ?)').bind(id, initialTag(c.env, username), now),
      analyticsStatement(c.env, { name: 'account_registered', userId: id, platform: platformOf(c) }),
    ]);
  } catch {
    throw new ApiError('CONFLICT', 'username is already taken');
  }
  const token = await createUserSession(c.env, id, c.req.header('User-Agent') ?? null);
  // app sessions (session_started / session_ended) are sent by the game itself (routes/sessions.ts)
  return c.json({ token, user: { id, username, displayName } }, 201);
});

authRoutes.post('/login', async (c) => {
  const body = await readJson(c);
  const username = str(body.username, 'username', { max: 40 });
  const password = str(body.password, 'password', { max: 128 });
  // simple brute-force protection: 10 failures / 15 min per username
  const since = Date.now() - 15 * 60 * 1000;
  const fails = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM analytics_events WHERE event_name = 'login_failed' AND timestamp > ? AND json_extract(properties_json, '$.username') = ?",
  )
    .bind(since, username.toLowerCase())
    .first<{ n: number }>();
  if ((fails?.n ?? 0) >= 10) throw new ApiError('RATE_LIMITED', 'too many failed attempts, try again later');

  const row = await c.env.DB.prepare('SELECT id, username, display_name, password_hash, password_salt, password_iterations, status FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: string; username: string; display_name: string; password_hash: string; password_salt: string; password_iterations: number; status: string }>();
  const ok = row ? await verifyPassword(password, row.password_hash, row.password_salt, row.password_iterations) : false;
  if (!row || !ok || row.status !== 'active') {
    await track(c.env, { name: 'login_failed', userId: row?.id ?? null, platform: platformOf(c), properties: { username: username.toLowerCase() } });
    throw new ApiError('UNAUTHORIZED', 'invalid username or password');
  }
  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(Date.now(), row.id).run();
  const token = await createUserSession(c.env, row.id, c.req.header('User-Agent') ?? null);
  await track(c.env, { name: 'login_succeeded', userId: row.id, platform: platformOf(c) });
  return c.json({ token, user: { id: row.id, username: row.username, displayName: row.display_name } });
});

authRoutes.post('/logout', requireUser, async (c) => {
  await c.env.DB.prepare('UPDATE user_sessions SET revoked_at = ? WHERE id = ?').bind(Date.now(), c.get('user').sessionId).run();
  return c.json({ ok: true });
});
