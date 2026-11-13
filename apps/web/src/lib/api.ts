/** Small fetch wrapper for the FOOTBALL DRAFT API. */
const BASE = import.meta.env.VITE_API_URL ?? '';
export const APP_VERSION = '0.1.0';

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let token: string | null = null;
try {
  token = localStorage.getItem('fd.token');
} catch {
  token = null;
}

export function getToken() {
  return token;
}

export function setToken(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem('fd.token', t);
    else localStorage.removeItem('fd.token');
  } catch {
    /* storage unavailable */
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      'X-FD-Platform': 'web',
      'X-FD-App-Version': APP_VERSION,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && token) window.dispatchEvent(new Event('fd:unauthorized'));
    throw new ApiFailure(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? res.statusText);
  }
  return data as T;
}

export function wsUrl(path: string): string {
  const base = BASE || window.location.origin;
  return base.replace(/^http/, 'ws') + path;
}
