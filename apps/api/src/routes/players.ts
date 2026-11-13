import { Hono } from 'hono';
import { requireUser } from '../lib/auth';
import { loadCatalog } from '../lib/players';
import type { AppEnv } from '../env';

export const playerRoutes = new Hono<AppEnv>();
playerRoutes.use('*', requireUser);

/** Full card catalog (game data). Cached by the client. */
playerRoutes.get('/', async (c) => {
  const players = await loadCatalog(c.env);
  c.header('Cache-Control', 'private, max-age=300');
  return c.json({ players });
});
