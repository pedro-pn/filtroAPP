import type { AccountType, ModuleRole } from '../../types/auth';
import { rolesCompatibleWithAccountType, sameModuleRoles } from '../../modules/registry';
import { ALLOCATION_REVIEW_ROLE } from '../../utils/allocationReviewAccess';

export function toggleAccountModuleRole(currentRoles: ModuleRole[], role: ModuleRole): ModuleRole[] {
  if (currentRoles.includes(role)) return currentRoles.filter(item => item !== role);

  // A conferência pode ser acumulada com o papel principal do Efetivo.
  const conflictingRoles = role === ALLOCATION_REVIEW_ROLE
    ? []
    : sameModuleRoles(role).filter(item => item !== ALLOCATION_REVIEW_ROLE);
  return [...currentRoles.filter(item => !conflictingRoles.includes(item)), role];
}

export function rolesForAccountType(accountType: AccountType, currentRoles: ModuleRole[]): ModuleRole[] {
  if (accountType === 'CLIENT') return ['rdo:client'];
  const compatibleRoles = new Set(rolesCompatibleWithAccountType(accountType));
  const roles = currentRoles.filter(role => compatibleRoles.has(role));
  return Array.from(new Set<ModuleRole>(roles));
}
