import type { Project, ReportSummary } from '../types/domain';
import type { ProjectGroup } from './groupByProject';

export type ProjectSortDirection = 'asc' | 'desc';
export const reportTypeOrder = ['RDO', 'RTP', 'RLQ', 'RCPU', 'RLM', 'RLI', 'RLF'];

export function compareReportTypes(a: string, b: string) {
  const ia = reportTypeOrder.indexOf(a);
  const ib = reportTypeOrder.indexOf(b);
  if (ia !== -1 || ib !== -1) {
    return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
  }
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

function directionFactor(direction: ProjectSortDirection) {
  return direction === 'desc' ? -1 : 1;
}

function compareProjectFields(
  aCode: string | number | null | undefined,
  aName: string | null | undefined,
  bCode: string | number | null | undefined,
  bName: string | null | undefined,
  direction: ProjectSortDirection
) {
  const dir = directionFactor(direction);
  const codeCompare = String(aCode || '').localeCompare(String(bCode || ''), 'pt-BR', {
    numeric: true,
    sensitivity: 'base'
  });
  if (codeCompare) return dir * codeCompare;
  return dir * String(aName || '').localeCompare(String(bName || ''), 'pt-BR', {
    numeric: true,
    sensitivity: 'base'
  });
}

export function compareProjects(a: Project, b: Project, direction: ProjectSortDirection) {
  return compareProjectFields(a.code, a.name, b.code, b.name, direction);
}

export function sortProjects<T extends Project>(projects: T[], direction: ProjectSortDirection) {
  return [...projects].sort((a, b) => compareProjects(a, b, direction));
}

export function sortReportsByProject(reports: ReportSummary[], direction: ProjectSortDirection) {
  return [...reports].sort((a, b) => {
    const projectCompare = compareProjectFields(
      a.project?.code,
      a.project?.name,
      b.project?.code,
      b.project?.name,
      direction
    );
    if (projectCompare !== 0) return projectCompare;
    return new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime();
  });
}

// Ordena relatórios dentro de um grupo (mesmo projeto + tipo) por número
// sequencial e, em empate, por label/data/createdAt.
function reportLabel(report: ReportSummary) {
  const num = report.sequenceNumber ? `${report.reportType} ${report.sequenceNumber}` : report.reportType;
  return num || '';
}

export function sortReportsInGroup(reports: ReportSummary[], direction: ProjectSortDirection) {
  const dir = directionFactor(direction);
  return [...reports].sort((a, b) => {
    const sa = Number(a?.sequenceNumber) || 0;
    const sb = Number(b?.sequenceNumber) || 0;
    if (sa && sb && sa !== sb) return dir * (sa - sb);
    const labelCmp = reportLabel(a).localeCompare(reportLabel(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
    if (labelCmp) return dir * labelCmp;
    const da = String(a?.reportDate || '');
    const db = String(b?.reportDate || '');
    const dateCmp = da.localeCompare(db);
    if (dateCmp) return dir * dateCmp;
    return String(a?.createdAt || '').localeCompare(String(b?.createdAt || '')) * dir;
  });
}

export function sortProjectGroups(groups: ProjectGroup[], direction: ProjectSortDirection) {
  return [...groups].sort((a, b) =>
    compareProjectFields(a.projectCode, a.projectName, b.projectCode, b.projectName, direction)
  );
}
