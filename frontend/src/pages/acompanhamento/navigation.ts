export const ACOMPANHAMENTO_SECTIONS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'projetos', label: 'Projetos' },
  { id: 'sede', label: 'Sede' },
  { id: 'custo', label: 'Custo' }
] as const;

export type AcompanhamentoSection = typeof ACOMPANHAMENTO_SECTIONS[number]['id'];

export function parseSection(value: string | null, fallback: AcompanhamentoSection = 'dashboard'): AcompanhamentoSection {
  return ACOMPANHAMENTO_SECTIONS.some(section => section.id === value) ? value as AcompanhamentoSection : fallback;
}

export function sectionSearchParams(current: URLSearchParams, section: AcompanhamentoSection) {
  const next = new URLSearchParams(current);
  if (section === 'dashboard') next.delete('section'); else next.set('section', section);
  if (section !== 'projetos') {
    next.delete('project');
    next.delete('group');
    next.delete('cards');
  }
  if (section !== 'custo') next.delete('cost');
  return next;
}
