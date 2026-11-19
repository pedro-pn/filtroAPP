import { createContext, useContext } from 'react';

import type { AuthUser, LoginOutcome, LoginPayload } from '../types/auth';

// Por que a sessão terminou sem o usuário sair (mostrado na tela de login).
export type SessionEndReason = 'idle' | 'expired';

export interface AuthContextValue {
  user: AuthUser | null;
  isBootstrapping: boolean;
  isAuthenticated: boolean;
  sessionEndReason: SessionEndReason | null;
  login: (payload: LoginPayload) => Promise<LoginOutcome>;
  completeTwoFactor: (payload: { username: string; challengeToken: string; code: string; rememberDevice?: boolean }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  replaceUser: (user: AuthUser | null) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider');
  }
  return context;
}
