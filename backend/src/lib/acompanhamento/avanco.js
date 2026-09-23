/*
 * Avanço físico do projeto (módulo Acompanhamento) — método D-3 "RDO ponderado por serviço".
 *
 * Previsto: escopo vendido (ProjectPlannedService + systems), com um peso por serviço.
 * Realizado: lido dos RDOs (ReportService.extraData), somando por serviço/sistema:
 *   - Tubulação (m): Σ tubes[].c convertendo cm→m
 *   - Óleo (L):      Σ volumeOleo convertendo mL→L
 *   - Sistemas (un): Σ quantidadeSistemas, apenas limpeza química sem tubulação
 *
 * avanço_% = Σ(peso_s × execução_s) ÷ Σ(peso_s)
 *   execução_s = média das execuções dos sistemas do serviço; execução_sistema = min(real/prev, 1).
 *
 * Contabilização: só entram serviços **finalizados** (`ReportService.finalized`). Um serviço que dura
 * vários dias aparece em vários RDOs, mas é finalizado uma única vez (as ocorrências em aberto são
 * "em andamento" — ver ongoingServices no front); assim cada atividade conta uma vez, no fechamento.
 */

import prisma from '../prisma.js';
import { loadHistoricalRealizedServices } from '../reports/historical-services-store.js';
import { buildSystemProgress } from './system-progress.js';
import { systemNameKey } from './project-systems.js';
import { extractServiceMeasurements, realizedFromExtraData } from './realized-measurements.js';
import { withNativeMeasurementLinks } from './native-measurement-links.js';
export { realizedFromExtraData } from './realized-measurements.js';
import { withScopeGroups } from './scope-groups.js';
import { normalizeRdoServiceType } from './service-types.js';

export { normalizeRdoServiceType } from './service-types.js';

// Parser numérico tolerante (os campos do RDO vêm como texto: "1.234,56", "1234.56", "50").
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value).trim().replace(/[^\d,.-]/g, '');
  if (!text) return null;
  text = text.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

// Um serviço só conta no realizado quando finalizado. Espelha serviceFinalized do front
// (utils/ongoingServices.ts): coluna booleana ou o campo textual em extraData.
export function isServiceFinalized(service) {
  if (typeof service?.finalized === 'boolean') return service.finalized;
  const stored = service?.extraData?.['Serviço finalizado?'];
  return typeof stored === 'string' && ['sim', 'true', 'finalizado'].includes(stored.trim().toLowerCase());
}

// RDOs e relatórios de serviço independentes são fontes do realizado. Relatórios técnicos gerados
// a partir de um RDO carregam a mesma medição e precisam ser ignorados para não duplicá-la.
export function isRealizedSourceReport(report) {
  if (!report?.reportType) return true;
  if (report.reportType === 'RDO') return true;
  return !report.specialConditions?.parentRdoId;
}

// O importador histórico preencheu a equipe dos RDOs a partir da planilha de marcações do ponto,
// não a partir dos nomes presentes no PDF. Esse vínculo é uma pista circular e não confirma, por
// si só, que a pessoa participou da missão.
export function isPointWorkbookDerivedRdoRoster(report) {
  const manualUpload = report?.specialConditions?.__manualUpload;
  return report?.reportType === 'RDO'
    && manualUpload?.importedByScript === 'import-manual-rdo-pdfs'
    && manualUpload?.collaboratorSource !== 'RDO_DOCUMENT';
}

export function isConfirmedReportParticipant(report, hasAllocatedHours = false) {
  return Boolean(hasAllocatedHours || !isPointWorkbookDerivedRdoRoster(report));
}

// Mantém relatórios-fonte e seus colaboradores alinhados. A filtragem em memória é necessária
// porque parentRdoId fica dentro de um JSON e relatórios antigos podem não ter essa chave.
export function selectRealizedSourceReportData(reports = [], collaborators = []) {
  const sourceReports = reports.filter(isRealizedSourceReport);
  const sourceReportIds = new Set(sourceReports.map(report => report.id));
  return {
    reports: sourceReports,
    collaborators: collaborators.filter(item => sourceReportIds.has(item.reportId))
  };
}

// Uma medição só pode alimentar uma meta. Conserva contexto para o detalhamento e a curva
// semanal usarem exatamente o mesmo vínculo, sem alterar os relatórios originais.
export function addRealizedService(byType, service, canonical = normalizeRdoServiceType(service.serviceType)) {
  if (!canonical) return;
  const data = service.extraData ?? {};
  const acc = byType.get(canonical) ?? { tubulacaoM: 0, oleoL: 0, measurements: [] };
  acc.measurements ??= [];
  const realized = realizedFromExtraData(data, canonical);
  acc.tubulacaoM += realized.tubulacaoM;
  acc.oleoL += realized.oleoL;
  acc.sistemasUn = (acc.sistemasUn ?? 0) + realized.sistemasUn;
  acc.measurements.push(...(service.reconciledMeasurements ?? extractServiceMeasurements(service, canonical)));
  byType.set(canonical, acc);
}

// Valor realizado na unidade do previsto: TUBULACAO=m, OLEO=L, SISTEMA=UN.
function realizedForSystem(systemType, realized) {
  if (systemType === 'TUBULACAO') return realized.tubulacaoM;
  if (systemType === 'OLEO') return realized.oleoL;
  if (systemType === 'SISTEMA') return realized.sistemasUn ?? 0;
  return 0;
}

function round(value, decimals = 1) {
  if (value === null || value === undefined) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function toDateKey(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function dateMs(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function startOfUtcWeekKey(value) {
  const ms = dateMs(value);
  if (ms === null) return null;
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  const diff = (d.getUTCDay() + 6) % 7; // semana iniciando na segunda-feira
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function hasMeasurableScope(plannedServices = []) {
  return plannedServices.some(service => (service.systems ?? []).some(system => {
    const quantity = num(system?.quantity);
    return quantity !== null && quantity > 0;
  }));
}

export function compactWeeklyProgressHistory(points = [], { startDate = null } = {}) {
  const byWeek = new Map();
  for (const point of points) {
    const progressPct = num(point?.progressPct);
    const date = toDateKey(point?.date);
    const week = startOfUtcWeekKey(date);
    if (progressPct === null || !date || !week) continue;
    const existing = byWeek.get(week);
    if (!existing || dateMs(date) >= dateMs(existing.date)) {
      byWeek.set(week, { date, progressPct: round(progressPct) });
    }
  }

  const out = Array.from(byWeek.values())
    .sort((a, b) => dateMs(a.date) - dateMs(b.date));
  const baselineDate = toDateKey(startDate);
  if (baselineDate && (out.length === 0 || dateMs(baselineDate) < dateMs(out[0].date))) {
    out.unshift({ date: baselineDate, progressPct: 0 });
  }
  return out;
}

// Monta o resultado de avanço de um projeto a partir do previsto e do realizado já agregado.
// realizedByType: Map<serviceTypeCanônico, {tubulacaoM, oleoL}>.
export function buildProgress(plannedServices, realizedByType) {
  if (plannedServices.some(service => service.systems?.some(row => row.projectSystemId))) {
    return withScopeGroups(buildSystemProgress(plannedServices, realizedByType, normalizeRdoServiceType), plannedServices, normalizeRdoServiceType);
  }
  const groupedServices = new Map();
  for (const svc of plannedServices) {
    const serviceType = normalizeRdoServiceType(svc.serviceType) ?? svc.serviceType;
    if (!groupedServices.has(serviceType)) {
      groupedServices.set(serviceType, { serviceType, weight: 0, systems: new Map() });
    }
    const grouped = groupedServices.get(serviceType);
    grouped.weight += Number(svc.weight ?? 1);
    for (const sys of svc.systems ?? []) {
      const systemKey = `${sys.systemType}:${sys.unit ?? ''}`;
      if (!grouped.systems.has(systemKey)) {
        grouped.systems.set(systemKey, {
          systemType: sys.systemType,
          unit: sys.unit,
          plannedQty: 0,
          hasPlannedQty: false
        });
      }
      const groupedSystem = grouped.systems.get(systemKey);
      const planned = sys.quantity != null ? Number(sys.quantity) : null;
      if (Number.isFinite(planned)) {
        groupedSystem.plannedQty += planned;
        groupedSystem.hasPlannedQty = true;
      }
    }
  }

  const services = Array.from(groupedServices.values()).map(svc => {
    const realized = realizedByType.get(svc.serviceType)
      ?? { tubulacaoM: 0, oleoL: 0 };
    const systems = Array.from(svc.systems.values()).map(sys => {
      const planned = sys.hasPlannedQty ? sys.plannedQty : null;
      const real = realizedForSystem(sys.systemType, realized);
      // O realizado pode exceder a meta cadastrada; preserve o percentual
      // real para evidenciar avanço acima de 100%.
      const pct = planned && planned > 0 ? (real / planned) * 100 : null;
      return {
        systemType: sys.systemType,
        unit: sys.unit,
        plannedQty: planned,
        realizedQty: round(real, 2),
        pct: round(pct)
      };
    });
    const measurable = systems.filter(s => s.pct !== null);
    const executionPct = measurable.length
      ? measurable.reduce((sum, s) => sum + s.pct, 0) / measurable.length
      : null;
    return {
      serviceType: svc.serviceType,
      weight: Number(svc.weight ?? 1),
      executionPct: round(executionPct),
      systems
    };
  });

  const weighted = services.filter(s => s.executionPct !== null);
  const totalWeight = weighted.reduce((sum, s) => sum + s.weight, 0);
  const progressPct = totalWeight > 0
    ? round(weighted.reduce((sum, s) => sum + s.weight * s.executionPct, 0) / totalWeight)
    : null;

  return withScopeGroups({
    hasScope: services.some(s => s.systems.some(sys => sys.plannedQty && sys.plannedQty > 0)),
    progressPct,
    services
  }, plannedServices, normalizeRdoServiceType);
}

function weeklyTargetStatus(remaining, remainingDays) {
  if (remaining <= 0) return 'COMPLETED';
  if (remainingDays < 0) return 'OVERDUE';
  if (remainingDays === 0) return 'DUE_TODAY';
  return 'REQUIRED';
}

// Calcula o ritmo mínimo para concluir o avanço e cada quantitativo medível até a data prevista.
// Serviços repetidos já chegam agregados por tipo em buildProgress; sistemas iguais somam o previsto.
export function buildRequiredWeeklyProgress(progress, {
  startDate = null,
  expectedEndDate = null,
  referenceDate = new Date()
} = {}) {
  const endKey = toDateKey(expectedEndDate);
  const referenceKey = toDateKey(referenceDate);
  const startKey = toDateKey(startDate);
  if (!endKey || !referenceKey) {
    return {
      status: 'UNAVAILABLE',
      remainingDays: null,
      remainingPctPoints: null,
      requiredPctPointsPerWeek: null,
      services: []
    };
  }

  const effectiveReferenceKey = startKey && dateMs(referenceKey) < dateMs(startKey) ? startKey : referenceKey;
  const remainingDays = Math.round((dateMs(endKey) - dateMs(effectiveReferenceKey)) / 86400000);
  const progressPct = num(progress?.progressPct);
  const remainingPctPoints = progressPct === null ? null : round(Math.max(100 - progressPct, 0));
  const status = remainingPctPoints === null
    ? 'UNAVAILABLE'
    : weeklyTargetStatus(remainingPctPoints, remainingDays);
  const requiredPctPointsPerWeek = status === 'REQUIRED'
    ? round(remainingPctPoints / (remainingDays / 7), 2)
    : null;

  const weeklyServices = input => (input ?? []).map(service => ({
    serviceType: service.serviceType,
    executionPct: service.executionPct,
    systems: (service.systems ?? []).map(system => {
      const plannedQty = num(system.plannedQty);
      const realizedQty = num(system.realizedQty);
      const remainingQty = plannedQty === null
        ? null
        : round(Math.max(plannedQty - (realizedQty ?? 0), 0), 2);
      const systemStatus = remainingQty === null
        ? 'UNAVAILABLE'
        : weeklyTargetStatus(remainingQty, remainingDays);
      return {
        ...(system.projectSystemId ? {
          projectSystemId: system.projectSystemId, equipment: system.equipment, systemName: system.systemName,
          diameter: system.diameter, diameterUnit: system.diameterUnit
        } : {}),
        systemType: system.systemType,
        unit: system.unit,
        plannedQty,
        realizedQty,
        remainingQty,
        status: systemStatus,
        requiredQtyPerWeek: systemStatus === 'REQUIRED'
          ? round(remainingQty / (remainingDays / 7), 2)
          : null
      };
    })
  }));
  const services = weeklyServices(progress?.services);

  return {
    status,
    remainingDays,
    remainingPctPoints,
    requiredPctPointsPerWeek,
    services,
    ...(progress?.scopeGroups ? { scopeGroups: progress.scopeGroups.map(group => ({ scopeName: group.scopeName, services: weeklyServices(group.services) })) } : {})
  };
}

// Reconstitui o histórico do avanço físico por semana a partir dos RDOs já lançados.
// O ponto semanal usa o último avanço conhecido naquela semana; semanas sem RDO ficam implícitas
// pelo espaçamento temporal do gráfico.
export function buildProgressHistory(plannedServices = [], serviceReports = [], {
  startDate = null,
  manualProgressPct = null,
  manualProgressHistory = [],
  currentDate = new Date()
} = {}) {
  if (!hasMeasurableScope(plannedServices)) {
    const manual = num(manualProgressPct);
    if (manual === null) return [];

    const manualPoints = (manualProgressHistory ?? [])
      .map(point => ({
        date: point?.recordedAt ?? point?.date,
        progressPct: num(point?.progressPct)
      }))
      .filter(point => point.progressPct !== null);
    const ordered = manualPoints
      .slice()
      .sort((a, b) => (dateMs(a.date) ?? 0) - (dateMs(b.date) ?? 0));
    const latest = ordered[ordered.length - 1];
    if (!latest || round(latest.progressPct) !== round(manual)) {
      ordered.push({ date: currentDate, progressPct: manual });
    }
    return compactWeeklyProgressHistory(ordered, { startDate });
  }

  const { points } = buildProgressTimeline(plannedServices, serviceReports);
  return weeklyHistory(points, startDate);
}

// Acumula, data a data, o realizado dos serviços finalizados de relatórios-fonte e registra o
// avanço após cada data com RDO. Devolve também o realizado final, que é o avanço atual.
function buildProgressTimeline(plannedServices, serviceReports) {
  const servicesByDate = new Map();
  for (const service of serviceReports) {
    if (!isServiceFinalized(service)) continue;
    if (!isRealizedSourceReport(service.report ?? service)) continue;
    const canonical = normalizeRdoServiceType(service.serviceType);
    if (!canonical) continue;
    const date = toDateKey(service.reportDate ?? service.report?.reportDate);
    if (!date) continue;
    if (!servicesByDate.has(date)) servicesByDate.set(date, []);
    servicesByDate.get(date).push({ ...service, canonical });
  }

  const realizedByType = new Map();
  const points = [];
  const dates = Array.from(servicesByDate.keys()).sort((a, b) => dateMs(a) - dateMs(b));
  for (const date of dates) {
    for (const service of servicesByDate.get(date) ?? []) {
      addRealizedService(realizedByType, service, service.canonical);
    }
    points.push({ date, progressPct: buildProgress(plannedServices, realizedByType).progressPct });
  }
  return { points, realizedByType };
}

function weeklyHistory(points, startDate) {
  const history = compactWeeklyProgressHistory(points.filter(point => point.progressPct !== null), { startDate });
  if (history.length === 0 && startDate) return [{ date: toDateKey(startDate), progressPct: 0 }];
  return history;
}

export const NO_SCOPE_KEY = '__sem-escopo__';
const scopeKeyOf = service => {
  const name = service.scopeName?.trim();
  return name ? systemNameKey(name) : NO_SCOPE_KEY;
};

// Recortes do escopo previsto por Escopo (nome do agrupamento) e por Equipamento/UG do cliente,
// combináveis entre si. Cada recorte mantém os serviços com o próprio peso e só as linhas do
// equipamento escolhido, então o avanço usa metas, pesos e realizado exclusivos dele. Escopo
// legado (sem sistema vinculado) não pertence a nenhuma UG.
//
// `lookup` mapeia "escopo|equipamento" ('' = todos) para o índice em `entries`; `null` significa
// "igual ao projeto inteiro" e ausência, combinação sem escopo medível. Combinações com os mesmos
// serviços e linhas compartilham a mesma entrada. Devolve null se não houver o que filtrar
// (menos de 2 escopos e menos de 2 equipamentos medíveis).
export function splitPlannedServices(plannedServices = []) {
  const scopes = new Map(), equipments = new Map();
  for (const service of plannedServices) {
    const key = scopeKeyOf(service);
    if (!scopes.has(key)) scopes.set(key, { key, name: service.scopeName?.trim() || 'Sem escopo definido' });
    for (const row of service.systems ?? []) {
      const name = row.projectSystem?.equipment, equipmentKey = systemNameKey(name);
      if (equipmentKey && !equipments.has(equipmentKey)) equipments.set(equipmentKey, { key: equipmentKey, name });
    }
  }

  const pick = (scopeKey, equipmentKey) => {
    const services = [], parts = [];
    plannedServices.forEach((service, index) => {
      if (scopeKey && scopeKeyOf(service) !== scopeKey) return;
      const rows = [];
      (service.systems ?? []).forEach((row, rowIndex) => {
        if (!equipmentKey || systemNameKey(row.projectSystem?.equipment) === equipmentKey) rows.push(rowIndex);
      });
      if (equipmentKey && rows.length === 0) return;
      services.push(equipmentKey ? { ...service, systems: rows.map(rowIndex => service.systems[rowIndex]) } : service);
      parts.push([index, rows]);
    });
    return { services, signature: JSON.stringify(parts) };
  };

  const measurable = (scopeKey, equipmentKey) => hasMeasurableScope(pick(scopeKey, equipmentKey).services);
  const validScopes = [...scopes.values()].filter(scope => measurable(scope.key, ''));
  const validEquipments = [...equipments.values()].filter(equipment => measurable('', equipment.key));
  if (validScopes.length < 2 && validEquipments.length < 2) return null;

  const scopeAxis = validScopes.length >= 2 ? ['', ...validScopes.map(scope => scope.key)] : [''];
  const equipmentAxis = validEquipments.length >= 2 ? ['', ...validEquipments.map(equipment => equipment.key)] : [''];
  const wholeSignature = pick('', '').signature;
  const entries = [], indexBySignature = new Map(), lookup = {};
  for (const scopeKey of scopeAxis) {
    for (const equipmentKey of equipmentAxis) {
      if (!scopeKey && !equipmentKey) continue;
      const { services, signature } = pick(scopeKey, equipmentKey);
      if (!hasMeasurableScope(services)) continue;
      if (signature !== wholeSignature && !indexBySignature.has(signature)) {
        indexBySignature.set(signature, entries.length);
        entries.push({ services });
      }
      lookup[`${scopeKey}|${equipmentKey}`] = signature === wholeSignature ? null : indexBySignature.get(signature);
    }
  }
  return {
    scopes: scopeAxis.length > 1 ? validScopes : [],
    equipments: equipmentAxis.length > 1 ? validEquipments : [],
    entries,
    lookup
  };
}

// Avanço e histórico semanal de cada recorte (escopo e/ou Equipamento/UG). Null quando o projeto
// não tem o que filtrar.
export function buildProgressSlices(plannedServices, serviceReports, { startDate = null } = {}) {
  const split = splitPlannedServices(plannedServices);
  if (!split) return null;
  return {
    scopes: split.scopes,
    equipments: split.equipments,
    lookup: split.lookup,
    slices: split.entries.map(({ services }) => {
      const { points, realizedByType } = buildProgressTimeline(services, serviceReports);
      return { progress: buildProgress(services, realizedByType), progressHistory: weeklyHistory(points, startDate) };
    })
  };
}

// Agrega o realizado dos RDOs (por projeto → por serviço canônico) para um conjunto de projetos.
export function realizedReportWhere(projectIds) {
  return { report: { projectId: { in: projectIds }, deletedAt: null } };
}

async function aggregateRealized(projectIds) {
  const byProject = new Map(); // projectId -> Map<serviceType, {tubulacaoM, oleoL}>
  if (projectIds.length === 0) return byProject;

  const [nativeServices, historicalServices] = await Promise.all([prisma.reportService.findMany({
    where: realizedReportWhere(projectIds),
    select: {
      id: true,
      finalized: true,
      serviceType: true,
      system: true,
      extraData: true,
      report: { select: { id: true, projectId: true, reportType: true, specialConditions: true, measurementLinks: true } }
    }
  }), loadHistoricalRealizedServices(prisma, projectIds)]);

  for (const svc of [...withNativeMeasurementLinks(nativeServices), ...historicalServices]) {
    if (!isServiceFinalized(svc)) continue; // só serviços finalizados entram no avanço
    if (!isRealizedSourceReport(svc.report)) continue;
    const canonical = normalizeRdoServiceType(svc.serviceType);
    if (!canonical) continue;
    const projectId = svc.report?.projectId;
    if (!projectId) continue;
    if (!byProject.has(projectId)) byProject.set(projectId, new Map());
    const byType = byProject.get(projectId);
    addRealizedService(byType, svc, canonical);
  }
  return byProject;
}

// Avanço de vários projetos de uma vez (usado no dashboard). Retorna Map<projectId, progress>.
// Método: RDO ponderado quando há escopo com meta; senão cai no avanço MANUAL (Project.manualProgressPct)
// se informado; senão fica indefinido (null).
export async function computeProgressForProjects(projectIds) {
  const result = new Map();
  if (!projectIds || projectIds.length === 0) return result;

  const [plannedServices, projects] = await Promise.all([
    prisma.projectPlannedService.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ order: 'asc' }],
      include: { systems: { orderBy: [{ order: 'asc' }], include: { projectSystem: true } } }
    }),
    prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, manualProgressPct: true } })
  ]);

  const manualById = new Map(projects.map(p => [p.id, p.manualProgressPct != null ? Number(p.manualProgressPct) : null]));
  const byProject = new Map();
  for (const svc of plannedServices) {
    if (!byProject.has(svc.projectId)) byProject.set(svc.projectId, []);
    byProject.get(svc.projectId).push(svc);
  }

  const realized = await aggregateRealized([...byProject.keys()]);

  for (const projectId of projectIds) {
    const services = byProject.get(projectId);
    const scope = services
      ? buildProgress(services, realized.get(projectId) ?? new Map())
      : { hasScope: false, progressPct: null, services: [] };
    const manual = manualById.get(projectId) ?? null;
    const useManual = scope.progressPct == null && manual != null;
    result.set(projectId, {
      ...scope,
      progressPct: scope.progressPct ?? (useManual ? manual : null),
      progressMethod: scope.progressPct != null ? 'RDO' : (useManual ? 'MANUAL' : null)
    });
  }
  return result;
}

// Serviços de relatório (nativos + históricos) de cada projeto, no formato consumido pela linha do
// tempo do avanço. Compartilhado pelo histórico do projeto e pelo avanço por equipamento.
async function loadReportServicesByProject(projectIds) {
  const [reportServices, historicalServices] = await Promise.all([
    prisma.reportService.findMany({
      where: {
        report: {
          projectId: { in: projectIds },
          deletedAt: null
        }
      },
      select: {
        id: true,
        finalized: true,
        serviceType: true,
        system: true,
        extraData: true,
        report: { select: { id: true, projectId: true, reportType: true, reportDate: true, specialConditions: true, measurementLinks: true } }
      }
    }),
    loadHistoricalRealizedServices(prisma, projectIds)
  ]);

  const servicesByProject = new Map();
  for (const service of [...withNativeMeasurementLinks(reportServices), ...historicalServices]) {
    const projectId = service.report?.projectId;
    if (!projectId) continue;
    if (!servicesByProject.has(projectId)) servicesByProject.set(projectId, []);
    servicesByProject.get(projectId).push({
      finalized: service.finalized,
      serviceType: service.serviceType,
      system: service.system,
      extraData: service.extraData,
      reconciledMeasurements: service.reconciledMeasurements,
      reportDate: service.report?.reportDate,
      reportType: service.report?.reportType,
      specialConditions: service.report?.specialConditions
    });
  }
  return servicesByProject;
}

export async function computeProgressHistoryForProjects(projectIds) {
  const result = new Map();
  if (!projectIds || projectIds.length === 0) return result;

  const [plannedServices, projects, servicesByProject, manualProgressHistory] = await Promise.all([
    prisma.projectPlannedService.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ order: 'asc' }],
      include: { systems: { orderBy: [{ order: 'asc' }], include: { projectSystem: true } } }
    }),
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, startDate: true, manualProgressPct: true, updatedAt: true }
    }),
    loadReportServicesByProject(projectIds),
    prisma.projectManualProgressHistory.findMany({
      where: { projectId: { in: projectIds } },
      select: { projectId: true, progressPct: true, recordedAt: true },
      orderBy: [{ recordedAt: 'asc' }, { createdAt: 'asc' }]
    })
  ]);

  const plannedByProject = new Map();
  for (const service of plannedServices) {
    if (!plannedByProject.has(service.projectId)) plannedByProject.set(service.projectId, []);
    plannedByProject.get(service.projectId).push(service);
  }

  const projectById = new Map(projects.map(project => [project.id, project]));

  const manualHistoryByProject = new Map();
  for (const item of manualProgressHistory) {
    if (!manualHistoryByProject.has(item.projectId)) manualHistoryByProject.set(item.projectId, []);
    manualHistoryByProject.get(item.projectId).push(item);
  }

  for (const projectId of projectIds) {
    const project = projectById.get(projectId);
    result.set(projectId, buildProgressHistory(
      plannedByProject.get(projectId) ?? [],
      servicesByProject.get(projectId) ?? [],
      {
        startDate: project?.startDate ?? null,
        manualProgressPct: project?.manualProgressPct ?? null,
        manualProgressHistory: manualHistoryByProject.get(projectId) ?? [],
        currentDate: project?.updatedAt ?? new Date()
      }
    ));
  }

  return result;
}

// Carrega, em uma única rodada de consultas, todas as projeções usadas pelo detalhe de projeto.
// Antes desta função o detalhe buscava escopo, projeto e serviços realizados separadamente para o
// avanço atual, o histórico e os recortes. Em grupos de missões esse trabalho ainda era repetido
// para calcular o peso de cada membro.
export async function computeProgressDetailsForProjects(projectIds) {
  const ids = [...new Set((projectIds ?? []).map(String).filter(Boolean))];
  const result = new Map();
  if (ids.length === 0) return result;

  const [plannedServices, projects, servicesByProject, manualProgressHistory] = await Promise.all([
    prisma.projectPlannedService.findMany({
      where: { projectId: { in: ids } },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { systems: { orderBy: [{ order: 'asc' }], include: { projectSystem: true } } }
    }),
    prisma.project.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        startDate: true,
        manualProgressPct: true,
        updatedAt: true,
        clientSegment: true,
        mobilizationDate: true,
        workdayHours: true,
        weekendWorkdayHours: true,
        offshore: true,
        laborSleepModeByCollaborator: true
      }
    }),
    loadReportServicesByProject(ids),
    prisma.projectManualProgressHistory.findMany({
      where: { projectId: { in: ids } },
      select: { projectId: true, progressPct: true, recordedAt: true },
      orderBy: [{ recordedAt: 'asc' }, { createdAt: 'asc' }]
    })
  ]);

  const plannedByProject = new Map();
  for (const service of plannedServices) {
    if (!plannedByProject.has(service.projectId)) plannedByProject.set(service.projectId, []);
    plannedByProject.get(service.projectId).push(service);
  }
  const projectById = new Map(projects.map(project => [project.id, project]));
  const manualHistoryByProject = new Map();
  for (const item of manualProgressHistory) {
    if (!manualHistoryByProject.has(item.projectId)) manualHistoryByProject.set(item.projectId, []);
    manualHistoryByProject.get(item.projectId).push(item);
  }

  for (const projectId of ids) {
    const project = projectById.get(projectId);
    if (!project) continue;
    const planned = plannedByProject.get(projectId) ?? [];
    const serviceReports = servicesByProject.get(projectId) ?? [];
    const timeline = buildProgressTimeline(planned, serviceReports);
    const scope = planned.length > 0
      ? buildProgress(planned, timeline.realizedByType)
      : { hasScope: false, progressPct: null, services: [] };
    const manual = project.manualProgressPct != null ? Number(project.manualProgressPct) : null;
    const useManual = scope.progressPct == null && manual != null;
    const progress = {
      ...scope,
      progressPct: scope.progressPct ?? (useManual ? manual : null),
      progressMethod: scope.progressPct != null ? 'RDO' : (useManual ? 'MANUAL' : null)
    };
    const progressHistory = hasMeasurableScope(planned)
      ? weeklyHistory(timeline.points, project.startDate)
      : buildProgressHistory(planned, serviceReports, {
          startDate: project.startDate,
          manualProgressPct: project.manualProgressPct,
          manualProgressHistory: manualHistoryByProject.get(projectId) ?? [],
          currentDate: project.updatedAt ?? new Date()
        });

    result.set(projectId, {
      project,
      plannedServices: planned,
      progress,
      progressHistory,
      progressSlices: buildProgressSlices(planned, serviceReports, { startDate: project.startDate })
    });
  }
  return result;
}

export async function computeProjectProgressDetails(projectId) {
  const details = (await computeProgressDetailsForProjects([projectId])).get(projectId);
  if (!details) throw new Error('Projeto não encontrado.');
  return details;
}

// Recortes de avanço (escopo e/ou Equipamento/UG do cliente) de um projeto; null quando não há o
// que filtrar. O ritmo semanal é montado por quem conhece as datas do cronograma.
export async function computeProgressSlicesForProject(projectId) {
  const plannedServices = await prisma.projectPlannedService.findMany({
    where: { projectId },
    orderBy: [{ order: 'asc' }],
    include: { systems: { orderBy: [{ order: 'asc' }], include: { projectSystem: true } } }
  });
  if (!splitPlannedServices(plannedServices)) return null;

  const [project, servicesByProject] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { startDate: true } }),
    loadReportServicesByProject([projectId])
  ]);
  return buildProgressSlices(plannedServices, servicesByProject.get(projectId) ?? [], { startDate: project?.startDate ?? null });
}

// Avanço detalhado de um projeto (endpoint do modal do cronograma).
export async function computeProjectProgress(projectId) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new Error('Projeto não encontrado.');
  const map = await computeProgressForProjects([projectId]);
  return map.get(projectId) ?? { hasScope: false, progressPct: null, progressMethod: null, services: [] };
}
