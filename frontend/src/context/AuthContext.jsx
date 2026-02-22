import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import * as authService from '../services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const login = useCallback(async (email, password) => {
    const { user: u, token } = await authService.login(email, password);
    authService.setStoredAuth(u, token);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
  }, []);

  useEffect(() => {
    const token = authService.getStoredToken();
    const storedUser = authService.getStoredUser();
    if (!token) {
      setUser(null);
      setAuthLoading(false);
      return;
    }
    setUser(storedUser);
    authService
      .fetchMe()
      .then((data) => {
        setUser(data?.user ?? storedUser);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setAuthLoading(false);
      });
  }, []);

  const value = {
    user,
    authLoading,
    login,
    logout,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
