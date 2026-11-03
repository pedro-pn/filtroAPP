import { MECHANICAL_MEASURES } from '../../../../shared/modules/mechanical-measurement.js';
import prisma from '../prisma.js';
import { dateOnlyKey } from '../../../../shared/modules/mission-weekly-progress.js';
import { computeProgressDetailsForProjects, isRealizedSourceReport, isServiceFinalized, loadReportServicesByProject } from './avanco.js';
import { extractServiceMeasurements } from './realized-measurements.js';
import { normalizeRdoServiceType } from './service-types.js';
import { weeklyTargetProjectIds } from './weekly-progress-targets.js';
import { buildWeeklyProductiveHistory, loadWeeklyProductiveHistory } from './weekly-productive-time.js';
import { buildWeeklyAttendanceHistory } from './weekly-attendance-history.js';

// Mesmas fontes do avanço: finalizados, sem duplicar relatórios derivados de RDOs,
// incluindo histórico importado, vínculos de medições e correções de metragem.
export function buildWeeklyServiceHistory(services = []) {
  return services.filter(service => isServiceFinalized(service) && isRealizedSourceReport(service)).flatMap(service => {
    const date = dateOnlyKey(service.reportDate);
    const serviceType = normalizeRdoServiceType(service.serviceType);
    if (!date || !serviceType) return [];
    const quantities = { M: 0, L: 0, UN: 0,
      ...(serviceType === 'LIMPEZA_MECANICA' ? { KG: 0, T: 0 } : {}) };
    for (const measurement of service.reconciledMeasurements ?? extractServiceMeasurements(service, serviceType)) {
      const metric = MECHANICAL_MEASURES[measurement.systemType]?.unit ?? { TUBULACAO: 'M', OLEO: 'L', SISTEMA: 'UN', MANGOTE: 'UN' }[measurement.systemType];
      if (metric && Number.isFinite(Number(measurement.quantity))) quantities[metric] += Number(measurement.quantity);
    }
    return [{ date, serviceType, quantities }];
  });
}

// Fontes compartilhadas pelo painel e pela API. A leitura em lote mantém as
// correções/importações do avanço e consulta a equipe dos RDOs só uma vez.
export async function loadWeeklyComparisonSources(projectIds, { client = prisma, includeProgress = false } = {}) {
  if (!projectIds.length) return { servicesByProject: new Map(), reportsByProject: new Map(), progressDetails: new Map() };
  const servicesPromise = loadReportServicesByProject(projectIds, { database: client });
  const [servicesByProject, reports, progressDetails] = await Promise.all([
    servicesPromise,
    client.report.findMany({
      where: { projectId: { in: projectIds }, reportType: 'RDO', deletedAt: null },
      select: { projectId: true, reportType: true, reportDate: true, specialConditions: true,
        collaborators: { select: { collaboratorId: true } }, services: { select: { serviceType: true } } }
    }),
    includeProgress ? computeProgressDetailsForProjects(projectIds, { database: client, servicesByProject: servicesPromise }) : new Map()
  ]);
  const reportsByProject = new Map();
  for (const report of reports) {
    if (!reportsByProject.has(report.projectId)) reportsByProject.set(report.projectId, []);
    reportsByProject.get(report.projectId).push(report);
  }
  return { servicesByProject, reportsByProject, progressDetails };
}

export function buildWeeklyComparisonHistories(projectIds, sources, { includeAttendance = false } = {}) {
  const reports = projectIds.flatMap(id => sources.reportsByProject.get(id) ?? []);
  return {
    serviceHistory: [...projectIds.flatMap(id => buildWeeklyServiceHistory(sources.servicesByProject.get(id) ?? [])), ...buildWeeklyProductiveHistory(reports)],
    attendanceHistory: includeAttendance ? buildWeeklyAttendanceHistory(reports) : []
  };
}

export async function loadWeeklyServiceHistory(owner, { client = prisma, loadServices, loadProductivity } = {}) {
  const projectIds = await weeklyTargetProjectIds(owner, client);
  if (!loadServices && !loadProductivity) return buildWeeklyComparisonHistories(projectIds, await loadWeeklyComparisonSources(projectIds, { client })).serviceHistory;
  const [byProject, productivity] = await Promise.all([
    (loadServices ?? loadReportServicesByProject)(projectIds, { database: client }),
    (loadProductivity ?? loadWeeklyProductiveHistory)(projectIds, client)
  ]);
  return [...projectIds.flatMap(id => buildWeeklyServiceHistory(byProject.get(id) ?? [])), ...productivity];
}
