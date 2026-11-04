import { hasAnyModuleRole } from '../auth/rolePath';
import type { AuthUser, ModuleRole } from '../types/auth';

type AccessUser = Pick<AuthUser, 'accountType' | 'moduleRoles' | 'role'> | null | undefined;

// Mesmos papéis de leitura do Efetivo no backend (lib/efetivo/access.js). O papel de conferência
// de alocação é dedicado: ele sozinho abre só a seção Conferência.
const EFETIVO_VIEW_ROLES: ModuleRole[] = [
  'efetivo:manager',
  'efetivo:viewer',
  'efetivo:commercial',
  'efetivo:operations',
  'efetivo:assets',
  'efetivo:supplies',
  'efetivo:administrative',
  'efetivo:qsms'
];

export const ALLOCATION_REVIEW_ROLE: ModuleRole = 'efetivo:allocation-review';

export function canViewEfetivoModule(user: AccessUser) {
  return user?.accountType === 'ADMIN' || hasAnyModuleRole(user, EFETIVO_VIEW_ROLES);
}

export function canReviewAllocation(user: AccessUser) {
  return user?.accountType === 'ADMIN' || hasAnyModuleRole(user, [ALLOCATION_REVIEW_ROLE]);
}

export function isAppAdmin(user: AccessUser) {
  return user?.accountType === 'ADMIN';
}
