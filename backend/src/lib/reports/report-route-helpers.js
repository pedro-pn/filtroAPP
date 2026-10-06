import { canViewEfetivo } from '../efetivo/access.js';
import { efetivoProjectWhere } from '../efetivo/project-visibility.js';

export function reportListUsesSummarySelect(query) {
  const value = String(query.summary || '').trim().toLowerCase();
  return value === 'true' || value === '1';
}

export function reportDateFromWhere(value) {
  if (value === undefined || value === null || value === '') return {};
  const day = typeof value === 'string' ? value.trim() : '';
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    const error = new Error('Data inicial dos relatórios inválida. Use AAAA-MM-DD.');
    error.statusCode = 400;
    throw error;
  }
  return { reportDate: { gte: date } };
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
