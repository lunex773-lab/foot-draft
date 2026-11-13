import { SIM_VERSION } from '@fd/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from './env';
import { ApiError, errorBody } from './lib/http';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { draftRoutes } from './routes/drafts';
import { eventRoutes } from './routes/events';
import { matchRoutes } from './routes/matches';
import { playerRoutes } from './routes/players';
import { rankedRoutes } from './routes/ranked';
import { roomRoutes } from './routes/rooms';
import { soloRoutes } from './routes/solo';
import { userRoutes } from './routes/users';

export { RoomDO } from './room/RoomDO';

const app = new Hono<AppEnv>();

app.use('/api/*', async (c, next) => {
  const origins = (c.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return cors({
    origin: (origin) => (origins.includes(origin) ? origin : null),
    allowHeaders: ['Authorization', 'Content-Type', 'X-FD-Platform', 'X-FD-App-Version'],
    allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
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
app.route('/api/admin', adminRoutes);

app.notFound((c) => c.json(errorBody('NOT_FOUND', 'not found'), 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json(errorBody(err.code, err.message), err.status);
  if (err instanceof HTTPException) return c.json(errorBody('HTTP_ERROR', err.message), err.status);
  console.error('unhandled error', err);
  return c.json(errorBody('INTERNAL', 'internal error'), 500);
});

export default app;
