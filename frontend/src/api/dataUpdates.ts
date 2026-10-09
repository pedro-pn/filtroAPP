import type { QueryKey } from '@tanstack/react-query';

// Uma gravação pode alterar listas, seletores e totais de vários módulos.
// Os prefixos também incluem consultas inativas, que serão renovadas ao reabrir a tela.
const tracking = [
  'commercial', 'commercialapp', 'project-cards', 'project-detail', 'mission-group', 'project-progress',
  'planned-scope', 'tracking-divisions', 'project-systems', 'system-reconciliation', 'realized',
  'project-invoices', 'project-romaneios', 'project-standby', 'project-management-notes',
  'acompanhamento-planning', 'sede-costs'
];
const planning = ['efetivo', 'workforce', 'project-workflow', 'project-workflows', 'project-execution', 'project-closeout', 'project-documents', 'reports'];
const statistics = ['projectStats', 'statsOverview', 'allocationReport'];
const projects = ['projects', 'bootstrap', 'reports', 'report', 'romaneio-projects', 'romaneio-return-items', 'estoque', 'qualidade', 'ponto-projects', 'mission-weekly-targets', ...tracking, ...planning, ...statistics];
const collaborators = ['collaborators', 'bootstrap', 'reports', 'report', 'epi', 'ponto', 'collaborator-hourly-rates', ...planning, ...tracking, ...statistics];
const equipment = ['equipamentos', 'equipment', 'units', 'manometers', 'particle-counters', 'bootstrap', 'romaneio-catalog', 'romaneio-checklist-map', 'operational-reports', 'project-workflow-legacy-summary-equipment'];
const reports = ['reports', 'report', 'bootstrap', 'historical-services', 'mission-weekly-targets', 'ponto-colaboradores', ...tracking, ...planning, ...statistics];

type WriteListener = (prefixes: readonly string[]) => void;
const listeners = new Set<WriteListener>();

export function subscribeToDataUpdates(listener: WriteListener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function matchesDataUpdate(queryKey: QueryKey, prefixes: readonly string[]) {
  const root = queryKey[0];
  return typeof root === 'string' && prefixes.some(prefix => root === prefix || root.startsWith(`${prefix}-`));
}

export function dataUpdatesForRequest(method = 'get', url = ''): string[] {
  if (!['post', 'put', 'patch', 'delete'].includes(method.toLowerCase())) return [];
  const path = new URL(url, 'https://local.invalid').pathname.replace(/^\/api(?=\/)/, '').replace(/\/$/, '');
  // Algumas consultas usam POST. Invalidá-las criaria um ciclo de refetch.
  if (/^\/rdo\/reports\/(counts|manual-extract|batch-download)$/.test(path)
    || /\/historical-services\/[^/]+\/preview$/.test(path)
    || path === '/workforce/availability/check'
    || path === '/acompanhamento/custo/simular'
    || /^\/admin\/api-credentials\/[^/]+\/test$/.test(path)) return [];

  let prefixes: string[] = [];
  if (/^\/rdo\/projects(?:\/|$)/.test(path)) prefixes = projects;
  else if (/^\/rdo\/collaborators(?:\/|$)/.test(path)) prefixes = collaborators;
  else if (/^\/rdo\/(reports|public-signatures)(?:\/|$)/.test(path) || /^\/reports\/public-sign\//.test(path)) prefixes = [...reports, 'public-signature', 'signature-validation'];
  else if (/^\/rdo\/drafts(?:\/|$)/.test(path)) prefixes = ['drafts', 'bootstrap'];
  else if (method.toLowerCase() === 'delete' && path === '/rdo/uploads/file') prefixes = [...reports, 'drafts'];
  else if (/^\/rdo\/operational-reports(?:\/|$)/.test(path)) prefixes = ['operational-reports', ...reports, 'equipamentos'];
  else if (/^\/rdo\/job-roles(?:\/|$)/.test(path)) prefixes = ['job-roles', ...collaborators, 'cost-cargos', 'planned-scope'];
  else if (/^\/rdo\/dds-themes(?:\/|$)/.test(path)) prefixes = ['dds-themes'];
  else if (/^\/rdo\/inhibition-options(?:\/|$)/.test(path)) prefixes = ['inhibition-options', 'bootstrap'];
  else if (/^\/rdo\/(equipment|units|manometers|particle-counters)(?:\/|$)/.test(path)) prefixes = equipment;
  else if (/^\/rdo\/project-segments(?:\/|$)/.test(path)) prefixes = ['projectSegments', ...projects];
  else if (/^\/(rdo\/surveys|surveys)(?:\/|$)/.test(path)) prefixes = ['surveys', 'public-survey', 'bootstrap'];
  else if (/^\/rdo\/statistics(?:\/|$)/.test(path)) prefixes = [...statistics, 'allocationReportRecipients'];
  else if (/^\/admin\/accounts(?:\/|$)/.test(path)) prefixes = ['users', 'bootstrap', 'equipamentos', 'project-workflow-leaders', 'efetivo-planning-users'];
  else if (/^\/admin\/api-credentials(?:\/|$)/.test(path)) prefixes = ['admin-api-credential', 'admin-api-credentials', 'admin-api-credential-events', 'admin-api-credential-usage'];
  else if (/^\/acompanhamento\/comercial(?:\/|$)/.test(path)) prefixes = [...projects, 'ponto-colaboradores'];
  else if (/^\/acompanhamento\/ponto(?:\/|$)/.test(path)) prefixes = [...collaborators, 'rdo-simulation'];
  else if (/^\/acompanhamento\/custo(?:\/|$)/.test(path)) prefixes = ['cost', 'omie-cost-categories', 'collaborator-hourly-rates', 'ponto-colaboradores', 'sede-costs', ...tracking];
  else if (/^\/(efetivo|workforce)(?:\/|$)/.test(path)) prefixes = [...collaborators, ...planning, ...tracking, 'mission-weekly-targets', 'job-roles', ...statistics, 'bootstrap'];
  else if (/^\/equipamentos(?:\/|$)/.test(path)) prefixes = equipment;
  else if (/^\/romaneio\/drafts(?:\/|$)/.test(path)) prefixes = ['romaneio-drafts'];
  else if (/^\/romaneio\/notifications(?:\/|$)/.test(path)) prefixes = ['romaneio-recipients'];
  else if (/^\/romaneio(?:\/|$)/.test(path)) prefixes = ['romaneio', 'romaneios', 'bootstrap', ...equipment, ...projects];
  else if (/^\/estoque(?:\/|$)/.test(path)) prefixes = ['estoque'];
  else if (/^\/qualidade(?:\/|$)/.test(path)) prefixes = ['qualidade'];
  else if (/^\/epi(?:\/|$)/.test(path)) prefixes = ['epi', 'signature-validation'];
  else if (/^\/assinaturas(?:\/|$)/.test(path)) prefixes = ['assinaturas', 'signature-validation', 'project-documents', 'project-workflow', 'project-workflows', 'project-closeout'];
  else if (/^\/privacy(?:\/|$)/.test(path)) prefixes = ['privacy-requests'];
  else if (path === '/auth/account' || path === '/auth/confirm-email-change' || /^\/auth\/notification-preferences\//.test(path)) prefixes = ['users', 'equipamentos'];
  return [...new Set(prefixes)];
}

export function notifyDataWrite(method?: string, url?: string) {
  const prefixes = dataUpdatesForRequest(method, url);
  if (prefixes.length) listeners.forEach(listener => {
    try { listener(prefixes); } catch { /* A gravação concluída não deve falhar por um listener. */ }
  });
}
