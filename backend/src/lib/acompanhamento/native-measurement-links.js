import { createHash } from 'node:crypto';
import { extractServiceMeasurements } from './realized-measurements.js';
import { normalizeRdoServiceType } from './service-types.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ordered = rows => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));

export const nativeReconciliationInclude = {
  services: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, measurementLinks: true
};

// O token considera o conteúdo atual, mesmo quando outra edição recria os serviços.
export function nativeReportRevision(report) {
  return hash([report.updatedAt, report.reportDate, report.specialConditions, ordered(report.services ?? []), ordered(report.measurementLinks ?? [])]);
}

export function nativeReportMeasurements(report) {
  const occurrences = new Map(), links = new Map((report.measurementLinks ?? []).map(link => [link.measurementKey, link]));
  const totals = new Map();
  const rows = ordered(report.services ?? []).flatMap(service => {
    const serviceType = normalizeRdoServiceType(service.serviceType);
    return extractServiceMeasurements(service, serviceType).map(measurement => {
      // Não usa IDs de serviço nem a posição do tubo: editar/reordenar o relatório não
      // transfere o vínculo para uma quantidade diferente. Repetições idênticas têm chaves distintas.
      const signature = hash([serviceType, measurement.equipment, measurement.system, measurement.systemType,
        measurement.bitola, measurement.quantity, measurement.projectSystemId]);
      totals.set(signature, (totals.get(signature) ?? 0) + 1);
      return { service, serviceType, measurement, signature };
    });
  });
  return rows.map(({ signature, ...row }) => {
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    // Incluir/excluir uma repetição é ambíguo: exige revisão, sem passar o vínculo
    // da linha removida para outra linha idêntica que mudou de posição.
    const measurementKey = `${signature}:${totals.get(signature)}:${occurrence}`, link = links.get(measurementKey);
    return { ...row, measurementKey, link,
      measurement: link ? { ...row.measurement, projectSystemId: link.projectSystemId } : row.measurement };
  });
}

export function withNativeMeasurementLinks(services) {
  const reports = new Map();
  for (const service of services) {
    if (!service.report?.id || !service.report.measurementLinks?.length) continue;
    if (!reports.has(service.report.id)) reports.set(service.report.id, { ...service.report, services: [] });
    reports.get(service.report.id).services.push(service);
  }
  const rows = new Map();
  for (const report of reports.values()) {
    for (const row of nativeReportMeasurements(report)) {
      if (!rows.has(row.service.id)) rows.set(row.service.id, []);
      rows.get(row.service.id).push(row.measurement);
    }
  }
  return services.map(service => rows.has(service.id) ? { ...service, reconciledMeasurements: rows.get(service.id) } : service);
}
