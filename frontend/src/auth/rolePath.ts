import type { AccountType, AuthUser, UserRole } from '../types/auth';

export function roleHomePath(role: UserRole | undefined) {
  if (role === 'MANAGER') return '/gestor';
  if (role === 'COORDINATOR') return '/coordenador';
  if (role === 'CLIENT') return '/cliente';
  return '/home';
}

export function hubHomePath(user: AuthUser | null): string {
  if (!user) return '/';
  if (user.accountType === 'CLIENT') return '/cliente';
  return '/hub';
}

export function isClientAccount(accountType: AccountType | undefined): boolean {
  return accountType === 'CLIENT';
}

export function isAdminAccount(accountType: AccountType | undefined): boolean {
  return accountType === 'ADMIN';
}
