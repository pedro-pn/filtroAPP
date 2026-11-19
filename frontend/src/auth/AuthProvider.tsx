import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { isTwoFactorChallenge, login as loginRequest, logout as logoutRequest, me as meRequest, verifyTwoFactor } from '../api/auth';
import { ApiClientError, TOKEN_STORAGE_KEY, UNAUTHORIZED_EVENT } from '../api/client';
import { subscribeToDataUpdates } from '../api/dataUpdates';
import type { AuthUser, LoginOutcome, LoginPayload } from '../types/auth';
import { AuthContext, type AuthContextValue, type SessionEndReason } from './AuthContext';

// Sessão em cookie HttpOnly (spec 041): o app não guarda nem lê o token. O estado
// de login vem de GET /api/auth/me. Valores antigos do localStorage são migrados
// uma vez (sessão no boot, navegador lembrado do 2FA no próximo login) e apagados.
const TRUSTED_DEVICE_STORAGE_PREFIX = 'filtrovali-trusted-device:';
const AUTH_CHANNEL = 'filtrovali-auth';

type AuthBroadcast = { type: 'logout' } | { type: 'login' };

function safeStorage<T>(operation: () => T, fallback: T): T {
  try {
    return operation();
  } catch {
    return fallback;
  }
}

function legacySessionToken() {
  return safeStorage(() => localStorage.getItem(TOKEN_STORAGE_KEY) || '', '');
}

function trustedDeviceKey(username: string) {
  return `${TRUSTED_DEVICE_STORAGE_PREFIX}${username.trim().toLowerCase()}`;
}

function legacyTrustedDeviceToken(username: string) {
  return safeStorage(() => localStorage.getItem(trustedDeviceKey(username)) || undefined, undefined);
}

function forgetLegacyTrustedDevices() {
  safeStorage(() => {
    Object.keys(localStorage)
      .filter(key => key.startsWith(TRUSTED_DEVICE_STORAGE_PREFIX))
      .forEach(key => localStorage.removeItem(key));
  }, undefined);
}

function isUnauthorizedError(error: unknown) {
  return error instanceof ApiClientError && error.status === 401;
}

function endReasonFromCode(code: unknown): SessionEndReason {
  return code === 'SESSION_IDLE' ? 'idle' : 'expired';
}

function openChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'function' ? safeStorage(() => new BroadcastChannel(AUTH_CHANNEL), null) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [sessionEndReason, setSessionEndReason] = useState<SessionEndReason | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  const broadcast = useCallback((message: AuthBroadcast) => {
    safeStorage(() => channelRef.current?.postMessage(message), undefined);
  }, []);

  const clearSession = useCallback((reason: SessionEndReason | null = null) => {
    queryClient.clear();
    safeStorage(() => localStorage.removeItem(TOKEN_STORAGE_KEY), undefined);
    if (reason && userRef.current) setSessionEndReason(reason);
    setUser(null);
  }, [queryClient]);

  const refreshUser = useCallback(async () => {
    try {
      const currentUser = await meRequest();
      setUser(currentUser);
    } catch (error) {
      if (isUnauthorizedError(error)) clearSession('expired');
      else throw error;
    }
  }, [clearSession]);

  const startSession = useCallback((nextUser: AuthUser) => {
    queryClient.clear();
    safeStorage(() => localStorage.removeItem(TOKEN_STORAGE_KEY), undefined);
    setSessionEndReason(null);
    setUser(nextUser);
    broadcast({ type: 'login' });
  }, [broadcast, queryClient]);

  const login = useCallback(async (payload: LoginPayload): Promise<LoginOutcome> => {
    const data = await loginRequest({ ...payload, trustedDeviceToken: payload.trustedDeviceToken ?? legacyTrustedDeviceToken(payload.username) });
    // O navegador lembrado passa a morar no cookie (ou o código é pedido de novo).
    forgetLegacyTrustedDevices();
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
    startSession(data.user);
    return { status: 'authenticated' };
  }, [startSession]);

  const completeTwoFactor = useCallback(async (payload: { username: string; challengeToken: string; code: string; rememberDevice?: boolean }) => {
    const data = await verifyTwoFactor({ challengeToken: payload.challengeToken, code: payload.code, rememberDevice: payload.rememberDevice });
    startSession(data.user);
  }, [startSession]);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      clearSession();
      broadcast({ type: 'logout' });
    }
  }, [broadcast, clearSession]);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const legacy = legacySessionToken();
      try {
        // Com o token antigo, o backend converte a sessão em cookie (transição).
        const currentUser = await meRequest(legacy || undefined);
        if (mounted) setUser(currentUser);
      } catch {
        if (mounted) setUser(null);
      } finally {
        if (legacy) safeStorage(() => localStorage.removeItem(TOKEN_STORAGE_KEY), undefined);
        if (mounted) setIsBootstrapping(false);
      }
    }

    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const channel = openChannel();
    channelRef.current = channel;
    if (!channel) return undefined;
    channel.onmessage = (event: MessageEvent<AuthBroadcast>) => {
      if (event.data?.type === 'logout') clearSession();
      if (event.data?.type === 'login') void refreshUser().catch(() => {});
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [clearSession, refreshUser]);

  useEffect(() => {
    // Um 401 de qualquer chamada: confere a sessão antes de sair (outra aba pode ter
    // acabado de entrar e trocado o cookie).
    function handleUnauthorized(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      const reason = endReasonFromCode(detail?.code);
      meRequest()
        .then(currentUser => setUser(currentUser))
        .catch(error => {
          if (isUnauthorizedError(error)) clearSession(reason);
        });
    }
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [clearSession]);

  const userId = user?.id;
  useEffect(() => {
    if (!userId || isBootstrapping) return;
    let stopped = false;
    let pending = false;
    let refreshQueued = false;
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      if (pending) {
        refreshQueued = true;
        return;
      }
      pending = true;
      try {
        const currentUser = await meRequest();
        if (!stopped) {
          setUser(current => JSON.stringify(current) === JSON.stringify(currentUser) ? current : currentUser);
        }
      } catch (error) {
        if (!stopped && error instanceof ApiClientError && error.status === 401) {
          clearSession(endReasonFromCode(error.code));
        }
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
  }, [clearSession, isBootstrapping, userId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isBootstrapping,
      isAuthenticated: !!user,
      sessionEndReason,
      login,
      completeTwoFactor,
      logout,
      refreshUser,
      replaceUser: setUser
    }),
    [completeTwoFactor, isBootstrapping, login, logout, refreshUser, sessionEndReason, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
