import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const moduleRegistryPath = path.join(repoRoot, 'shared/modules/registry.json');
export const generatedFrontendRegistryPath = path.join(repoRoot, 'frontend/src/modules/registry.generated.ts');

const ACCOUNT_TYPES = new Set(['ADMIN', 'INTERNAL', 'CLIENT']);
const LEGACY_ROLES = new Set(['MANAGER', 'COORDINATOR', 'COLLABORATOR', 'CLIENT']);

function sortedUnique(values) {
  return Array.from(new Set(values));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPath(value) {
  return typeof value === 'string' && value.startsWith('/');
}

export function loadModuleRegistry() {
  return JSON.parse(fs.readFileSync(moduleRegistryPath, 'utf8'));
}

export function validateModuleRegistry(registry) {
  const failures = [];
  const moduleIds = new Set();
  const prismaModules = new Set();
  const publicRoles = new Set();
  const prismaRoles = new Set();

  if (!isPlainObject(registry)) {
    return ['Registry de modulos precisa ser um objeto JSON.'];
  }

  if (!isPlainObject(registry.legacyRoleDefaults)) {
    failures.push('legacyRoleDefaults precisa ser um objeto.');
  }

  if (!Array.isArray(registry.modules) || !registry.modules.length) {
    failures.push('modules precisa ser uma lista nao vazia.');
    return failures;
  }

  for (const [legacyRole, config] of Object.entries(registry.legacyRoleDefaults || {})) {
    if (!LEGACY_ROLES.has(legacyRole)) {
      failures.push(`legacyRoleDefaults.${legacyRole} nao e um role legado valido.`);
    }
    if (!ACCOUNT_TYPES.has(config?.accountType)) {
      failures.push(`legacyRoleDefaults.${legacyRole}.accountType invalido.`);
    }
    if (typeof config?.moduleRole !== 'string') {
      failures.push(`legacyRoleDefaults.${legacyRole}.moduleRole precisa ser string.`);
    }
  }

  for (const module of registry.modules) {
    if (!module.id || !/^[a-z][a-z0-9-]*$/.test(module.id)) {
      failures.push(`Modulo com id invalido: ${module.id || '<vazio>'}.`);
      continue;
    }
    if (moduleIds.has(module.id)) {
      failures.push(`Modulo duplicado no registry: ${module.id}.`);
    }
    moduleIds.add(module.id);

    if (module.prismaModule) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(module.prismaModule)) {
        failures.push(`${module.id}.prismaModule invalido.`);
      }
      if (prismaModules.has(module.prismaModule)) {
        failures.push(`prismaModule duplicado no registry: ${module.prismaModule}.`);
      }
      prismaModules.add(module.prismaModule);
    }

    for (const key of ['badge', 'title', 'copy']) {
      if (typeof module[key] !== 'string' || !module[key].trim()) {
        failures.push(`${module.id}.${key} precisa ser string nao vazia.`);
      }
    }

    for (const prefix of module.pathPrefixes || []) {
      if (!isPath(prefix)) failures.push(`${module.id}.pathPrefixes contem caminho invalido: ${prefix}.`);
    }
    for (const prefix of module.pathExclusions || []) {
      if (!isPath(prefix)) failures.push(`${module.id}.pathExclusions contem caminho invalido: ${prefix}.`);
    }

    for (const [routeKey, routePath] of Object.entries(module.routes || {})) {
      if (!routeKey || !isPath(routePath)) failures.push(`${module.id}.routes.${routeKey} invalido.`);
    }
    for (const [routeKey, routePath] of Object.entries(module.legacyRoutes || {})) {
      if (!routeKey || !isPath(routePath)) failures.push(`${module.id}.legacyRoutes.${routeKey} invalido.`);
    }

    if (!Array.isArray(module.roles)) {
      failures.push(`${module.id}.roles precisa ser uma lista.`);
      continue;
    }

    const modulePublicRoles = new Set();
    for (const role of module.roles) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(role.code || '')) {
        failures.push(`${module.id}.roles contem code invalido: ${role.code || '<vazio>'}.`);
      }
      if (role.code && prismaRoles.has(role.code)) {
        failures.push(`Role Prisma duplicada no registry: ${role.code}.`);
      }
      if (role.code) prismaRoles.add(role.code);

      if (!role.public || !role.public.startsWith(`${module.id}:`)) {
        failures.push(`${module.id}.roles.${role.code || '<sem-code>'}.public deve comecar com "${module.id}:".`);
      }
      if (role.public && publicRoles.has(role.public)) {
        failures.push(`Role publica duplicada no registry: ${role.public}.`);
      }
      if (role.public) {
        publicRoles.add(role.public);
        modulePublicRoles.add(role.public);
      }

      if (typeof role.label !== 'string' || !role.label.trim()) {
        failures.push(`${module.id}.roles.${role.code || role.public}.label precisa ser string nao vazia.`);
      }
      for (const accountType of role.accountTypes || []) {
        if (!ACCOUNT_TYPES.has(accountType)) {
          failures.push(`${module.id}.roles.${role.public}.accountTypes contem ${accountType} invalido.`);
        }
      }
      for (const accountType of role.assignableAccountTypes || []) {
        if (!ACCOUNT_TYPES.has(accountType)) {
          failures.push(`${module.id}.roles.${role.public}.assignableAccountTypes contem ${accountType} invalido.`);
        }
      }
      if (role.requiredLegacyRole && !LEGACY_ROLES.has(role.requiredLegacyRole)) {
        failures.push(`${module.id}.roles.${role.public}.requiredLegacyRole invalido.`);
      }
    }

    for (const hubRole of module.hub?.roles || []) {
      if (!modulePublicRoles.has(hubRole)) {
        failures.push(`${module.id}.hub.roles referencia role inexistente: ${hubRole}.`);
      }
    }
    if (module.hub?.path && !isPath(module.hub.path)) {
      failures.push(`${module.id}.hub.path invalido.`);
    }

    for (const [groupName, group] of Object.entries(module.routeGroups || {})) {
      for (const accountType of group.allowedAccountTypes || []) {
        if (!ACCOUNT_TYPES.has(accountType)) {
          failures.push(`${module.id}.routeGroups.${groupName}.allowedAccountTypes contem ${accountType} invalido.`);
        }
      }
      for (const legacyRole of group.allowedRoles || []) {
        if (!LEGACY_ROLES.has(legacyRole)) {
          failures.push(`${module.id}.routeGroups.${groupName}.allowedRoles contem ${legacyRole} invalido.`);
        }
      }
      for (const publicRole of group.allowedModuleRoles || []) {
        if (!publicRoles.has(publicRole)) {
          failures.push(`${module.id}.routeGroups.${groupName}.allowedModuleRoles referencia ${publicRole} inexistente.`);
        }
      }
    }
  }

  for (const [legacyRole, config] of Object.entries(registry.legacyRoleDefaults || {})) {
    if (config?.moduleRole && !publicRoles.has(config.moduleRole)) {
      failures.push(`legacyRoleDefaults.${legacyRole}.moduleRole referencia ${config.moduleRole} inexistente.`);
    }
  }

  const noneModule = registry.noneModule || {};
  for (const key of ['id', 'badge', 'title', 'copy']) {
    if (typeof noneModule[key] !== 'string' || !noneModule[key].trim()) {
      failures.push(`noneModule.${key} precisa ser string nao vazia.`);
    }
  }

  return sortedUnique(failures);
}

export function generatedRegistrySource(registry) {
  return [
    '/* Auto-generated by scripts/generate-module-registry.mjs. Do not edit manually. */',
    '',
    `export const moduleRegistry = ${JSON.stringify(registry.modules, null, 2)} as const;`,
    '',
    `export const legacyRoleDefaults = ${JSON.stringify(registry.legacyRoleDefaults, null, 2)} as const;`,
    '',
    `export const noneHubModule = ${JSON.stringify(registry.noneModule, null, 2)} as const;`,
    '',
    'export type ModuleRegistry = typeof moduleRegistry;',
    "export type AppModuleId = ModuleRegistry[number]['id'];",
    "export type HubModuleId = AppModuleId | typeof noneHubModule['id'];",
    "export type ModuleRoleDefinition = ModuleRegistry[number]['roles'][number];",
    "export type PublicModuleRole = ModuleRoleDefinition['public'];",
    "export type RegistryAccountType = ModuleRoleDefinition['accountTypes'][number];",
    "export type RegistryLegacyRole = keyof typeof legacyRoleDefaults;",
    ''
  ].join('\n');
}

export function writeGeneratedRegistry() {
  const registry = loadModuleRegistry();
  const failures = validateModuleRegistry(registry);
  if (failures.length) {
    throw new Error(`Registry de modulos invalido:\n- ${failures.join('\n- ')}`);
  }

  fs.mkdirSync(path.dirname(generatedFrontendRegistryPath), { recursive: true });
  fs.writeFileSync(generatedFrontendRegistryPath, generatedRegistrySource(registry));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeGeneratedRegistry();
  console.log('Generated frontend module registry.');
}
