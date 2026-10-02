export const RDO_MANAGER_SECTIONS = [
  { id: 'pendentes', label: 'Pendentes' },
  { id: 'aprovados', label: 'Aprovados' },
  { id: 'projetos', label: 'Projetos' },
  { id: 'arquivados', label: 'Arquivados' },
  { id: 'equipe', label: 'Equipe' },
  { id: 'usuarios', label: 'Usuários' },
  { id: 'nps', label: 'NPS' },
  { id: 'estatisticas', label: 'Estatísticas' }
] as const;

export type RdoManagerSection = (typeof RDO_MANAGER_SECTIONS)[number]['id'];

export function rdoManagerSectionLabel(section: RdoManagerSection) {
  return (
    RDO_MANAGER_SECTIONS.find((item) => item.id === section)?.label ||
    'Pendentes'
  );
}

export function rdoManagerSectionHref(
  section: RdoManagerSection,
  currentSearch = ''
) {
  const params = new URLSearchParams(currentSearch);
  if (section === 'pendentes') {
    params.delete('tab');
  } else {
    params.set('tab', section);
  }
  const search = params.toString();
  return `/rdo/gestor${search ? `?${search}` : ''}`;
}
