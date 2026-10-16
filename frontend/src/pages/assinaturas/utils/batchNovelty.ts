// Cinco dias corridos no fuso corporativo: 16 a 20/10/2026, inclusive.
export const SIGNATURE_BATCH_NOVELTY_STARTS_AT = new Date('2026-10-16T00:00:00-03:00');
export const SIGNATURE_BATCH_NOVELTY_EXPIRES_AT = new Date('2026-10-21T00:00:00-03:00');
const STORAGE_PREFIX = 'filtrovali:assinaturas-batch-novelty:v1:';

export function shouldShowSignatureBatchNovelty(userId: string, now = Date.now()) {
  if (!userId || now < SIGNATURE_BATCH_NOVELTY_STARTS_AT.getTime() || now >= SIGNATURE_BATCH_NOVELTY_EXPIRES_AT.getTime()) return false;
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`) !== '1';
  } catch {
    return true;
  }
}

export function markSignatureBatchNoveltySeen(userId: string) {
  if (!userId) return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, '1');
  } catch {
    // O destaque continua utilizável quando o navegador bloqueia o armazenamento.
  }
}
