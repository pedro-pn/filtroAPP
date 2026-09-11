import type { ReportEmissionPermission } from '../types/auth';

export type ReportSelection =
  'obra' | 'manutencao' | 'producao' | 'manutencao-avulsa';

export type OperationalModuleTab =
  | 'manutencao'
  | 'producao'
  | 'programacao-manutencao'
  | 'historico-manutencao';

function permissionForSelection(selection: ReportSelection) {
  if (selection === 'obra') return 'SITE_RDO';
  if (selection === 'producao') return 'PRODUCTION';
  return 'MAINTENANCE';
}

export function normalizeReportSelection(
  value: string | null
): ReportSelection | null {
  return value === 'obra' ||
    value === 'manutencao' ||
    value === 'producao' ||
    value === 'manutencao-avulsa'
    ? value
    : null;
}

export function canAccessReportSelection(
  permissions: ReportEmissionPermission[],
  selection: ReportSelection
) {
  const required = permissionForSelection(selection);
  return Boolean(required && permissions.includes(required));
}

export function resolveSiteReportSelection(
  permissions: ReportEmissionPermission[]
): 'obra' | null {
  return permissions.includes('SITE_RDO') ? 'obra' : null;
}

export function canAccessOperationalModule(
  permissions: ReportEmissionPermission[]
) {
  return (
    permissions.includes('MAINTENANCE') ||
    permissions.includes('PRODUCTION')
  );
}

export function allowedOperationalModuleTabs(
  permissions: ReportEmissionPermission[]
): OperationalModuleTab[] {
  const tabs: OperationalModuleTab[] = [];
  if (permissions.includes('MAINTENANCE')) tabs.push('manutencao');
  if (permissions.includes('PRODUCTION')) tabs.push('producao');
  if (permissions.includes('MAINTENANCE')) {
    tabs.push('programacao-manutencao');
    tabs.push('historico-manutencao');
  }
  return tabs;
}

export function resolveOperationalModuleTab(
  permissions: ReportEmissionPermission[],
  requested: string | null
): OperationalModuleTab | null {
  const tabs = allowedOperationalModuleTabs(permissions);
  return tabs.includes(requested as OperationalModuleTab)
    ? (requested as OperationalModuleTab)
    : tabs[0] || null;
}

export function operationalReportEditorPath(
  selection: Exclude<ReportSelection, 'obra'>,
  reportId: string,
  review = false
) {
  const params = new URLSearchParams({
    tipo: selection,
    editar: reportId
  });
  if (review) params.set('revisao', '1');
  return `/manutencao-producao/relatorio/novo?${params.toString()}`;
}
