const BASE = import.meta.env.VITE_API_URL ?? '';
let token: string | null = null;
try {
  token = sessionStorage.getItem('fd.admin.token');
} catch {
  token = null;
}

export class AdminApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function setAdminToken(t: string | null) {
  token = t;
  try {
    if (t) sessionStorage.setItem('fd.admin.token', t);
    else sessionStorage.removeItem('fd.admin.token');
  } catch {
    /* storage unavailable */
  }
}

export function hasToken() {
  return !!token;
}

export async function adminApi<T>(path: string, body?: unknown, method?: 'POST' | 'PATCH'): Promise<T> {
  const res = await fetch(`${BASE}/api/admin${path}`, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith('/auth/login')) {
      setAdminToken(null);
      window.dispatchEvent(new Event('fd-admin:logout'));
    }
    throw new AdminApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? res.statusText);
  }
  return data as T;
}
