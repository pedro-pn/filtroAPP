import { hasAnyModuleRole } from './rolePath';
import type { AccountType, AuthUser, ModuleRole, UserRole } from '../types/auth';

export interface RouteAccessOptions {
  allowedAccountTypes?: AccountType[];
  allowedRoles?: UserRole[];
  allowedModuleRoles?: ModuleRole[];
  accessMode?: 'all' | 'any';
}

export function isRouteAllowed(user: AuthUser, options: RouteAccessOptions) {
  const { allowedAccountTypes = [], allowedRoles = [], allowedModuleRoles = [], accessMode = 'all' } = options;
  const accountTypeAllowed = allowedAccountTypes.length ? allowedAccountTypes.includes(user.accountType) : true;
  const roleAllowed = allowedRoles.length ? allowedRoles.includes(user.role) : true;
  const moduleAllowed = allowedModuleRoles.length ? hasAnyModuleRole(user, allowedModuleRoles) : true;

  if (accessMode === 'any') {
    const checks = [
      allowedAccountTypes.length ? accountTypeAllowed : null,
      allowedRoles.length ? roleAllowed : null,
      allowedModuleRoles.length ? moduleAllowed : null
    ].filter((allowed): allowed is boolean => allowed !== null);
    return checks.length ? checks.some(Boolean) : true;
  }

  return accountTypeAllowed && roleAllowed && moduleAllowed;
}
