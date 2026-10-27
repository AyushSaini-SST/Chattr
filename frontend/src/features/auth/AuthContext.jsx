import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../services/api.js';
import { hydrateCurrentUser, mergeCurrentUser } from './userState.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const authVersion = useRef(0);
  useEffect(() => {
    let active = true;
    const requestVersion = authVersion.current;
    const controller = new AbortController();
    api.get('/api/auth/me', { signal: controller.signal })
      .then(({ data }) => setUser((current) => active && requestVersion === authVersion.current ? hydrateCurrentUser(current, data.user) : current))
      .catch((error) => {
        if (error.code === 'ERR_CANCELED') return;
        setUser((current) => active && requestVersion === authVersion.current ? null : current);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, []);
  const value = useMemo(() => ({
    user, loading,
    async login(values) { const { data } = await api.post('/api/auth/login', values); authVersion.current += 1; setUser(data.user); return data.user; },
    async register(values) { const { data } = await api.post('/api/auth/register', values); authVersion.current += 1; setUser(data.user); return data.user; },
    async logout() { await api.post('/api/auth/logout'); authVersion.current += 1; setUser(null); },
    async refreshUser() {
      const requestVersion = authVersion.current;
      const { data } = await api.get('/api/auth/me');
      setUser((current) => requestVersion === authVersion.current ? hydrateCurrentUser(current, data.user) : current);
      return data.user;
    },
    updateCurrentUser(updatedUser) { authVersion.current += 1; setUser((current) => mergeCurrentUser(current, updatedUser)); },
  }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}
