import { diameterKey } from './system-progress.js';
import { resolveProjectSystem, systemNameKey } from './project-systems.js';
import { normalizeRdoServiceType } from './service-types.js';
import { historicalError, sourceReportConflict } from '../reports/historical-services.js';
import { historicalSourceSelect, linkHistoricalMeasurement, listHistoricalReports, assertHistoricalProject } from '../reports/historical-services-store.js';

import { isRealizedSourceReport, isServiceFinalized } from './avanco.js';
import { nativeReconciliationInclude, nativeReportMeasurements, nativeReportRevision } from './native-measurement-links.js';

const identity = system => system ? { id: system.id, equipment: system.equipment, name: system.name } : null;

// Diagnóstico somente de leitura. Usa a mesma identidade, unidade e bitola do avanço;
// nunca corrige nomes, cria metas ou transforma vínculos existentes em aliases.
export function measurementReconciliation(item, planned, registry, sourceConflict = null) {
  const serviceType = normalizeRdoServiceType(item.serviceType);
  const systemType = ['m', 'cm'].includes(item.unit) ? 'TUBULACAO' : item.unit === 'UN' ? 'SISTEMA' : 'OLEO';
  const rows = planned.filter(service => (normalizeRdoServiceType(service.serviceType) ?? service.serviceType) === serviceType)
    .flatMap(service => service.systems ?? []);
  const diameterRowsFor = measurementRows => {
    if (systemType !== 'TUBULACAO') return measurementRows;
    const exact = measurementRows.filter(row => diameterKey(row.diameter, row.diameterUnit) === diameterKey(item.diameter, item.diameterUnit));
    // A bitola exata prevalece sobre a linha sem bitola, mesmo se estiver sem quantidade.
    return exact.length ? exact : measurementRows.filter(row => !diameterKey(row.diameter, row.diameterUnit));
  };
  const compatibleIds = registry.filter(system => diameterRowsFor(rows.filter(row =>
    row.projectSystemId === system.id && row.systemType === systemType
  )).some(row => Number(row.quantity) > 0)).map(system => system.id);
  const match = resolveProjectSystem(registry, { ...item, serviceType });
  const suggestions = registry.filter(system => compatibleIds.includes(system.id)
    && systemNameKey(system.equipment) === systemNameKey(item.equipment)
    && systemNameKey(system.name).length >= 4 && systemNameKey(item.system).includes(systemNameKey(system.name)));
  const result = (status, message, candidates = compatibleIds) => ({
    status, message, matchedSystem: identity(match),
    compatibleSystemIds: candidates, suggestedSystemId: !match && suggestions.length === 1 && candidates.includes(suggestions[0].id) ? suggestions[0].id : null
  });
  if (sourceConflict) return result('SOURCE_CONFLICT', sourceConflict, []);
  if (!rows.length) return result('NO_SERVICE', 'O serviço não possui meta no escopo salvo.');
  // Uma meta global tem precedência no motor de avanço, inclusive sobre vínculos individuais.
  const globalRows = rows.filter(row => !row.projectSystemId && row.systemType === systemType);
  if (globalRows.length) return globalRows.some(row => Number(row.quantity) > 0)
    ? result('GLOBAL_SCOPE', 'Quantidade considerada na meta global do serviço; sem distribuição por sistema.', [])
    : result('NO_QUANTITY', 'A meta global está sem quantidade prevista.', []);
  if (!match) return result('UNMATCHED', item.projectSystemId
    ? 'O destino do vínculo salvo não foi encontrado. Revise esta medição.'
    : 'Selecione um sistema para esta medição.');
  const systemRows = rows.filter(row => row.projectSystemId === match.id);
  if (!systemRows.length) return result('NO_SYSTEM_SCOPE', 'O sistema identificado não possui meta para este serviço.');
  const measurementRows = systemRows.filter(row => row.systemType === systemType);
  if (!measurementRows.length) return result('MEASUREMENT_MISMATCH', 'A meta do sistema usa outro tipo de medição (tubulação, óleo ou unidades).');
  const diameterRows = diameterRowsFor(measurementRows);
  if (!diameterRows.length) return result('DIAMETER_MISMATCH', 'O sistema foi identificado, mas falta uma meta com este diâmetro e unidade.');
  if (!diameterRows.some(row => Number(row.quantity) > 0)) return result('NO_QUANTITY', 'A meta correspondente está sem quantidade prevista.');
  return result('MATCHED', item.projectSystemId ? 'Vínculo individual com meta compatível.' : 'Nome identificado com meta compatível.');
}

async function context(client, projectId) {
  const [planned, systems] = await Promise.all([
    client.projectPlannedService.findMany({ where: { projectId }, include: { systems: true } }),
    client.projectServiceSystem.findMany({ where: { projectId }, orderBy: [{ equipment: 'asc' }, { name: 'asc' }] })
  ]);
  return { planned, systems };
}

const historicalServiceTypes = { LIMPEZA_QUIMICA: 'limpeza', TESTE_PRESSAO: 'pressao', FILTRAGEM: 'filtragem', FLUSHING: 'flushing' };

function nativeItems(report, planned, systems) {
  return nativeReportMeasurements(report).filter(row => isServiceFinalized(row.service)).map((row, itemIndex) => {
    const measurement = { ...row.measurement, serviceType: historicalServiceTypes[row.serviceType], unit: { TUBULACAO: 'm', OLEO: 'L', SISTEMA: 'UN' }[row.measurement.systemType] };
    return { ...measurement, itemIndex, measurementKey: row.measurementKey, projectSystemId: row.link?.projectSystemId ?? null,
      reconciliation: measurementReconciliation(measurement, planned, systems) };
  });
}

export async function getSystemReconciliation(client, projectId) {
  const project = await client.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, code: true, name: true } });
  if (!project) throw historicalError('Projeto não encontrado.', 404);
  const [historical, native, { planned, systems }] = await Promise.all([
    listHistoricalReports(client, projectId),
    client.report.findMany({ where: { projectId, deletedAt: null }, include: nativeReconciliationInclude, orderBy: [{ reportDate: 'asc' }, { id: 'asc' }] }),
    context(client, projectId)
  ]);
  const reports = historical.map(report => ({
    ...report, source: 'HISTORICAL',
    items: report.items.map((item, itemIndex) => ({ ...item, itemIndex, measurementKey: String(itemIndex), reconciliation: measurementReconciliation(item, planned, systems, report.sourceConflict) }))
  }));
  for (const report of native.filter(isRealizedSourceReport)) {
    const items = nativeItems(report, planned, systems);
    const keys = new Set(nativeReportMeasurements(report).map(row => row.measurementKey));
    const unappliedLinks = (report.measurementLinks ?? []).filter(link => !keys.has(link.measurementKey)).length;
    if (items.length || unappliedLinks) reports.push({ id: report.id, projectId, source: 'REPORT', reportType: report.reportType,
      sequenceNumber: report.sequenceNumber, reportDate: report.reportDate, revision: nativeReportRevision(report), items, unappliedLinks });
  }
  reports.sort((a, b) => new Date(a.reportDate) - new Date(b.reportDate) || a.id.localeCompare(b.id));
  return { project, reports };
}

// Um lote é validado inteiro antes da primeira escrita e gravado numa transação serializável.
export async function linkReconciledMeasurements(client, { projectId, measurements, projectSystemId, userId }) {
  if (!Array.isArray(measurements) || !measurements.length || measurements.length > 200) throw historicalError('Selecione de 1 a 200 medições.');
  const keys = measurements.map(item => JSON.stringify([item.source, item.reportId, item.measurementKey]));
  if (new Set(keys).size !== keys.length) throw historicalError('Uma medição não pode aparecer duas vezes no lote.');
  return client.$transaction(async tx => {
    await assertHistoricalProject(tx, projectId);
    const { planned, systems } = await context(tx, projectId);
    if (projectSystemId && !systems.some(system => system.id === projectSystemId)) throw historicalError('Selecione um sistema deste projeto.');
    const groups = new Map();
    for (const measurement of measurements) {
      if (!['HISTORICAL', 'REPORT'].includes(measurement.source)) throw historicalError('Origem de medição inválida.');
      const key = `${measurement.source}:${measurement.reportId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(measurement);
    }
    const changes = [];
    for (const selected of groups.values()) {
      const first = selected[0], historical = first.source === 'HISTORICAL';
      const report = historical
        ? await tx.historicalServiceReport.findFirst({ where: { id: first.reportId, projectId } })
        : await tx.report.findFirst({ where: { id: first.reportId, projectId, deletedAt: null }, include: nativeReconciliationInclude });
      if (!report) throw historicalError('Relatório não encontrado nesta missão.', 404);
      const revision = historical ? String(report.revision) : nativeReportRevision(report);
      if (selected.some(item => String(item.revision) !== revision)) throw historicalError('O relatório ou seus vínculos mudaram. Atualize a lista antes de salvar.', 409);
      let available, conflict = null;
      if (historical) {
        const sources = await tx.report.findMany({ where: { projectId, deletedAt: null, reportType: report.reportType, sequenceNumber: report.sequenceNumber }, select: historicalSourceSelect });
        conflict = sourceReportConflict(sources[0], { ...report, reportDate: new Date(report.reportDate).toISOString().slice(0, 10) });
        available = report.items.map((item, index) => ({ ...item, measurementKey: String(index) }));
      } else {
        if (!isRealizedSourceReport(report)) throw historicalError('Concilie as medições no relatório de origem.');
        available = nativeItems(report, planned, systems);
      }
      for (const selection of selected) {
        const item = available.find(item => item.measurementKey === selection.measurementKey);
        if (!item) throw historicalError('Medição não encontrada. Atualize a lista.', 409);
        if (projectSystemId) {
          const diagnostic = measurementReconciliation({ ...item, projectSystemId }, planned, systems, conflict);
          if (!diagnostic.compatibleSystemIds.includes(projectSystemId)) throw historicalError(conflict || diagnostic.message);
        }
      }
      changes.push({ historical, report, selected });
    }
    for (const { historical, report, selected } of changes) {
      if (historical) {
        const indexes = new Set(selected.map(item => item.measurementKey));
        const items = report.items.map((item, index) => {
          if (!indexes.has(String(index))) return item;
          const { projectSystemId: _previous, ...original } = item;
          return projectSystemId ? { ...original, projectSystemId } : original;
        });
        const result = await tx.historicalServiceReport.updateMany({ where: { id: report.id, projectId, revision: report.revision },
          data: { items, updatedByUserId: userId, revision: { increment: 1 } } });
        if (result.count !== 1) throw historicalError('O relatório mudou. Atualize a lista.', 409);
      } else for (const item of selected) {
        const where = { reportId: report.id, measurementKey: item.measurementKey };
        if (projectSystemId) await tx.reportMeasurementLink.upsert({ where: { reportId_measurementKey: where },
          create: { ...where, projectSystemId, updatedByUserId: userId }, update: { projectSystemId, updatedByUserId: userId } });
        else await tx.reportMeasurementLink.deleteMany({ where });
      }
    }
    return { saved: measurements.length };
  }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 30000 });
}

export async function linkReconciledMeasurement(client, input) {
  return linkHistoricalMeasurement(client, { ...input, validateTarget: async (tx, report) => {
    if (!input.projectSystemId) return; // Desvincular também permite corrigir destinos antigos fora do escopo.
    const [{ planned, systems }, sources] = await Promise.all([
      context(tx, input.projectId),
      tx.report.findMany({ where: { projectId: input.projectId, deletedAt: null, reportType: report.reportType, sequenceNumber: report.sequenceNumber }, select: historicalSourceSelect })
    ]);
    const conflict = sourceReportConflict(sources[0], { ...report, reportDate: new Date(report.reportDate).toISOString().slice(0, 10) });
    const status = measurementReconciliation({ ...report.items[input.itemIndex], projectSystemId: input.projectSystemId }, planned, systems, conflict);
    if (conflict || !status.compatibleSystemIds.includes(input.projectSystemId)) {
      throw historicalError(conflict || status.message);
    }
  } });
}
