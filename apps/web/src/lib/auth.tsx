import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@vitalog/shared';
import { ApiError, get, onUnauthorized, post, setCsrfToken } from './api';
import { applyTheme } from './theme';

interface AuthState {
  me: MeResponse | null;
  loading: boolean;
  sessionExpired: boolean;
  setMe: (me: MeResponse | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const qc = useQueryClient();

  const setMe = useCallback((m: MeResponse | null) => {
    setMeState(m);
    setCsrfToken(m?.csrfToken ?? null);
    if (m) {
      setSessionExpired(false);
      applyTheme(m.profile.theme);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setMe(await get<MeResponse>('/api/auth/me'));
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 401) setMe(null);
    } finally {
      setLoading(false);
    }
  }, [setMe]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => onUnauthorized(() => {
    setMeState((cur) => { if (cur) setSessionExpired(true); return null; });
    setCsrfToken(null);
    qc.clear(); // never keep health data in memory after the session ends
  }), [qc]);

  const logout = useCallback(async () => {
    try { await post('/api/auth/logout'); } catch { /* ignore */ }
    setMe(null);
    qc.clear();
  }, [qc, setMe]);

  const value = useMemo(() => ({ me, loading, sessionExpired, setMe, refresh, logout }), [me, loading, sessionExpired, setMe, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
