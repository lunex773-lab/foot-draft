import { SIM_VERSION } from '@fd/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from './env';
import { track } from './lib/analytics';
import { ApiError, errorBody } from './lib/http';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { collectionRoutes, exchangeRoutes } from './routes/collection';
import { matchModeRoutes, teamRoutes } from './routes/team';
import { draftMatchRoutes } from './routes/draftMatch';
import { draftRoutes } from './routes/drafts';
import { currencyRoutes, missionRoutes, rewardRoutes } from './routes/economy';
import { eventRoutes } from './routes/events';
import { feedbackRoutes } from './routes/feedback';
import { gachaRoutes } from './routes/gacha';
import { matchRoutes } from './routes/matches';
import { playerRoutes } from './routes/players';
import { rankedRoutes } from './routes/ranked';
import { passRoutes } from './routes/pass';
import { ratingRoutes } from './routes/ratings';
import { purchaseRoutes } from './routes/purchases';
import { roomRoutes } from './routes/rooms';
import { sessionRoutes } from './routes/sessions';
import { soloRoutes } from './routes/solo';
import { userRoutes } from './routes/users';

export { RoomDO } from './room/RoomDO';
export { DraftMatchDO } from './room/DraftMatchDO';

const app = new Hono<AppEnv>();

app.use('/api/*', async (c, next) => {
  const origins = (c.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return cors({
    origin: (origin) => (origins.includes(origin) ? origin : null),
    allowHeaders: ['Authorization', 'Content-Type', 'X-FD-Platform', 'X-FD-App-Version'],
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'OPTIONS'],
    maxAge: 600,
  })(c, next);
});

app.get('/api/health', (c) => c.json({ ok: true, environment: c.env.ENVIRONMENT, simVersion: SIM_VERSION }));

app.route('/api/auth', authRoutes);
app.route('/api/users', userRoutes);
app.route('/api/players', playerRoutes);
app.route('/api/rooms', roomRoutes);
app.route('/api/drafts', draftRoutes);
app.route('/api/matches', matchRoutes);
app.route('/api/ranked', rankedRoutes);
app.route('/api/solo', soloRoutes);
app.route('/api/events', eventRoutes);
app.route('/api/currency', currencyRoutes);
app.route('/api/rewards', rewardRoutes);
app.route('/api/missions', missionRoutes);
app.route('/api/gacha', gachaRoutes);
app.route('/api/collection', collectionRoutes);
app.route('/api/exchange', exchangeRoutes);
app.route('/api/team', teamRoutes);
app.route('/api/match', matchModeRoutes);
app.route('/api/draft-match', draftMatchRoutes);
app.route('/api/feedback', feedbackRoutes);
app.route('/api/sessions', sessionRoutes);
app.route('/api/purchases', purchaseRoutes);
app.route('/api/pass', passRoutes);
app.route('/api/ratings', ratingRoutes);
app.route('/api/admin', adminRoutes);

app.notFound((c) => c.json(errorBody('NOT_FOUND', 'not found'), 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json(errorBody(err.code, err.message), err.status);
  if (err instanceof HTTPException) return c.json(errorBody('HTTP_ERROR', err.message), err.status);
  console.error('unhandled error', err);
  // counted on the admin overview (only the kind of error and the route, no request data)
  const logged = track(c.env, { name: 'server_error', properties: { route: c.req.routePath, method: c.req.method, error: err instanceof Error ? err.name : 'unknown' } });
  try {
    c.executionCtx.waitUntil(logged);
  } catch {
    /* no execution context (tests) */
  }
  return c.json(errorBody('INTERNAL', 'internal error'), 500);
});

export default app;
