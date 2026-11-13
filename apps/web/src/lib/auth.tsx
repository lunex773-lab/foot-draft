import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';

export interface Me {
  id: string;
  username: string;
  displayName: string;
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api<{ user: Me }>('/api/users/me')
      .then((r) => setMe(r.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setToken(null);
      setMe(null);
    };
    window.addEventListener('fd:unauthorized', onUnauthorized);
    return () => window.removeEventListener('fd:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api<{ token: string; user: Me }>('/api/auth/login', { body: { username, password } });
    setToken(r.token);
    setMe(r.user);
  }, []);

  const register = useCallback(async (username: string, password: string, displayName: string) => {
    const r = await api<{ token: string; user: Me }>('/api/auth/register', { body: { username, password, displayName } });
    setToken(r.token);
    setMe(r.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { body: {} });
    } finally {
      setToken(null);
      setMe(null);
    }
  }, []);

  return <Ctx.Provider value={{ me, loading, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
