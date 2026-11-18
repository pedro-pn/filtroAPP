export const WORKFORCE_VISIBILITY_TARGETS = Object.freeze([
  { key: 'RDO', label: 'RDO e relatórios operacionais', description: 'Cadastro, equipes e seletores de colaboradores dos relatórios.' },
  { key: 'EFETIVO', label: 'Efetivo — planejamento e equipes', description: 'Disponibilidade, missões, alocações e responsáveis vinculados a colaboradores.' },
  { key: 'ALLOCATION_REVIEW', label: 'Efetivo — conferência de alocação', description: 'Grades de conferência semanal e mensal.' },
  { key: 'PRODUCTIVITY', label: 'Efetivo — produtividade e ausências', description: 'Listagens e indicadores de produtividade, férias e indisponibilidades.' },
  { key: 'ACOMPANHAMENTO', label: 'Acompanhamento — colaboradores e ponto', description: 'Seletores e pendências de colaboradores na conciliação de ponto.' },
  { key: 'EQUIPMENT', label: 'Equipamentos — supervisores', description: 'Seleção de colaboradores responsáveis pela manutenção.' },
  { key: 'ROMANEIO', label: 'Romaneio e logística', description: 'Operadores apresentados na seleção de projetos do Romaneio e novas participações na logística.' },
  { key: 'API', label: 'API de integrações', description: 'Listagens externas de colaboradores e alocações, incluindo a conferência enviada ao Conecta.' },
  { key: 'EPI', label: 'EPI — colaboradores e entregas', description: 'Listagem de colaboradores e novas entregas de EPI.' }
]);

export const WORKFORCE_VISIBILITY_CLASSIFICATIONS = Object.freeze(['OPERATIONAL', 'NON_OPERATIONAL', 'PENDING']);

export function defaultWorkforceVisibilityRules() {
  return Object.fromEntries(WORKFORCE_VISIBILITY_TARGETS.map(({ key }) => [
    key, key === 'EPI' ? [...WORKFORCE_VISIBILITY_CLASSIFICATIONS] : ['OPERATIONAL']
  ]));
}
