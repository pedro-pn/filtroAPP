import { Prisma } from '@prisma/client';
import { projectServiceReportCorrections, MANUAL_SERVICE_EDIT_KEY, SERVICE_REPORT_TYPES } from '../reports/service-report-corrections.js';
import { parseDecimal, parseVolumeOleo } from '../reports/service-measurement-values.js';
import { extractServiceMeasurements } from './realized-measurements.js';

// A projeção mantém os campos que identificam o escopo/UG no RDO. Os
// quantitativos vêm integralmente da correção, inclusive zeros e remoções.
function correctedExtraData(source, corrected) {
  const extra = { ...(corrected.extraData || {}) };
  for (const key of ['__scopeName', '__scopeKey', '__projectSystemId', '__proposalScope', 'equipmentId', 'Equipamento(s)', 'system', 'Sistema']) {
    if (!Object.hasOwn(extra, key) && Object.hasOwn(source.extraData || {}, key)) extra[key] = source.extraData[key];
  }
  const tubes = extra['Diâmetros e comprimentos'] || extra['Diametros e comprimentos'] || extra.diametros || extra.tubes || [];
  extra.tubes = (Array.isArray(tubes) ? tubes : []).flatMap(tube => {
    if (!tube || typeof tube !== 'object') return [];
    const quantity = parseDecimal(tube.c ?? tube.comprimento);
    if (quantity == null) return [];
    const unit = String(tube.lengthUnit || tube.comprimentoUnit || 'm').toLowerCase();
    return [{ d: tube.d || tube.diametro, unit: tube.unit || tube.dUnit || 'pol',
      c: unit === 'cm' ? quantity / 100 : unit === 'mm' ? quantity / 1000 : quantity, lengthUnit: 'm' }];
  });
  extra.volumeOleo = parseVolumeOleo({ extraData: extra }).liters ?? 0;
  extra.volumeOleoUnit = 'L';
  return extra;
}

const isManualUploadedReport = report => report.specialConditions?.source === 'MANUAL_UPLOAD'
  || Boolean(report.specialConditions?.__manualUpload?.uploadedAt);
function measurementKey(service) {
  const totals = new Map();
  for (const row of extractServiceMeasurements({ ...service, extraData: correctedExtraData(service, service) })) {
    const key = JSON.stringify([row.systemType, row.bitola]);
    totals.set(key, (totals.get(key) ?? 0) + row.quantity);
  }
  return JSON.stringify([...totals].sort(([a], [b]) => a.localeCompare(b)));
}

export async function correctAccompanimentReportServices(services, client, isServiceFinalized) {
  const parents = new Map();
  for (const service of services) {
    const report = service.report;
    if (report?.reportType !== 'RDO' || report.status !== 'SIGNED' || isManualUploadedReport(report)) continue;
    if (!parents.has(report.id)) parents.set(report.id, { ...report, services: [] });
    parents.get(report.id).services.push(service);
  }
  if (!parents.size) return services;
  const corrections = await client.report.findMany({
    where: { deletedAt: null, projectId: { in: [...new Set([...parents.values()].map(report => report.projectId))] },
      reportType: { in: SERVICE_REPORT_TYPES }, status: { in: ['APPROVED', 'SIGNED'] },
      specialConditions: { path: [MANUAL_SERVICE_EDIT_KEY, 'editedAt'], not: Prisma.AnyNull } },
    select: { id: true, projectId: true, reportType: true, sequenceNumber: true, status: true, specialConditions: true,
      services: { select: { serviceType: true, extraData: true } } }
  });
  const corrected = projectServiceReportCorrections([...parents.values()], corrections, {
    measurementKey, isServiceFinalized, isManualUploadedReport,
    replaceService: (source, replacement) => ({ ...source, finalized: true, extraData: correctedExtraData(source, replacement) })
  });
  const byId = new Map(corrected.flatMap(report => report.services.map(service => [service.id, service])));
  return services.map(service => byId.get(service.id) ?? service);
}
