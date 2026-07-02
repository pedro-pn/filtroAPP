import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const moduleRegistryData = require('../../../shared/modules/registry.json');

const modules = moduleRegistryData.modules;
const roleDefinitions = modules.flatMap(module => (
  module.roles.map(role => ({
    ...role,
    moduleId: module.id,
    prismaModule: module.prismaModule
  }))
));

const roleByPrismaCode = new Map(roleDefinitions.map(role => [role.code, role]));
const roleByPublicCode = new Map(roleDefinitions.map(role => [role.public, role]));

export const AccountTypes = {
  ADMIN: 'ADMIN',
  INTERNAL: 'INTERNAL',
  CLIENT: 'CLIENT'
};

export const AppModules = Object.freeze(Object.fromEntries(
  modules
    .filter(module => module.prismaModule)
    .map(module => [module.prismaModule, module.prismaModule])
));

export const ModuleRoleCodes = Object.freeze(Object.fromEntries(
  roleDefinitions.map(role => [role.code, role.code])
));

const LEGACY_ROLE_TO_ACCOUNT_TYPE = Object.fromEntries(
  Object.entries(moduleRegistryData.legacyRoleDefaults).map(([role, config]) => [role, config.accountType])
);

const LEGACY_ROLE_TO_PUBLIC_MODULE_ROLE = Object.fromEntries(
  Object.entries(moduleRegistryData.legacyRoleDefaults).map(([role, config]) => [role, config.moduleRole])
);

const MODULE_ROLE_TO_PUBLIC = Object.fromEntries(
  roleDefinitions.map(role => [role.code, role.public])
);

const PUBLIC_TO_MODULE_ROLE = Object.fromEntries(
  roleDefinitions.map(role => [role.public, role.code])
);

export function accountTypeForLegacyRole(role) {
  return LEGACY_ROLE_TO_ACCOUNT_TYPE[role] || AccountTypes.INTERNAL;
}

export function moduleRoleForLegacyRole(role) {
  const publicRole = LEGACY_ROLE_TO_PUBLIC_MODULE_ROLE[role] || LEGACY_ROLE_TO_PUBLIC_MODULE_ROLE.COLLABORATOR;
  return prismaModuleRole(publicRole) || ModuleRoleCodes.RDO_COLLABORATOR;
}

export function publicModuleRole(code) {
  return MODULE_ROLE_TO_PUBLIC[code] || null;
}

export function prismaModuleRole(publicCode) {
  return PUBLIC_TO_MODULE_ROLE[publicCode] || null;
}

export function moduleForRole(role) {
  return roleByPrismaCode.get(role)?.prismaModule || null;
}

export function defaultPublicModuleRolesForLegacyRole(role) {
  const moduleRole = publicModuleRole(moduleRoleForLegacyRole(role));
  return moduleRole ? [moduleRole] : [];
}

export function publicModuleRoleDefinitions() {
  return roleDefinitions.map(role => ({
    code: role.code,
    public: role.public,
    label: role.label,
    moduleId: role.moduleId,
    prismaModule: role.prismaModule,
    accountTypes: [...role.accountTypes],
    assignableAccountTypes: [...(role.assignableAccountTypes || role.accountTypes)],
    requiredLegacyRole: role.requiredLegacyRole || null
  }));
}

export function publicModuleRolesForAccountType(accountType) {
  return roleDefinitions
    .filter(role => role.accountTypes.includes(accountType))
    .map(role => role.public);
}

export function publicModuleRolesForModule(moduleId, options = {}) {
  const { includeClient = true } = options;
  return roleDefinitions
    .filter(role => role.moduleId === moduleId)
    .filter(role => includeClient || !role.accountTypes.includes(AccountTypes.CLIENT))
    .map(role => role.public);
}

export function requiredLegacyRoleForPublicModuleRole(publicCode) {
  return roleByPublicCode.get(publicCode)?.requiredLegacyRole || null;
}

export function serializeModuleRoles(user) {
  if (Object.prototype.hasOwnProperty.call(user || {}, 'moduleRoles')) {
    const storedRoles = Array.isArray(user?.moduleRoles)
      ? user.moduleRoles.map(item => (typeof item === 'string' ? item : publicModuleRole(item.role))).filter(Boolean)
      : [];
    return Array.from(new Set(storedRoles));
  }
  return defaultPublicModuleRolesForLegacyRole(user?.role);
}

export function normalizePublicModuleRoles(value) {
  const roles = Array.isArray(value) ? value : [];
  return Array.from(new Set(roles.map(item => String(item || '').trim()).filter(item => prismaModuleRole(item))));
}

export function moduleRoleRows(userId, publicRoles) {
  return normalizePublicModuleRoles(publicRoles).map(publicCode => {
    const role = prismaModuleRole(publicCode);
    return {
      userId,
      module: moduleForRole(role),
      role
    };
  });
}

export function isHubAdmin(user) {
  return user?.accountType === AccountTypes.ADMIN || user?.role === 'MANAGER';
}

export function hasModuleRole(user, publicRoles) {
  const accepted = Array.isArray(publicRoles) ? publicRoles : [publicRoles];
  const userRoles = serializeModuleRoles(user);
  return accepted.some(role => userRoles.includes(role));
}
