import { reportAllCollaboratorIds } from './report-time.js';

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseMinutes(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
  const match = text.match(/^(\d+):([0-5]\d)$/);
  if (!match) return 0;
  return (Number.parseInt(match[1], 10) * 60) + Number.parseInt(match[2], 10);
}

function positiveInteger(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

// Mantém a mesma seleção do realizado do Acompanhamento sem carregar o acesso a banco
// durante os testes puros deste agregador.
function selectSourceReportData(reports = [], collaborators = []) {
  const sourceReports = reports.filter(report => (
    !report?.reportType
    || report.reportType === 'RDO'
    || !report.specialConditions?.parentRdoId
  ));
  const sourceReportIds = new Set(sourceReports.map(report => report.id));
  return {
    reports: sourceReports,
    collaborators: collaborators.filter(item => sourceReportIds.has(item.reportId))
  };
}

export function buildProjectStandbyHistory(queriedReports = [], queriedCollaborators = []) {
  const { reports, collaborators } = selectSourceReportData(queriedReports, queriedCollaborators);
  const collaboratorIdsByReport = new Map();

  for (const link of collaborators) {
    if (!link?.reportId || !link?.collaboratorId) continue;
    if (!collaboratorIdsByReport.has(link.reportId)) collaboratorIdsByReport.set(link.reportId, []);
    collaboratorIdsByReport.get(link.reportId).push(link.collaboratorId);
  }

  const byDate = new Map();
  for (const report of reports) {
    const specialConditions = plainObject(report?.specialConditions);
    const standbyDetails = plainObject(specialConditions.standbyDetails);
    const internalDetails = plainObject(specialConditions.internalStandbyDetails);
    // standby = por conta do cliente (RDO); internalStandby = por nossa conta (uso interno).
    const standbyMinutes = specialConditions.standby === true ? parseMinutes(standbyDetails.total) : 0;
    const internalStandbyMinutes = specialConditions.internalStandby === true ? parseMinutes(internalDetails.total) : 0;
    const date = dateKey(report?.reportDate);
    if (!date || (standbyMinutes <= 0 && internalStandbyMinutes <= 0)) continue;

    if (!byDate.has(date)) {
      byDate.set(date, {
        standbyMinutes: 0,
        internalStandbyMinutes: 0,
        collaboratorIds: new Set(),
        fallbackCollaboratorCount: 0,
        reasons: [],
        internalReasons: []
      });
    }

    const day = byDate.get(date);
    day.standbyMinutes += standbyMinutes;
    day.internalStandbyMinutes += internalStandbyMinutes;
    day.fallbackCollaboratorCount = Math.max(
      day.fallbackCollaboratorCount,
      positiveInteger(report?.daytimeCount)
    );

    const reportCollaboratorIds = collaboratorIdsByReport.get(report.id) || [];
    for (const collaboratorId of reportAllCollaboratorIds(report, reportCollaboratorIds)) {
      day.collaboratorIds.add(collaboratorId);
    }

    const reason = standbyMinutes > 0 && typeof standbyDetails.motivo === 'string' ? standbyDetails.motivo.trim() : '';
    if (reason && !day.reasons.includes(reason)) day.reasons.push(reason);
    const internalReason = internalStandbyMinutes > 0 && typeof internalDetails.motivo === 'string' ? internalDetails.motivo.trim() : '';
    if (internalReason && !day.internalReasons.includes(internalReason)) day.internalReasons.push(internalReason);
  }

  return Array.from(byDate.entries())
    .map(([date, day]) => ({
      date,
      standbyMinutes: day.standbyMinutes,
      internalStandbyMinutes: day.internalStandbyMinutes,
      collaboratorCount: day.collaboratorIds.size || day.fallbackCollaboratorCount || null,
      reason: day.reasons.length ? day.reasons.join(' · ') : null,
      internalReason: day.internalReasons.length ? day.internalReasons.join(' · ') : null
    }))
    .sort((left, right) => right.date.localeCompare(left.date));
}

export async function getProjectStandbyHistory(projectId) {
  const { default: prisma } = await import('../prisma.js');
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, code: true, name: true }
  });
  if (!project) return null;

  const [reports, collaborators] = await Promise.all([
    prisma.report.findMany({
      where: { projectId, deletedAt: null },
      select: {
        id: true,
        reportType: true,
        reportDate: true,
        specialConditions: true,
        daytimeCount: true
      },
      orderBy: { reportDate: 'desc' }
    }),
    prisma.reportCollaborator.findMany({
      where: { report: { projectId, deletedAt: null } },
      select: { reportId: true, collaboratorId: true }
    })
  ]);

  return {
    project,
    entries: buildProjectStandbyHistory(reports, collaborators)
  };
}
