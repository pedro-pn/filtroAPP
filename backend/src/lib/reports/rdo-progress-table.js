import prisma from '../prisma.js';
import { addRealizedService, buildProgress, isServiceFinalized, normalizeRdoServiceType } from '../acompanhamento/avanco.js';
import { withNativeMeasurementLinks } from '../acompanhamento/native-measurement-links.js';
import { realizedFromExtraData } from '../acompanhamento/realized-measurements.js';
import { isSystemCleaning } from './cleaning-measurement.js';

const SERVICE_NAMES = {
  limpeza: 'Limpeza química',
  pressao: 'Teste de pressão',
  filtragem: 'Filtragem',
  flushing: 'Flushing',
  mecanica: 'Limpeza mecânica',
  inibicao: 'Flushing/Inibição'
};

const UNITS = [
  ['tubulacaoM', 'm', 'TUBULACAO'],
  ['oleoL', 'L', 'OLEO'],
  ['sistemasUn', 'un', 'SISTEMA']
];
const quantityFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export function rdoServiceName(type) {
  return SERVICE_NAMES[type] || String(type || '');
}

function dayKey(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function formatDay(value) {
  const key = dayKey(value);
  return key ? `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}` : '';
}

function quantitiesFor(service) {
  return realizedFromExtraData(service.extraData, service.serviceType);
}

function systemTypeWithoutTubes(service) {
  const data = service.extraData || {};
  const type = normalizeRdoServiceType(service.serviceType);
  const flushingMode = data.flushingTubulacao || data['Flushing em tubulação?'] || data['Flushing em tubulacao?'];
  const noFlushingTubes = String(Array.isArray(flushingMode) ? flushingMode[0] : flushingMode ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === 'nao';
  const withoutTubes = (type === 'LIMPEZA_QUIMICA' && isSystemCleaning(data))
    || (type === 'FLUSHING' && noFlushingTubes);
  if (!withoutTubes) return '';
  const value = data.tipoSistema ?? data['Tipo de sistema'];
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function formatQuantities(values, visibleUnits) {
  return UNITS.filter(([, label]) => visibleUnits.has(label))
    .map(([key, label]) => `${quantityFormat.format(values[key] || 0)} ${label}`)
    .join(' + ') || '—';
}

function compareReports(a, b) {
  const byDay = dayKey(a.reportDate).localeCompare(dayKey(b.reportDate));
  if (byDay) return byDay;
  const bySequence = (a.sequenceNumber ?? Number.MAX_SAFE_INTEGER) - (b.sequenceNumber ?? Number.MAX_SAFE_INTEGER);
  if (bySequence) return bySequence;
  return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id || '').localeCompare(String(b.id || ''));
}

// Uma linha por RDO. A porcentagem usa todos os serviços previstos do contrato,
// sem selecionar scopeName, equipamento ou o serviço da linha.
export function buildRdoProgressRows(report, plannedServices = [], reports = []) {
  const currentDay = dayKey(report.reportDate);
  const currentSequence = report.sequenceNumber;
  const previous = reports.filter(item => item.reportType === 'RDO'
    && (!report.id || item.id !== report.id)
    && dayKey(item.reportDate)
    && dayKey(item.reportDate) <= currentDay
    && (dayKey(item.reportDate) !== currentDay || currentSequence == null
      || (item.sequenceNumber != null && item.sequenceNumber < currentSequence)));
  const ordered = [...previous, report].sort(compareReports);
  const plannedTotals = Object.fromEntries(UNITS.map(([key]) => [key, 0]));
  for (const service of plannedServices) {
    for (const system of service.systems || []) {
      const metric = UNITS.find(([, , type]) => type === system.systemType);
      if (metric && Number(system.quantity) > 0) plannedTotals[metric[0]] += Number(system.quantity);
    }
  }
  const plannedUnits = new Set(UNITS.filter(([key]) => plannedTotals[key] > 0).map(([, label]) => label));
  const accumulated = { tubulacaoM: 0, oleoL: 0, sistemasUn: 0 };
  const realizedByType = new Map();

  return ordered.map(item => {
    const finalized = (item.services || []).filter(isServiceFinalized);
    const linked = withNativeMeasurementLinks((item.services || []).map(service => ({
      ...service,
      report: { id: item.id, measurementLinks: item.measurementLinks || [] }
    }))).filter(isServiceFinalized);
    const daily = { tubulacaoM: 0, oleoL: 0, sistemasUn: 0 };
    const serviceAmounts = [];
    let hasSystemType = false;
    for (const service of linked) {
      const quantities = quantitiesFor(service);
      const serviceUnits = new Set(UNITS.filter(([key]) => quantities[key] > 0).map(([, label]) => label));
      if (serviceUnits.size) {
        const systemType = systemTypeWithoutTubes(service);
        serviceAmounts.push(`${formatQuantities(quantities, serviceUnits)}${systemType ? ` (${systemType})` : ''}`);
        if (systemType) hasSystemType = true;
      }
      for (const [key] of UNITS) {
        daily[key] += quantities[key] || 0;
        accumulated[key] += quantities[key] || 0;
      }
      addRealizedService(realizedByType, service);
    }
    const dailyUnits = new Set(UNITS.filter(([key]) => daily[key] > 0).map(([, label]) => label));
    const totalUnits = new Set([...plannedUnits, ...UNITS.filter(([key]) => accumulated[key] > 0).map(([, label]) => label)]);
    const singleUnit = UNITS.find(([key]) => plannedTotals[key] > 0);
    const percentage = plannedUnits.size === 1
      ? accumulated[singleUnit[0]] / plannedTotals[singleUnit[0]] * 100
      : buildProgress(plannedServices, realizedByType).progressPct;
    return {
      progressday: formatDay(item.reportDate),
      progressservicetype: [...new Set(finalized.map(service => rdoServiceName(service.serviceType)))].join(', ') || '—',
      progressmade: hasSystemType ? serviceAmounts.join(' + ') : formatQuantities(daily, dailyUnits),
      totalprogress: `${formatQuantities(accumulated, totalUnits)} / ${percentage == null ? '—' : `${percentFormat.format(percentage)}%`}`
    };
  }).reverse();
}

export async function loadRdoProgressRows(report) {
  if (report.reportType !== 'RDO') return [];
  if (!report.projectId || !dayKey(report.reportDate)) {
    return buildRdoProgressRows(report);
  }
  const endOfDay = new Date(`${dayKey(report.reportDate)}T23:59:59.999Z`);
  const [planned, reports] = await Promise.all([
    prisma.projectPlannedService.findMany({
      where: { projectId: report.projectId },
      orderBy: [{ order: 'asc' }],
      include: { systems: { orderBy: [{ order: 'asc' }], include: { projectSystem: true } } }
    }),
    prisma.report.findMany({
      where: { projectId: report.projectId, reportType: 'RDO', deletedAt: null, reportDate: { lte: endOfDay } },
      orderBy: [{ reportDate: 'asc' }, { sequenceNumber: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, reportType: true, sequenceNumber: true, reportDate: true, createdAt: true,
        services: true, measurementLinks: true
      }
    })
  ]);
  return buildRdoProgressRows(report, planned, reports);
}
