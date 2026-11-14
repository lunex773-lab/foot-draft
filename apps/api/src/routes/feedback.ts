import { Hono } from 'hono';
import { track } from '../lib/analytics';
import { audit, ipOf } from '../lib/audit';
import { requirePermission, requireUser } from '../lib/auth';
import { randomId } from '../lib/crypto';
import { ApiError, readJson, str } from '../lib/http';
import type { AppEnv } from '../env';

/**
 * In-game feedback (spec 13, decisions 48-49). The original text is never
 * changed; status / priority / internal notes / replies are kept separately.
 */
export const feedbackRoutes = new Hono<AppEnv>();
feedbackRoutes.use('*', requireUser);

export const FEEDBACK_CATEGORIES = ['bug', 'feature', 'balance', 'payment', 'other'] as const;
export const FEEDBACK_STATUSES = ['new', 'reviewing', 'investigating', 'resolved', 'closed'] as const;
export const FEEDBACK_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
const DAILY_LIMIT = 10;

/** OS and device type from the User-Agent (the User-Agent itself is not stored) */
export function deviceOf(ua: string): { os: string; deviceType: string } {
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'unknown';
  const deviceType = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet' : /Mobi|iPhone|iPod|Android/.test(ua) ? 'mobile' : 'desktop';
  return { os, deviceType };
}

const short = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

feedbackRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await readJson<Record<string, unknown>>(c);
  const category = body.category as (typeof FEEDBACK_CATEGORIES)[number];
  if (!FEEDBACK_CATEGORIES.includes(category)) throw new ApiError('BAD_REQUEST', `category must be one of ${FEEDBACK_CATEGORIES.join(', ')}`);
  const subject = str(body.subject, 'subject', { min: 1, max: 80 });
  const text = str(body.body, 'body', { min: 1, max: 2000 });
  const now = Date.now();
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND created_at > ?').bind(user.id, now - 24 * 60 * 60 * 1000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= DAILY_LIMIT) throw new ApiError('RATE_LIMITED', `at most ${DAILY_LIMIT} messages per day`);
  const ctx = (body.context ?? {}) as Record<string, unknown>;
  const { os, deviceType } = deviceOf(c.req.header('User-Agent') ?? '');
  // the latest room / match of the player is looked up on the server
  const last = await c.env.DB.prepare(
    `SELECT r.id AS room_id, r.mode,
            (SELECT m.id FROM matches m WHERE m.room_id = r.id AND (m.home_user_id = ?1 OR m.away_user_id = ?1) ORDER BY m.matchday DESC LIMIT 1) AS match_id
       FROM room_members rm JOIN rooms r ON r.id = rm.room_id WHERE rm.user_id = ?1 ORDER BY r.created_at DESC LIMIT 1`,
  )
    .bind(user.id)
    .first<{ room_id: string; mode: string; match_id: string | null }>();
  const id = `fb-${randomId(8)}`;
  await c.env.DB.prepare(
    `INSERT INTO feedback (id, user_id, category, subject, body, wants_reply, status, priority, app_version, platform, os, device_type, game_mode, last_room_id, last_match_id, error_code, environment, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'new','medium',?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      user.id,
      category,
      subject,
      text,
      body.wantsReply === true ? 1 : 0,
      short(c.req.header('X-FD-App-Version'), 20),
      short(c.req.header('X-FD-Platform'), 20),
      os,
      deviceType,
      short(ctx.gameMode, 20) ?? last?.mode ?? null,
      last?.room_id ?? null,
      last?.match_id ?? null,
      short(ctx.errorCode, 40),
      c.env.ENVIRONMENT,
      now,
      now,
    )
    .run();
  await track(c.env, { name: 'feedback_submitted', userId: user.id, platform: short(c.req.header('X-FD-Platform'), 20), properties: { feedbackId: id, category } });
  return c.json({ id }, 201);
});

/** the player's own feedback (newest first) with reply counts */
feedbackRoutes.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT f.id, f.category, f.subject, f.status, f.created_at,
            (SELECT COUNT(*) FROM feedback_replies r WHERE r.feedback_id = f.id) AS replies,
            (SELECT COUNT(*) FROM feedback_replies r WHERE r.feedback_id = f.id AND r.read_at IS NULL) AS unread
       FROM feedback f WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT 50`,
  )
    .bind(c.get('user').id)
    .all<{ unread: number }>();
  return c.json({ items: rows.results, unread: rows.results.reduce((s, r) => s + r.unread, 0) });
});

feedbackRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const f = await c.env.DB.prepare('SELECT id, category, subject, body, wants_reply, status, created_at FROM feedback WHERE id = ? AND user_id = ?').bind(c.req.param('id'), user.id).first();
  if (!f) throw new ApiError('NOT_FOUND', 'feedback not found');
  const replies = await c.env.DB.prepare('SELECT id, body, created_at FROM feedback_replies WHERE feedback_id = ? ORDER BY created_at').bind(c.req.param('id')).all();
  await c.env.DB.prepare('UPDATE feedback_replies SET read_at = ? WHERE feedback_id = ? AND read_at IS NULL').bind(Date.now(), c.req.param('id')).run();
  // internal notes are never returned to the player
  return c.json({ feedback: f, replies: replies.results });
});

// ---------------------------------------------------------------- admin

export const adminFeedbackRoutes = new Hono<AppEnv>();

adminFeedbackRoutes.get('/feedback', requirePermission('feedback.read'), async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.status === 'open') where.push("f.status IN ('new', 'reviewing', 'investigating')");
  else if (q.status && (FEEDBACK_STATUSES as readonly string[]).includes(q.status)) {
    where.push('f.status = ?');
    binds.push(q.status);
  }
  if (q.priority && (FEEDBACK_PRIORITIES as readonly string[]).includes(q.priority)) {
    where.push('f.priority = ?');
    binds.push(q.priority);
  }
  if (q.category && (FEEDBACK_CATEGORIES as readonly string[]).includes(q.category)) {
    where.push('f.category = ?');
    binds.push(q.category);
  }
  if (q.q) {
    where.push('(f.subject LIKE ? OR f.body LIKE ? OR u.username LIKE ?)');
    binds.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`);
  }
  const sqlWhere = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
  const rows = await c.env.DB.prepare(
    `SELECT f.id, f.category, f.subject, f.status, f.priority, f.wants_reply, f.created_at, f.updated_at, u.username, u.display_name,
            (SELECT COUNT(*) FROM feedback_replies r WHERE r.feedback_id = f.id) AS replies
       FROM feedback f JOIN users u ON u.id = f.user_id${sqlWhere}
      ORDER BY CASE f.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, f.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all();
  const counts = await c.env.DB.prepare('SELECT status, COUNT(*) AS n FROM feedback GROUP BY status').all<{ status: string; n: number }>();
  return c.json({ items: rows.results, counts: Object.fromEntries(counts.results.map((r) => [r.status, r.n])), limit, offset });
});

async function feedbackDetail(c: { env: AppEnv['Bindings'] }, id: string) {
  const f = await c.env.DB.prepare(
    `SELECT f.*, u.username, u.display_name, u.created_at AS user_created_at FROM feedback f JOIN users u ON u.id = f.user_id WHERE f.id = ?`,
  )
    .bind(id)
    .first();
  if (!f) throw new ApiError('NOT_FOUND', 'feedback not found');
  const [notes, replies, history] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT n.id, n.body, n.created_at, a.username AS admin FROM feedback_notes n LEFT JOIN admin_users a ON a.id = n.admin_id WHERE n.feedback_id = ? ORDER BY n.created_at').bind(id),
    c.env.DB.prepare('SELECT r.id, r.body, r.created_at, r.read_at, a.username AS admin FROM feedback_replies r LEFT JOIN admin_users a ON a.id = r.admin_id WHERE r.feedback_id = ? ORDER BY r.created_at').bind(id),
    c.env.DB.prepare(
      "SELECT l.action, l.detail_json, l.created_at, a.username AS admin FROM admin_audit_logs l LEFT JOIN admin_users a ON a.id = l.admin_id WHERE l.target_type = 'feedback' AND l.target_id = ? ORDER BY l.created_at",
    ).bind(id),
  ]);
  return { feedback: f, notes: notes.results, replies: replies.results, history: history.results };
}

adminFeedbackRoutes.get('/feedback/:id', requirePermission('feedback.read'), async (c) => c.json(await feedbackDetail(c, c.req.param('id'))));

/** status and priority only; the original text cannot be changed */
adminFeedbackRoutes.patch('/feedback/:id', requirePermission('feedback.write'), async (c) => {
  const admin = c.get('admin');
  const body = await readJson<{ status?: unknown; priority?: unknown }>(c);
  const id = c.req.param('id');
  const before = await c.env.DB.prepare('SELECT status, priority FROM feedback WHERE id = ?').bind(id).first<{ status: string; priority: string }>();
  if (!before) throw new ApiError('NOT_FOUND', 'feedback not found');
  const status = body.status === undefined ? before.status : String(body.status);
  const priority = body.priority === undefined ? before.priority : String(body.priority);
  if (!(FEEDBACK_STATUSES as readonly string[]).includes(status)) throw new ApiError('BAD_REQUEST', 'invalid status');
  if (!(FEEDBACK_PRIORITIES as readonly string[]).includes(priority)) throw new ApiError('BAD_REQUEST', 'invalid priority');
  const now = Date.now();
  await c.env.DB.prepare(
    "UPDATE feedback SET status = ?, priority = ?, updated_at = ?, resolved_at = CASE WHEN ? IN ('resolved', 'closed') THEN COALESCE(resolved_at, ?) ELSE NULL END WHERE id = ?",
  )
    .bind(status, priority, now, status, now, id)
    .run();
  await audit(c.env, admin.id, 'feedback_updated', { type: 'feedback', id }, { status: [before.status, status], priority: [before.priority, priority] }, ipOf(c));
  return c.json(await feedbackDetail(c, id));
});

/** internal note (never shown to the player) */
adminFeedbackRoutes.post('/feedback/:id/notes', requirePermission('feedback.write'), async (c) => {
  const admin = c.get('admin');
  const id = c.req.param('id');
  const text = str((await readJson(c)).body, 'body', { min: 1, max: 2000 });
  const exists = await c.env.DB.prepare('SELECT 1 FROM feedback WHERE id = ?').bind(id).first();
  if (!exists) throw new ApiError('NOT_FOUND', 'feedback not found');
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO feedback_notes (id, feedback_id, admin_id, body, created_at) VALUES (?,?,?,?,?)').bind(randomId(), id, admin.id, text, now),
    c.env.DB.prepare('UPDATE feedback SET updated_at = ? WHERE id = ?').bind(now, id),
  ]);
  await audit(c.env, admin.id, 'feedback_note_added', { type: 'feedback', id }, { length: text.length }, ipOf(c));
  return c.json(await feedbackDetail(c, id), 201);
});

/** reply shown to the player in the game (decision 48) */
adminFeedbackRoutes.post('/feedback/:id/replies', requirePermission('feedback.write'), async (c) => {
  const admin = c.get('admin');
  const id = c.req.param('id');
  const text = str((await readJson(c)).body, 'body', { min: 1, max: 2000 });
  const f = await c.env.DB.prepare('SELECT status FROM feedback WHERE id = ?').bind(id).first<{ status: string }>();
  if (!f) throw new ApiError('NOT_FOUND', 'feedback not found');
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO feedback_replies (id, feedback_id, admin_id, body, created_at) VALUES (?,?,?,?,?)').bind(randomId(), id, admin.id, text, now),
    // a new message is at least being reviewed once someone answered
    c.env.DB.prepare("UPDATE feedback SET updated_at = ?, status = CASE WHEN status = 'new' THEN 'reviewing' ELSE status END WHERE id = ?").bind(now, id),
  ]);
  await audit(c.env, admin.id, 'feedback_replied', { type: 'feedback', id }, { length: text.length }, ipOf(c));
  return c.json(await feedbackDetail(c, id), 201);
});
