import type { AuthUser, ModuleRole, UserRole } from '../types/auth';

export function rdoPath(path = '') {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized === '/' ? '/rdo' : `/rdo${normalized}`;
}

export function roleHomePath(role: UserRole | undefined) {
  if (role === 'MANAGER') return rdoPath('/gestor');
  if (role === 'COORDINATOR') return rdoPath('/coordenador');
  if (role === 'CLIENT') return rdoPath('/cliente');
  return rdoPath('/home');
}

export function rdoReportDetailPath(user: Pick<AuthUser, 'role'> | null | undefined, reportId: string) {
  if (user?.role === 'MANAGER') return rdoPath(`/gestor/relatorio/${reportId}`);
  if (user?.role === 'COORDINATOR') return rdoPath(`/coordenador/relatorio/${reportId}`);
  if (user?.role === 'CLIENT') return rdoPath(`/cliente/relatorio/${reportId}`);
  return rdoPath(`/relatorios/${reportId}`);
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
  if (user.accountType === 'CLIENT' || user.role === 'CLIENT') return rdoPath('/cliente');
  return '/';
}
