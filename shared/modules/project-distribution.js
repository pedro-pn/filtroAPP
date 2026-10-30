export const PROJECT_DISTRIBUTION_CHANNELS = Object.freeze([
  { key: 'efetivo', label: 'Efetivo', description: 'Exibir no planejamento e nas missões para administradores.' },
  { key: 'acompanhamento', label: 'Acompanhamento', description: 'Exibir nos painéis de acompanhamento para administradores.' },
  { key: 'api', label: 'API de integrações', description: 'Permitir leitura, eventos e atualizações por sistemas externos autorizados.' },
  { key: 'commercial', label: 'CRM e propostas comerciais', description: 'Sincronizar cadastro, propostas e documentos comerciais.' },
  { key: 'omie', label: 'Omie', description: 'Vincular o projeto e sincronizar seus dados financeiros.' },
  { key: 'pontomais', label: 'Pontomais', description: 'Usar o projeto na sincronização e alocação de ponto.' }
]);

export function projectDistributionDefaults(project = {}) {
  return Object.fromEntries(PROJECT_DISTRIBUTION_CHANNELS.map(({ key }) => [key, !project.managerOnly]));
}

export function projectDistributionSettings(project = {}) {
  const defaults = projectDistributionDefaults(project);
  return Object.fromEntries(PROJECT_DISTRIBUTION_CHANNELS.map(({ key }) => [
    key, typeof project.distributionSettings?.[key] === 'boolean' ? project.distributionSettings[key] : defaults[key]
  ]));
}
