import type { AuthUser } from '../../types/auth';

export const API_TOKEN_PLAYGROUND_LAUNCHED_AT = '2026-09-04T00:00:00-03:00';
export const API_TOKEN_PLAYGROUND_EXPIRES_AT = '2026-09-14T00:00:00-03:00';
export const API_TOKEN_PLAYGROUND_NOVELTY_DURATION_MS = 10 * 24 * 60 * 60 * 1000;

const NOVELTY_KEY_PREFIX = 'filtrovali:api-token-playground-novelty:v1:';

export function isApiTokenPlaygroundNoveltyActive(now = Date.now()) {
  const launchedAt = new Date(API_TOKEN_PLAYGROUND_LAUNCHED_AT).getTime();
  const expiresAt = new Date(API_TOKEN_PLAYGROUND_EXPIRES_AT).getTime();
  return expiresAt - launchedAt === API_TOKEN_PLAYGROUND_NOVELTY_DURATION_MS
    && now >= launchedAt
    && now < expiresAt;
}

function noveltyKey(user: Pick<AuthUser, 'id'>) {
  return `${NOVELTY_KEY_PREFIX}${user.id}`;
}

export function shouldShowApiTokenPlaygroundNovelty(
  user: Pick<AuthUser, 'id'> | null | undefined,
  storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.localStorage,
  now = Date.now()
) {
  if (!user || !storage || !isApiTokenPlaygroundNoveltyActive(now)) return false;
  try {
    return storage.getItem(noveltyKey(user)) !== '1';
  } catch {
    return false;
  }
}

export function markApiTokenPlaygroundNoveltySeen(
  user: Pick<AuthUser, 'id'> | null | undefined,
  storage: Pick<Storage, 'setItem'> | null = typeof window === 'undefined' ? null : window.localStorage
) {
  if (!user || !storage) return;
  try {
    storage.setItem(noveltyKey(user), '1');
  } catch {
    // O navegador pode bloquear storage; a navegação continua normalmente.
  }
}
