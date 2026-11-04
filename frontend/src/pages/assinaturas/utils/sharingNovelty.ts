// Campanha solicitada de cinco dias corridos no fuso de São Paulo: 4 a 8/11/2026.
export const SIGNATURE_SHARING_NOVELTY_STARTS_AT = new Date('2026-11-04T00:00:00-03:00');
export const SIGNATURE_SHARING_NOVELTY_EXPIRES_AT = new Date('2026-11-09T00:00:00-03:00');
const STORAGE_PREFIX = 'filtrovali:assinaturas-sharing-novelty:v1:';

export function shouldShowSignatureSharingNovelty(userId: string, now = Date.now()) {
  if (!userId || now < SIGNATURE_SHARING_NOVELTY_STARTS_AT.getTime() || now >= SIGNATURE_SHARING_NOVELTY_EXPIRES_AT.getTime()) return false;
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`) !== '1';
  } catch {
    return true;
  }
}

export function markSignatureSharingNoveltySeen(userId: string) {
  if (!userId) return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, '1');
  } catch {
    // A sessão mantém o aviso como visto mesmo quando o navegador bloqueia o storage.
  }
}
