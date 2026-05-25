import { hubModulesForUser } from '../pages/hubModules';
import type { AuthUser } from '../types/auth';

export type AppModuleId = 'rdo' | 'admin' | 'romaneio' | 'epi' | 'privacy';

const LAST_MODULE_KEY_PREFIX = 'filtrovali:last-module:';
const LEGACY_RDO_PATHS = [
  '/home',
  '/andamento',
  '/meus-relatorios',
  '/relatorio',
  '/relatorios',
  '/gestor',
  '/coordenador',
  '/cliente'
];

function storageKey(user: Pick<AuthUser, 'id'>) {
  return `${LAST_MODULE_KEY_PREFIX}${user.id}`;
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

export function moduleIdFromPath(pathname: string): AppModuleId | null {
  const path = pathname || '/';
  if (path === '/epi/assinar' || path.startsWith('/epi/assinar/')) return null;
  if (path === '/rdo' || path.startsWith('/rdo/')) return 'rdo';
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  if (path === '/privacidade/solicitacoes' || path.startsWith('/privacidade/solicitacoes/')) return 'privacy';
  if (path === '/romaneio' || path.startsWith('/romaneio/')) return 'romaneio';
  if (path === '/epi' || path.startsWith('/epi/')) return 'epi';
  if (LEGACY_RDO_PATHS.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) return 'rdo';
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
  if (user.accountType === 'CLIENT' || user.role === 'CLIENT') return '/rdo/cliente';
  const remembered = rememberedModulePath(user);
  if (remembered) return remembered;
  const modules = hubModulesForUser(user).filter(module => module.path && !module.disabled);
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
