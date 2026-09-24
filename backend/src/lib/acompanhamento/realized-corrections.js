import { normalizeRdoServiceType } from './service-types.js';
import { realizedFromExtraData } from './realized-measurements.js';

export const CORRECTABLE_TUBE_SERVICES = ['TESTE_PRESSAO', 'LIMPEZA_QUIMICA', 'FLUSHING'];

export function progressDateKey(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function realizedCorrectionKey(date, serviceType) {
  return `${progressDateKey(date)}:${normalizeRdoServiceType(serviceType) ?? serviceType}`;
}

export function latestRealizedCorrections(revisions = []) {
  const latest = new Map();
  for (const row of revisions) {
    const key = realizedCorrectionKey(row.measureDate, row.serviceType);
    if (!latest.has(key) || row.revision > latest.get(key).revision) latest.set(key, row);
  }
  return latest;
}

// A correção substitui somente os metros dos tubos. Óleo e sistemas completos
// do mesmo serviço continuam vindo do relatório original.
export function applyDailyTubeCorrections(services = [], revisions = [], isEligible = () => true) {
  const active = new Map([...latestRealizedCorrections(revisions)]
    .filter(([, row]) => row.quantityM !== null && row.quantityM !== undefined));
  if (active.size === 0) return services;
  const corrected = services.map(service => {
    if (!isEligible(service)) return service;
    const key = realizedCorrectionKey(service.reportDate ?? service.report?.reportDate, service.serviceType);
    if (!active.has(key)) return service;
    return {
      ...service,
      extraData: { ...service.extraData, tubes: [] },
      ...(service.reconciledMeasurements ? {
        reconciledMeasurements: service.reconciledMeasurements.filter(row => row.systemType !== 'TUBULACAO')
      } : {})
    };
  });
  for (const row of active.values()) {
    const quantity = Number(row.quantityM);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Correção de metragem inválida.');
    corrected.push({
      serviceType: row.serviceType,
      finalized: true,
      reportDate: row.measureDate,
      reportType: 'RDO',
      specialConditions: null,
      extraData: { tubes: quantity > 0 ? [{ c: String(quantity), lengthUnit: 'm' }] : [] }
    });
  }
  return corrected;
}

export function dailyTubeSourceTotals(services = [], isEligible = () => true) {
  const totals = new Map();
  for (const service of services) {
    if (!isEligible(service)) continue;
    const canonical = normalizeRdoServiceType(service.serviceType);
    if (!CORRECTABLE_TUBE_SERVICES.includes(canonical)) continue;
    const date = progressDateKey(service.reportDate ?? service.report?.reportDate);
    if (!date) continue;
    const key = realizedCorrectionKey(date, canonical);
    totals.set(key, (totals.get(key) ?? 0) + realizedFromExtraData(service.extraData, canonical).tubulacaoM);
  }
  return totals;
}
