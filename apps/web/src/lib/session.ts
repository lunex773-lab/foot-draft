import { APP_VERSION, getToken } from './api';

/**
 * App sessions (spec 16-1). A session starts when the game is shown and ends
 * when it is hidden or closed; the server records session_started /
 * session_ended (with the visible time) for DAU and play time.
 */
const BASE = import.meta.env.VITE_API_URL ?? '';

let current: { id: string; startedAt: number } | null = null;

function newId() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function post(path: string, body: unknown) {
  const token = getToken();
  if (!token) return;
  // keepalive lets the request finish while the page is closing
  fetch(`${BASE}${path}`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-FD-Platform': 'web', 'X-FD-App-Version': APP_VERSION },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

function start() {
  if (current || document.visibilityState === 'hidden') return;
  current = { id: newId(), startedAt: Date.now() };
  post('/api/sessions/start', { sessionId: current.id });
}

function end() {
  if (!current) return;
  post('/api/sessions/end', { sessionId: current.id, durationMs: Date.now() - current.startedAt });
  current = null;
}

/** starts tracking for the logged-in player; returns the cleanup */
export function trackSessions(): () => void {
  const onVisibility = () => (document.visibilityState === 'hidden' ? end() : start());
  start();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', end);
  return () => {
    end();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', end);
  };
}
