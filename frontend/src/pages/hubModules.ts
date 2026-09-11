import { roleHomePath } from '../auth/rolePath';
import { canAccessOperationalModule } from '../auth/reportPermissions';
import { isHubAdmin, moduleRegistry, noneHubModule, userHasAnyPublicRole, type HubModuleId } from '../modules/registry';
import type { AuthUser } from '../types/auth';

export interface HubModuleEntry {
  id: HubModuleId;
  badge: string;
  title: string;
  copy: string;
  path?: string;
  disabled?: boolean;
}

type HubConfig = {
  enabled?: boolean;
  adminOnly?: boolean;
  roles?: readonly string[];
  path?: string;
  pathStrategy?: 'roleHome';
};

function modulePathForHub(module: (typeof moduleRegistry)[number], user: Pick<AuthUser, 'accountType' | 'moduleRoles' | 'reportEmissionPermissions' | 'role'> | null | undefined) {
  if (module.id === 'rdo' && user?.reportEmissionPermissions?.includes('SITE_RDO') && !user.moduleRoles?.some(role => role.startsWith('rdo:'))) return '/rdo/relatorio/novo';
  const hub = module.hub as HubConfig | undefined;
  if (hub?.pathStrategy === 'roleHome') return roleHomePath(user?.role);
  return hub?.path;
}

export function hubModulesForUser(user: Pick<AuthUser, 'accountType' | 'moduleRoles' | 'reportEmissionPermissions' | 'role'> | null | undefined): HubModuleEntry[] {
  const modules: HubModuleEntry[] = moduleRegistry
    .filter(module => module.hub?.enabled)
    .filter(module => {
      const hub = module.hub as HubConfig | undefined;
      if (hub?.adminOnly) return isHubAdmin(user);
      if (module.id === 'maintenance-production') {
        return canAccessOperationalModule(
          user?.reportEmissionPermissions || []
        );
      }
      if (module.id === 'rdo' && user?.reportEmissionPermissions?.includes('SITE_RDO')) return true;
      return userHasAnyPublicRole(user, hub?.roles);
    })
    .map(module => ({
      id: module.id,
      badge: module.badge,
      title: module.title,
      copy: module.copy,
      path: modulePathForHub(module, user)
    }));

  return modules.length ? modules : [noneHubModule];
}
