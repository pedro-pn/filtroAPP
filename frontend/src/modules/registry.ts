import {
  legacyRoleDefaults,
  moduleRegistry,
  noneHubModule,
  type AppModuleId,
  type HubModuleId,
  type ModuleRegistry,
  type PublicModuleRole,
  type RegistryAccountType,
  type RegistryLegacyRole
} from './registry.generated';

export {
  legacyRoleDefaults,
  moduleRegistry,
  noneHubModule,
  type AppModuleId,
  type HubModuleId,
  type PublicModuleRole,
  type RegistryAccountType,
  type RegistryLegacyRole
};

export type ModuleDefinition = ModuleRegistry[number];
export type ModuleRouteAccess = {
  allowedAccountTypes?: RegistryAccountType[];
  allowedRoles?: RegistryLegacyRole[];
  allowedModuleRoles?: PublicModuleRole[];
  accessMode?: 'all' | 'any';
};

export interface ModuleRoleOption {
  value: PublicModuleRole;
  label: string;
  moduleId: AppModuleId;
  accountTypes: RegistryAccountType[];
  compatibleAccountTypes: RegistryAccountType[];
}

type ModuleWithOptionalRoutes = ModuleDefinition & {
  legacyRoutes?: Record<string, string>;
  pathExclusions?: readonly string[];
};

type UserWithModules = {
  accountType?: string;
  role?: string;
  moduleRoles?: readonly string[];
} | null | undefined;

const modules = moduleRegistry as readonly ModuleDefinition[];
const moduleById = new Map<string, ModuleDefinition>(modules.map(module => [module.id, module]));

export const moduleRoleOptions: ModuleRoleOption[] = modules.flatMap(module => (
  module.roles.map(role => ({
    value: role.public as PublicModuleRole,
    label: role.label,
    moduleId: module.id,
    accountTypes: [...(('assignableAccountTypes' in role && role.assignableAccountTypes) || role.accountTypes)] as RegistryAccountType[],
    compatibleAccountTypes: [...role.accountTypes] as RegistryAccountType[]
  }))
));

const roleByPublicCode = new Map(moduleRoleOptions.map(option => [option.value, option]));

export function moduleDefinition(moduleId: AppModuleId | string | null | undefined) {
  return moduleId ? moduleById.get(moduleId) || null : null;
}

export function moduleRoutePath(moduleId: AppModuleId, routeKey: string, options: { legacy?: boolean } = {}) {
  const module = moduleDefinition(moduleId) as ModuleWithOptionalRoutes | null;
  const routes = (options.legacy ? module?.legacyRoutes : module?.routes) as Record<string, string> | undefined;
  return routes?.[routeKey] || '';
}

export function modulePathPrefixes(moduleId: AppModuleId) {
  return [...(moduleDefinition(moduleId)?.pathPrefixes || [])];
}

export function modulePathExclusions(moduleId: AppModuleId) {
  const module = moduleDefinition(moduleId) as ModuleWithOptionalRoutes | null;
  return [...(module?.pathExclusions || [])];
}

export function moduleRouteAccess(moduleId: AppModuleId, groupName = 'default'): ModuleRouteAccess {
  const module = moduleDefinition(moduleId);
  const groups = module?.routeGroups as Record<string, ModuleRouteAccess> | undefined;
  const group = groups?.[groupName];

  if (!group) {
    throw new Error(`Grupo de acesso inexistente no registry: ${moduleId}.${groupName}`);
  }

  return {
    ...(group.allowedAccountTypes?.length ? { allowedAccountTypes: [...group.allowedAccountTypes] } : {}),
    ...(group.allowedRoles?.length ? { allowedRoles: [...group.allowedRoles] } : {}),
    ...(group.allowedModuleRoles?.length ? { allowedModuleRoles: [...group.allowedModuleRoles] } : {}),
    ...(group.accessMode ? { accessMode: group.accessMode } : {})
  };
}

export function publicRolesForModule(moduleId: AppModuleId | string) {
  return moduleDefinition(moduleId)?.roles.map(role => role.public as PublicModuleRole) || [];
}

export function moduleIdForPublicRole(role: string) {
  return roleByPublicCode.get(role as PublicModuleRole)?.moduleId || null;
}

export function moduleRoleLabel(role: string) {
  return roleByPublicCode.get(role as PublicModuleRole)?.label || role;
}

export function sameModuleRoles(role: PublicModuleRole) {
  const moduleId = moduleIdForPublicRole(role);
  return moduleId ? publicRolesForModule(moduleId) : [];
}

export function rolesCompatibleWithAccountType(accountType: string) {
  return moduleRoleOptions
    .filter(option => option.compatibleAccountTypes.includes(accountType as RegistryAccountType))
    .map(option => option.value);
}

export function assignableRoleOptionsForAccountType(accountType: string) {
  return moduleRoleOptions.filter(option => option.accountTypes.includes(accountType as RegistryAccountType));
}

export function defaultModuleRoleForLegacyRole(role: string | undefined) {
  return role ? legacyRoleDefaults[role as RegistryLegacyRole]?.moduleRole || '' : '';
}

export function defaultAccountTypeForLegacyRole(role: string | undefined) {
  return role ? legacyRoleDefaults[role as RegistryLegacyRole]?.accountType || 'INTERNAL' : 'INTERNAL';
}

export function requiredLegacyRoleForModuleRole(role: string) {
  const module = modules.find(item => item.roles.some(moduleRole => moduleRole.public === role));
  const roleDefinition = module?.roles.find(moduleRole => moduleRole.public === role);
  return roleDefinition && 'requiredLegacyRole' in roleDefinition ? roleDefinition.requiredLegacyRole || '' : '';
}

export function isHubAdmin(user: UserWithModules) {
  return user?.accountType === 'ADMIN' || user?.role === 'MANAGER';
}

export function userHasAnyPublicRole(user: UserWithModules, roles: readonly string[] | undefined) {
  return Boolean(roles?.some(role => user?.moduleRoles?.includes(role)));
}
