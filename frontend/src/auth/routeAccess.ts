import { hasAnyModuleRole } from './rolePath';
import type { AccountType, AuthUser, ModuleRole, UserRole } from '../types/auth';

export interface RouteAccessOptions {
  allowedAccountTypes?: AccountType[];
  allowedRoles?: UserRole[];
  allowedModuleRoles?: ModuleRole[];
}

export function isRouteAllowed(user: AuthUser, options: RouteAccessOptions) {
  const { allowedAccountTypes = [], allowedRoles = [], allowedModuleRoles = [] } = options;
  const accountTypeAllowed = allowedAccountTypes.length ? allowedAccountTypes.includes(user.accountType) : true;
  const roleAllowed = allowedRoles.length ? allowedRoles.includes(user.role) : true;
  const moduleAllowed = allowedModuleRoles.length ? hasAnyModuleRole(user, allowedModuleRoles) : true;

  return accountTypeAllowed && roleAllowed && moduleAllowed;
}
