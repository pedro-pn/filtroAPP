export const PROJECT_WORKFLOW_NOVELTY_IMPLEMENTED_AT = '2026-09-10';
const EXPIRES_AT = new Date('2026-09-20T23:59:59-03:00').getTime();
const PREFIX = 'filtrovali:project-workflow-novelty:v3:';

export function shouldShowProjectWorkflowNovelty(userId: string, now = Date.now()) {
  if (!userId || now > EXPIRES_AT) return false;
  try { return localStorage.getItem(`${PREFIX}${userId}`) !== '1'; } catch { return false; }
}

export function markProjectWorkflowNoveltySeen(userId: string) {
  try { localStorage.setItem(`${PREFIX}${userId}`, '1'); } catch { /* armazenamento indisponível */ }
}
