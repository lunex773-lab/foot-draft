import { Hono } from 'hono';
import { track } from '../lib/analytics';
import { requireUser } from '../lib/auth';
import { ApiError, readJson } from '../lib/http';
import type { AppEnv } from '../env';

/**
 * App sessions (spec 16-1: session_started / session_ended). The game sends
 * them when it opens and when it is closed or hidden; they make players who
 * only open the app count as active (DAU) and give the play time.
 */
export const sessionRoutes = new Hono<AppEnv>();
sessionRoutes.use('*', requireUser);

const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_SESSION_MS = 3 * 60 * 60 * 1000;

function clientOf(c: { req: { header: (n: string) => string | undefined } }) {
  return { platform: c.req.header('X-FD-Platform')?.slice(0, 20) ?? null, appVersion: c.req.header('X-FD-App-Version')?.slice(0, 20) ?? null };
}

sessionRoutes.post('/start', async (c) => {
  const body = await readJson<{ sessionId?: unknown }>(c);
  if (typeof body.sessionId !== 'string' || !SESSION_ID.test(body.sessionId)) throw new ApiError('BAD_REQUEST', 'sessionId is required');
  await track(c.env, { name: 'session_started', userId: c.get('user').id, sessionId: body.sessionId, ...clientOf(c) });
  return c.json({ ok: true });
});

sessionRoutes.post('/end', async (c) => {
  const body = await readJson<{ sessionId?: unknown; durationMs?: unknown }>(c);
  if (typeof body.sessionId !== 'string' || !SESSION_ID.test(body.sessionId)) throw new ApiError('BAD_REQUEST', 'sessionId is required');
  const ms = Math.min(Math.max(Math.round(Number(body.durationMs) || 0), 0), MAX_SESSION_MS);
  await track(c.env, { name: 'session_ended', userId: c.get('user').id, sessionId: body.sessionId, ...clientOf(c), properties: { durationMs: ms } });
  return c.json({ ok: true });
});
