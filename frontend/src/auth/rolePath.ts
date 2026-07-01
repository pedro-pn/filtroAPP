import type { AuthUser, ModuleRole, UserRole } from '../types/auth';
import { moduleRoutePath } from '../modules/registry';

export function rdoPath(path = '') {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized === '/' ? '/rdo' : `/rdo${normalized}`;
}

export function roleHomePath(role: UserRole | undefined) {
  if (role === 'MANAGER') return moduleRoutePath('rdo', 'managerHome');
  if (role === 'COORDINATOR') return moduleRoutePath('rdo', 'coordinatorHome');
  if (role === 'CLIENT') return moduleRoutePath('rdo', 'clientHome');
  return moduleRoutePath('rdo', 'collaboratorHome');
}

export function rdoReportDetailPath(user: Pick<AuthUser, 'role'> | null | undefined, reportId: string) {
  if (user?.role === 'MANAGER') return moduleRoutePath('rdo', 'managerReportDetail').replace(':id', reportId);
  if (user?.role === 'COORDINATOR') return moduleRoutePath('rdo', 'coordinatorReportDetail').replace(':id', reportId);
  if (user?.role === 'CLIENT') return moduleRoutePath('rdo', 'clientReportDetail').replace(':id', reportId);
  return moduleRoutePath('rdo', 'reportDetail').replace(':id', reportId);
}

export function hasModuleRole(user: Pick<AuthUser, 'accountType' | 'moduleRoles' | 'role'> | null | undefined, role: ModuleRole) {
  if (!user) return false;
  return user.moduleRoles?.includes(role) || false;
}

export function hasAnyModuleRole(user: Pick<AuthUser, 'accountType' | 'moduleRoles' | 'role'> | null | undefined, roles: ModuleRole[]) {
  return roles.some(role => hasModuleRole(user, role));
}

export function userEntryPath(user: AuthUser | null | undefined) {
  if (!user) return '/login';
  if (user.accountType === 'CLIENT' || user.role === 'CLIENT') return moduleRoutePath('rdo', 'clientHome');
  return '/';
}
