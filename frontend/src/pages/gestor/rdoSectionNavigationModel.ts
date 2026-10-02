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

export const RDO_COORDINATOR_SECTIONS = [
  { id: 'pending', label: 'Pendentes' },
  { id: 'approved', label: 'Aprovados' },
  { id: 'archived', label: 'Arquivados' },
  { id: 'nps', label: 'NPS' },
  { id: 'estatisticas', label: 'Estatísticas' },
  { id: 'dds', label: 'Temas de DDS' }
] as const;

export function rdoDefaultSectionNavigation(entryPath: string | undefined) {
  if (entryPath === '/rdo/gestor') {
    return RDO_MANAGER_SECTIONS.map(section => ({
      ...section,
      href: rdoManagerSectionHref(section.id),
      active: section.id === 'pendentes'
    }));
  }

  if (entryPath === '/rdo/coordenador') {
    return RDO_COORDINATOR_SECTIONS.map(section => ({
      ...section,
      href: `/rdo/coordenador${section.id === 'pending' ? '' : `?tab=${section.id}`}`,
      active: section.id === 'pending'
    }));
  }

  if (entryPath === '/rdo/home') {
    return [
      { id: 'home', label: 'Início', href: '/rdo/home', active: false },
      { id: 'reports', label: 'Meus relatórios', href: '/rdo/meus-relatorios', active: true },
      { id: 'ongoing', label: 'Em andamento', href: '/rdo/andamento', active: false },
      { id: 'archived', label: 'Arquivados', href: '/rdo/meus-relatorios/arquivados', active: false }
    ];
  }

  if (entryPath === '/rdo/cliente') {
    return [{ id: 'reports', label: 'Relatórios', href: entryPath, active: true }];
  }

  return undefined;
}

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
