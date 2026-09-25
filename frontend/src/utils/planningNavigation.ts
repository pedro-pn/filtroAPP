export const EFETIVO_SECTIONS = ['visao-geral', 'calendario', 'colaboradores', 'disponibilidade', 'evolucao', 'produtividade', 'administracao'] as const;
export type EfetivoPlanningSection = typeof EFETIVO_SECTIONS[number];

export function parsePlanningSection(value: string | null): EfetivoPlanningSection {
  if (value === 'simulacoes') return 'disponibilidade';
  return EFETIVO_SECTIONS.includes(value as EfetivoPlanningSection) ? value as EfetivoPlanningSection : 'visao-geral';
}

const PARAMS_BY_SECTION: Record<EfetivoPlanningSection, string[]> = {
  'visao-geral': ['date', 'funcao'],
  calendario: ['date', 'view', 'funcao', 'dia'],
  colaboradores: ['date', 'funcao', 'search', 'colaborador', 'ausencia', 'ano'],
  disponibilidade: ['date', 'final', 'funcao', 'disponibilidadeView'],
  evolucao: ['projeto', 'busca', 'pagina', 'faseProjeto'],
  produtividade: ['ano', 'ateMes', 'colaborador'],
  administracao: ['adminTab']
};

export function setPlanningSectionParams(current: URLSearchParams, section: EfetivoPlanningSection) {
  const next = new URLSearchParams(current);
  if (section === 'visao-geral') next.delete('section');
  else next.set('section', section);
  const allowed = new Set(['section', ...PARAMS_BY_SECTION[section]]);
  for (const key of [...next.keys()]) if (!allowed.has(key)) next.delete(key);
  return next;
}
