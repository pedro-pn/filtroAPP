const EXPIRES_AT = new Date('2026-08-31T23:59:59-03:00').getTime();
const PREFIX = 'filtrovali:efetivo-planning-novelty:v1:';

export function shouldShowEfetivoPlanningNovelty(userId: string, now = Date.now()) {
  if (!userId || now > EXPIRES_AT) return false;
  try { return localStorage.getItem(`${PREFIX}${userId}`) !== '1'; } catch { return false; }
}

export function markEfetivoPlanningNoveltySeen(userId: string) {
  try { localStorage.setItem(`${PREFIX}${userId}`, '1'); } catch { /* armazenamento indisponível */ }
}
