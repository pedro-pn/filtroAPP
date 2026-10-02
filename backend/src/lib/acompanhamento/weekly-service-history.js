import prisma from '../prisma.js';
import { dateOnlyKey } from '../../../../shared/modules/mission-weekly-progress.js';
import { isRealizedSourceReport, isServiceFinalized, loadReportServicesByProject } from './avanco.js';
import { extractServiceMeasurements } from './realized-measurements.js';
import { normalizeRdoServiceType } from './service-types.js';
import { weeklyTargetProjectIds } from './weekly-progress-targets.js';
import { loadWeeklyProductiveHistory } from './weekly-productive-time.js';

// Mesmas fontes do avanço: finalizados, sem duplicar relatórios derivados de RDOs,
// incluindo histórico importado, vínculos de medições e correções de metragem.
export function buildWeeklyServiceHistory(services = []) {
  return services.filter(service => isServiceFinalized(service) && isRealizedSourceReport(service)).flatMap(service => {
    const date = dateOnlyKey(service.reportDate);
    const serviceType = normalizeRdoServiceType(service.serviceType);
    if (!date || !serviceType) return [];
    const quantities = { M: 0, L: 0, UN: 0 };
    for (const measurement of service.reconciledMeasurements ?? extractServiceMeasurements(service, serviceType)) {
      const metric = { TUBULACAO: 'M', OLEO: 'L', SISTEMA: 'UN' }[measurement.systemType];
      if (metric && Number.isFinite(Number(measurement.quantity))) quantities[metric] += Number(measurement.quantity);
    }
    return [{ date, serviceType, quantities }];
  });
}

export async function loadWeeklyServiceHistory(owner, { client = prisma, loadServices = loadReportServicesByProject, loadProductivity = loadWeeklyProductiveHistory } = {}) {
  const projectIds = await weeklyTargetProjectIds(owner, client);
  const [byProject, productivity] = await Promise.all([loadServices(projectIds), loadProductivity(projectIds, client)]);
  return [...projectIds.flatMap(id => buildWeeklyServiceHistory(byProject.get(id) ?? [])), ...productivity];
}
