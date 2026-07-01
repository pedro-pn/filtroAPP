import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { login as loginRequest, logout as logoutRequest, me as meRequest } from '../api/auth';
import { ApiClientError, TOKEN_STORAGE_KEY, UNAUTHORIZED_EVENT } from '../api/client';
import type { AuthUser, LoginPayload } from '../types/auth';
import { AuthContext, type AuthContextValue } from './AuthContext';

function getStoredToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

function isUnauthorizedError(error: unknown) {
  return error instanceof ApiClientError && error.status === 401;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const clearSession = useCallback((expectedToken?: string | null) => {
    if (expectedToken !== undefined && getStoredToken() !== expectedToken) return;
    queryClient.clear();
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, [queryClient]);

  const refreshUser = useCallback(async () => {
    const currentToken = getStoredToken();
    if (!currentToken) {
      clearSession();
      return;
    }
    const currentUser = await meRequest();
    setToken(currentToken);
    setUser(currentUser);
  }, [clearSession]);

  const login = useCallback(async (payload: LoginPayload) => {
    const data = await loginRequest(payload);
    queryClient.clear();
    localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const storedToken = getStoredToken();
      if (!storedToken) {
        if (mounted) setIsBootstrapping(false);
        return;
      }

      try {
        const currentUser = await meRequest();
        if (!mounted) return;
        setToken(storedToken);
        setUser(currentUser);
      } catch (error) {
        if (!mounted) return;
        if (isUnauthorizedError(error)) {
          clearSession(storedToken);
        } else {
          setToken(storedToken);
          setUser(null);
        }
      } finally {
        if (mounted) setIsBootstrapping(false);
      }
    }

    bootstrap();
    return () => {
      mounted = false;
    };
  }, [clearSession]);

  useEffect(() => {
    function handleUnauthorized(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      const unauthorizedToken = typeof detail?.token === 'string' ? detail.token : undefined;
      clearSession(unauthorizedToken);
    }
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isBootstrapping,
      isAuthenticated: !!user && !!token,
      login,
      logout,
      refreshUser,
      replaceUser: setUser
    }),
    [isBootstrapping, login, logout, refreshUser, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
