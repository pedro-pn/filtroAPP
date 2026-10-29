// Última aba aberta no painel do dashboard do projeto, por usuário e neste navegador.

export type ProjectDetailTab = 'team' | 'financial' | 'quality' | 'resources' | 'daily';

const KEY_PREFIX = 'filtrovali:acompanhamento-project-tab:v1:';
const TABS: ProjectDetailTab[] = ['team', 'financial', 'quality', 'resources', 'daily'];

export function readProjectDetailTab(userId?: string | null): ProjectDetailTab | null {
  if (!userId) return null;
  try {
    const stored = window.localStorage.getItem(`${KEY_PREFIX}${userId}`);
    return TABS.find(tab => tab === stored) ?? null;
  } catch {
    return null;
  }
}

export function writeProjectDetailTab(userId: string | null | undefined, tab: ProjectDetailTab) {
  if (!userId) return;
  try {
    window.localStorage.setItem(`${KEY_PREFIX}${userId}`, tab);
  } catch {
    // Armazenamento bloqueado: a aba vale só nesta visita.
  }
}
