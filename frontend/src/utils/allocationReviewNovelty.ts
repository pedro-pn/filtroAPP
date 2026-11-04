// Campanha de novidade da Conferência de alocação (feature 037): 10 dias corridos após a
// implementação. Se o merge acontecer depois, atualize as duas datas juntas.
export const ALLOCATION_REVIEW_NOVELTY_IMPLEMENTED_AT = '2026-11-03';
const EXPIRES_AT = new Date('2026-11-13T23:59:59-03:00').getTime();
const PREFIX = 'filtrovali:allocation-review-novelty:v1:';

export function shouldShowAllocationReviewNovelty(userId: string, now = Date.now()) {
  if (!userId || now > EXPIRES_AT) return false;
  try { return localStorage.getItem(`${PREFIX}${userId}`) !== '1'; } catch { return false; }
}

export function markAllocationReviewNoveltySeen(userId: string) {
  try { localStorage.setItem(`${PREFIX}${userId}`, '1'); } catch { /* armazenamento indisponível */ }
}
