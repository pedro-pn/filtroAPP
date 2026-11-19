import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { isTwoFactorChallenge, login as loginRequest, logout as logoutRequest, me as meRequest, verifyTwoFactor, type LoginResponse } from '../api/auth';
import { ApiClientError, TOKEN_STORAGE_KEY, UNAUTHORIZED_EVENT } from '../api/client';
import { subscribeToDataUpdates } from '../api/dataUpdates';
import type { AuthUser, LoginOutcome, LoginPayload } from '../types/auth';
import { AuthContext, type AuthContextValue } from './AuthContext';

function getStoredToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

// Navegador lembrado para o 2FA (30 dias), por conta: um navegador compartilhado
// não reaproveita o token de outra pessoa.
const TRUSTED_DEVICE_STORAGE_PREFIX = 'filtrovali-trusted-device:';

function trustedDeviceKey(username: string) {
  return `${TRUSTED_DEVICE_STORAGE_PREFIX}${username.trim().toLowerCase()}`;
}

function readTrustedDeviceToken(username: string) {
  try {
    return localStorage.getItem(trustedDeviceKey(username)) || undefined;
  } catch {
    return undefined;
  }
}

function storeTrustedDeviceToken(username: string, token: string | undefined) {
  try {
    if (token) localStorage.setItem(trustedDeviceKey(username), token);
  } catch {
    // Sem armazenamento local, o código volta a ser pedido no próximo login.
  }
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

  const startSession = useCallback((data: LoginResponse) => {
    queryClient.clear();
    localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
  }, [queryClient]);

  const login = useCallback(async (payload: LoginPayload): Promise<LoginOutcome> => {
    const data = await loginRequest({ ...payload, trustedDeviceToken: payload.trustedDeviceToken ?? readTrustedDeviceToken(payload.username) });
    if (isTwoFactorChallenge(data)) {
      return {
        status: 'two-factor',
        challenge: {
          challengeToken: data.challengeToken,
          emailHint: data.emailHint,
          expiresAt: data.expiresAt,
          trustedDeviceDays: data.trustedDeviceDays
        }
      };
    }
    startSession(data);
    return { status: 'authenticated' };
  }, [startSession]);

  const completeTwoFactor = useCallback(async (payload: { username: string; challengeToken: string; code: string; rememberDevice?: boolean }) => {
    const data = await verifyTwoFactor({ challengeToken: payload.challengeToken, code: payload.code, rememberDevice: payload.rememberDevice });
    if (payload.rememberDevice) storeTrustedDeviceToken(payload.username, data.trustedDeviceToken);
    startSession(data);
  }, [startSession]);

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
          clearSession(storedToken);
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

  useEffect(() => {
    if (!token || isBootstrapping) return;
    let stopped = false;
    let pending = false;
    let refreshQueued = false;
    const refresh = async () => {
      if (document.visibilityState === 'hidden' || getStoredToken() !== token) return;
      if (pending) {
        refreshQueued = true;
        return;
      }
      pending = true;
      try {
        const currentUser = await meRequest();
        if (!stopped && getStoredToken() === token) {
          setUser(current => JSON.stringify(current) === JSON.stringify(currentUser) ? current : currentUser);
        }
      } catch (error) {
        if (!stopped && isUnauthorizedError(error)) clearSession(token);
      } finally {
        pending = false;
        if (refreshQueued && !stopped) {
          refreshQueued = false;
          void refresh();
        }
      }
    };
    const onRefresh = () => { void refresh(); };
    const unsubscribe = subscribeToDataUpdates(prefixes => {
      if (prefixes.includes('users')) onRefresh();
    });
    const interval = window.setInterval(onRefresh, 60_000);
    window.addEventListener('focus', onRefresh);
    window.addEventListener('online', onRefresh);
    document.addEventListener('visibilitychange', onRefresh);
    return () => {
      stopped = true;
      unsubscribe();
      window.clearInterval(interval);
      window.removeEventListener('focus', onRefresh);
      window.removeEventListener('online', onRefresh);
      document.removeEventListener('visibilitychange', onRefresh);
    };
  }, [clearSession, isBootstrapping, token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isBootstrapping,
      isAuthenticated: !!user && !!token,
      login,
      completeTwoFactor,
      logout,
      refreshUser,
      replaceUser: setUser
    }),
    [completeTwoFactor, isBootstrapping, login, logout, refreshUser, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
