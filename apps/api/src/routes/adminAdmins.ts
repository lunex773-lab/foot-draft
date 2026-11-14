import { Hono } from 'hono';
import { audit, ipOf } from '../lib/audit';
import { ADMIN_ROLES, permissionsOf, requirePermission } from '../lib/auth';
import { hashPassword, randomId, verifyPassword } from '../lib/crypto';
import { ApiError, readJson, str } from '../lib/http';
import type { AppEnv, AuthAdmin } from '../env';

/** Admin accounts (decision 45: owner only) and the own password. */
export const adminAccountRoutes = new Hono<AppEnv>();

const USERNAME = /^[A-Za-z0-9_.-]{3,40}$/;
const PASSWORD_MIN = 12;

adminAccountRoutes.get('/admins', requirePermission('admins.manage'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.username, a.role, a.status, a.totp_enabled, a.created_at, a.updated_at, a.last_login_at, c.username AS created_by_name
       FROM admin_users a LEFT JOIN admin_users c ON c.id = a.created_by ORDER BY a.created_at`,
  ).all();
  return c.json({ items: rows.results, roles: ADMIN_ROLES.map((r) => ({ role: r, permissions: permissionsOf(r) })) });
});

/** new admin; in staging / production the 2FA key is registered at the first login */
adminAccountRoutes.post('/admins', requirePermission('admins.manage'), async (c) => {
  const me = c.get('admin');
  const body = await readJson(c);
  const username = str(body.username, 'username', { pattern: USERNAME });
  const role = body.role as AuthAdmin['role'];
  if (!ADMIN_ROLES.includes(role)) throw new ApiError('BAD_REQUEST', `role must be one of ${ADMIN_ROLES.join(', ')}`);
  const password = str(body.password, 'password', { min: PASSWORD_MIN, max: 128 });
  const exists = await c.env.DB.prepare('SELECT 1 FROM admin_users WHERE username = ?').bind(username).first();
  if (exists) throw new ApiError('CONFLICT', 'username is already taken');
  const { hash, salt, iterations } = await hashPassword(password);
  const id = randomId();
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO admin_users (id, username, password_hash, password_salt, password_iterations, role, totp_enabled, status, created_at, updated_at, created_by) VALUES (?,?,?,?,?,?,0,'active',?,?,?)",
  )
    .bind(id, username, hash, salt, iterations, role, now, now, me.id)
    .run();
  await audit(c.env, me.id, 'admin_created', { type: 'admin', id }, { username, role }, ipOf(c));
  return c.json({ id, username, role }, 201);
});

/** role, status (disable / enable) and 2FA reset */
adminAccountRoutes.patch('/admins/:id', requirePermission('admins.manage'), async (c) => {
  const me = c.get('admin');
  const id = c.req.param('id');
  const body = await readJson<{ role?: unknown; status?: unknown; resetTotp?: unknown }>(c);
  const target = await c.env.DB.prepare('SELECT id, username, role, status FROM admin_users WHERE id = ?').bind(id).first<{ id: string; username: string; role: string; status: string }>();
  if (!target) throw new ApiError('NOT_FOUND', 'admin not found');
  if (id === me.id && (body.role !== undefined || body.status !== undefined)) throw new ApiError('FORBIDDEN', 'you cannot change your own role or status');
  const role = body.role === undefined ? target.role : String(body.role);
  const status = body.status === undefined ? target.status : String(body.status);
  if (!ADMIN_ROLES.includes(role as AuthAdmin['role'])) throw new ApiError('BAD_REQUEST', 'invalid role');
  if (status !== 'active' && status !== 'disabled') throw new ApiError('BAD_REQUEST', 'status must be active or disabled');
  // keep at least one active owner
  if (target.role === 'owner' && (role !== 'owner' || status !== 'active')) {
    const owners = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM admin_users WHERE role = 'owner' AND status = 'active' AND id <> ?").bind(id).first<{ n: number }>();
    if ((owners?.n ?? 0) === 0) throw new ApiError('CONFLICT', 'at least one active owner is required');
  }
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [c.env.DB.prepare('UPDATE admin_users SET role = ?, status = ?, updated_at = ? WHERE id = ?').bind(role, status, now, id)];
  if (body.resetTotp === true) stmts.push(c.env.DB.prepare('UPDATE admin_users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?').bind(id));
  // a disabled admin, a changed role or a reset 2FA ends every session of that admin
  if (status === 'disabled' || role !== target.role || body.resetTotp === true) stmts.push(c.env.DB.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL').bind(now, id));
  await c.env.DB.batch(stmts);
  await audit(c.env, me.id, 'admin_updated', { type: 'admin', id }, { username: target.username, role: [target.role, role], status: [target.status, status], resetTotp: body.resetTotp === true || undefined }, ipOf(c));
  return c.json({ id, role, status });
});

/** change the own password (every role) */
adminAccountRoutes.post('/auth/password', async (c) => {
  const me = c.get('admin');
  const body = await readJson(c);
  const current = str(body.currentPassword, 'currentPassword', { max: 128 });
  const next = str(body.newPassword, 'newPassword', { min: PASSWORD_MIN, max: 128 });
  const row = await c.env.DB.prepare('SELECT password_hash, password_salt, password_iterations FROM admin_users WHERE id = ?').bind(me.id).first<{
    password_hash: string;
    password_salt: string;
    password_iterations: number;
  }>();
  if (!row || !(await verifyPassword(current, row.password_hash, row.password_salt, row.password_iterations))) {
    await audit(c.env, me.id, 'password_change_failed', { type: 'admin', id: me.id }, undefined, ipOf(c));
    throw new ApiError('UNAUTHORIZED', 'the current password is wrong');
  }
  const { hash, salt, iterations } = await hashPassword(next);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE admin_users SET password_hash = ?, password_salt = ?, password_iterations = ?, password_changed_at = ?, updated_at = ? WHERE id = ?').bind(hash, salt, iterations, now, now, me.id),
    // other sessions end; the current one stays
    c.env.DB.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND id <> ? AND revoked_at IS NULL').bind(now, me.id, me.sessionId),
  ]);
  await audit(c.env, me.id, 'password_changed', { type: 'admin', id: me.id }, undefined, ipOf(c));
  return c.json({ ok: true });
});
