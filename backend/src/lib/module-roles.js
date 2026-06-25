export const AccountTypes = {
  ADMIN: 'ADMIN',
  INTERNAL: 'INTERNAL',
  CLIENT: 'CLIENT'
};

export const AppModules = {
  RDO: 'RDO',
  ROMANEIO: 'ROMANEIO',
  EPI: 'EPI',
  PRIVACY: 'PRIVACY',
  EQUIPAMENTOS: 'EQUIPAMENTOS',
  ACOMPANHAMENTO: 'ACOMPANHAMENTO'
};

export const ModuleRoleCodes = {
  RDO_MANAGER: 'RDO_MANAGER',
  RDO_COORDINATOR: 'RDO_COORDINATOR',
  RDO_COLLABORATOR: 'RDO_COLLABORATOR',
  RDO_CLIENT: 'RDO_CLIENT',
  ROMANEIO_MANAGER: 'ROMANEIO_MANAGER',
  ROMANEIO_OPERATOR: 'ROMANEIO_OPERATOR',
  EPI_TECHNICIAN: 'EPI_TECHNICIAN',
  EPI_COLLABORATOR: 'EPI_COLLABORATOR',
  PRIVACY_ADMIN: 'PRIVACY_ADMIN',
  EQUIPAMENTOS_MANAGER: 'EQUIPAMENTOS_MANAGER',
  EQUIPAMENTOS_VIEWER: 'EQUIPAMENTOS_VIEWER',
  ACOMPANHAMENTO_MANAGER: 'ACOMPANHAMENTO_MANAGER',
  ACOMPANHAMENTO_VIEWER: 'ACOMPANHAMENTO_VIEWER'
};

const LEGACY_ROLE_TO_ACCOUNT_TYPE = {
  MANAGER: AccountTypes.ADMIN,
  COORDINATOR: AccountTypes.INTERNAL,
  COLLABORATOR: AccountTypes.INTERNAL,
  CLIENT: AccountTypes.CLIENT
};

const LEGACY_ROLE_TO_MODULE_ROLE = {
  MANAGER: ModuleRoleCodes.RDO_MANAGER,
  COORDINATOR: ModuleRoleCodes.RDO_COORDINATOR,
  COLLABORATOR: ModuleRoleCodes.RDO_COLLABORATOR,
  CLIENT: ModuleRoleCodes.RDO_CLIENT
};

const MODULE_ROLE_TO_PUBLIC = {
  [ModuleRoleCodes.RDO_MANAGER]: 'rdo:manager',
  [ModuleRoleCodes.RDO_COORDINATOR]: 'rdo:coordinator',
  [ModuleRoleCodes.RDO_COLLABORATOR]: 'rdo:collaborator',
  [ModuleRoleCodes.RDO_CLIENT]: 'rdo:client',
  [ModuleRoleCodes.ROMANEIO_MANAGER]: 'romaneio:manager',
  [ModuleRoleCodes.ROMANEIO_OPERATOR]: 'romaneio:operator',
  [ModuleRoleCodes.EPI_TECHNICIAN]: 'epi:technician',
  [ModuleRoleCodes.EPI_COLLABORATOR]: 'epi:collaborator',
  [ModuleRoleCodes.PRIVACY_ADMIN]: 'privacy:admin',
  [ModuleRoleCodes.EQUIPAMENTOS_MANAGER]: 'equipamentos:manager',
  [ModuleRoleCodes.EQUIPAMENTOS_VIEWER]: 'equipamentos:viewer',
  [ModuleRoleCodes.ACOMPANHAMENTO_MANAGER]: 'acompanhamento:manager',
  [ModuleRoleCodes.ACOMPANHAMENTO_VIEWER]: 'acompanhamento:viewer'
};

const PUBLIC_TO_MODULE_ROLE = Object.fromEntries(
  Object.entries(MODULE_ROLE_TO_PUBLIC).map(([code, publicCode]) => [publicCode, code])
);

const MODULE_BY_ROLE = {
  [ModuleRoleCodes.RDO_MANAGER]: AppModules.RDO,
  [ModuleRoleCodes.RDO_COORDINATOR]: AppModules.RDO,
  [ModuleRoleCodes.RDO_COLLABORATOR]: AppModules.RDO,
  [ModuleRoleCodes.RDO_CLIENT]: AppModules.RDO,
  [ModuleRoleCodes.ROMANEIO_MANAGER]: AppModules.ROMANEIO,
  [ModuleRoleCodes.ROMANEIO_OPERATOR]: AppModules.ROMANEIO,
  [ModuleRoleCodes.EPI_TECHNICIAN]: AppModules.EPI,
  [ModuleRoleCodes.EPI_COLLABORATOR]: AppModules.EPI,
  [ModuleRoleCodes.PRIVACY_ADMIN]: AppModules.PRIVACY,
  [ModuleRoleCodes.EQUIPAMENTOS_MANAGER]: AppModules.EQUIPAMENTOS,
  [ModuleRoleCodes.EQUIPAMENTOS_VIEWER]: AppModules.EQUIPAMENTOS,
  [ModuleRoleCodes.ACOMPANHAMENTO_MANAGER]: AppModules.ACOMPANHAMENTO,
  [ModuleRoleCodes.ACOMPANHAMENTO_VIEWER]: AppModules.ACOMPANHAMENTO
};

export function accountTypeForLegacyRole(role) {
  return LEGACY_ROLE_TO_ACCOUNT_TYPE[role] || AccountTypes.INTERNAL;
}

export function moduleRoleForLegacyRole(role) {
  return LEGACY_ROLE_TO_MODULE_ROLE[role] || ModuleRoleCodes.RDO_COLLABORATOR;
}

export function publicModuleRole(code) {
  return MODULE_ROLE_TO_PUBLIC[code] || null;
}

export function prismaModuleRole(publicCode) {
  return PUBLIC_TO_MODULE_ROLE[publicCode] || null;
}

export function moduleForRole(role) {
  return MODULE_BY_ROLE[role] || null;
}

export function defaultPublicModuleRolesForLegacyRole(role) {
  const moduleRole = publicModuleRole(moduleRoleForLegacyRole(role));
  return moduleRole ? [moduleRole] : [];
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
