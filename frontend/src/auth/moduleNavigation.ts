import { hubModulesForUser } from '../pages/hubModules';
import { modulePathExclusions, modulePathPrefixes, moduleRegistry, type AppModuleId } from '../modules/registry';
import type { AuthUser } from '../types/auth';

const LAST_MODULE_KEY_PREFIX = 'filtrovali:last-module:';
const HUB_FIRST_LOGIN_TUTORIAL_KEY_PREFIX = 'filtrovali:hub-first-login-tutorial:';

function storageKey(user: Pick<AuthUser, 'id'>) {
  return `${LAST_MODULE_KEY_PREFIX}${user.id}`;
}

function hubFirstLoginTutorialStorageKey(user: Pick<AuthUser, 'id'>) {
  return `${HUB_FIRST_LOGIN_TUTORIAL_KEY_PREFIX}${user.id}`;
}

function safeLocalStorageGet(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage can be unavailable in private or restricted contexts.
  }
}

function isClientAccount(user: Pick<AuthUser, 'accountType' | 'role'> | null | undefined) {
  return user?.accountType === 'CLIENT' || user?.role === 'CLIENT';
}

function pathMatchesPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function availableHubModulesForUser(user: AuthUser | null | undefined) {
  return hubModulesForUser(user).filter(module => module.path && !module.disabled);
}

export function hasSeenHubFirstLoginTutorial(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return true;
  return safeLocalStorageGet(hubFirstLoginTutorialStorageKey(user)) === '1';
}

export function markHubFirstLoginTutorialSeen(user: Pick<AuthUser, 'id'> | null | undefined) {
  if (!user) return;
  safeLocalStorageSet(hubFirstLoginTutorialStorageKey(user), '1');
}

export function shouldOpenHubOnFirstLogin(user: AuthUser | null | undefined) {
  if (!user || isClientAccount(user)) return false;
  return availableHubModulesForUser(user).length > 1 && !hasSeenHubFirstLoginTutorial(user);
}

export function moduleIdFromPath(pathname: string): AppModuleId | null {
  const path = pathname || '/';
  for (const module of moduleRegistry) {
    if (modulePathExclusions(module.id).some(prefix => pathMatchesPrefix(path, prefix))) return null;
    if (modulePathPrefixes(module.id).some(prefix => pathMatchesPrefix(path, prefix))) return module.id;
  }
  return null;
}

export function modulePathForUser(user: AuthUser | null | undefined, moduleId: AppModuleId | null | undefined) {
  if (!user || !moduleId) return '';
  const module = hubModulesForUser(user).find(item => item.id === moduleId && item.path && !item.disabled);
  return module?.path || '';
}

export function rememberModuleAccess(user: AuthUser | null | undefined, pathname: string) {
  if (!user) return;
  const moduleId = moduleIdFromPath(pathname);
  if (!moduleId || !modulePathForUser(user, moduleId)) return;
  safeLocalStorageSet(storageKey(user), moduleId);
}

export function rememberedModulePath(user: AuthUser | null | undefined) {
  if (!user) return '';
  const stored = safeLocalStorageGet(storageKey(user)) as AppModuleId | null;
  return modulePathForUser(user, stored);
}

export function preferredEntryPath(user: AuthUser | null | undefined) {
  if (!user) return '/login';
  if (isClientAccount(user)) return '/rdo/cliente';
  if (shouldOpenHubOnFirstLogin(user)) return '/modulos';
  const remembered = rememberedModulePath(user);
  if (remembered) return remembered;
  const modules = availableHubModulesForUser(user);
  return modules[0]?.path || '/modulos';
}

export function accountPageStateFromPath(pathname: string) {
  const path = pathname || '/';
  return path === '/conta' ? undefined : { from: path };
}

export function accountBackPath(user: AuthUser | null | undefined, state: unknown, fallbackPath: string) {
  const from = state && typeof state === 'object' && 'from' in state ? (state as { from?: unknown }).from : null;
  return typeof from === 'string' && from && from !== '/conta' ? from : fallbackPath || preferredEntryPath(user);
}
