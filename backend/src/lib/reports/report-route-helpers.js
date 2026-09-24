import { canViewEfetivo } from '../efetivo/access.js';
import { efetivoProjectWhere } from '../efetivo/project-visibility.js';

export function reportListUsesSummarySelect(query) {
  const value = String(query.summary || '').trim().toLowerCase();
  return value === 'true' || value === '1';
}

export function createReportPdfAccessChecker({ canAccessReport, isReportUnavailable, database }) {
  return async function canAccessReportPdf(auth, report, { clientVisibilityById = null, database: selectedDatabase = database } = {}) {
    if (isReportUnavailable(report)) return false;
    if (await canAccessReport(auth, report, { clientVisibilityById })) return true;
    if (!canViewEfetivo(auth.user)) return false;
    return Boolean(await selectedDatabase.project.findFirst({
      where: { id: report.projectId, isActive: true, ...efetivoProjectWhere(), workflow: { isNot: null } },
      select: { id: true }
    }));
  };
}
