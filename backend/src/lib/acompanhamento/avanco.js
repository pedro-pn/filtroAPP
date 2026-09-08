/*
 * Avanço físico do projeto (módulo Acompanhamento) — método D-3 "RDO ponderado por serviço".
 *
 * Previsto: escopo vendido (ProjectPlannedService + systems), com um peso por serviço.
 * Realizado: lido dos RDOs (ReportService.extraData), somando por serviço/sistema:
 *   - Tubulação (m): Σ tubes[].c convertendo cm→m
 *   - Óleo (L):      Σ volumeOleo convertendo mL→L
 *
 * avanço_% = Σ(peso_s × execução_s) ÷ Σ(peso_s)
 *   execução_s = média das execuções dos sistemas do serviço; execução_sistema = min(real/prev, 1).
 *
 * Contabilização: só entram serviços **finalizados** (`ReportService.finalized`). Um serviço que dura
 * vários dias aparece em vários RDOs, mas é finalizado uma única vez (as ocorrências em aberto são
 * "em andamento" — ver ongoingServices no front); assim cada atividade conta uma vez, no fechamento.
 */

import prisma from '../prisma.js';

// Normaliza o serviceType do RDO (vários formatos: 'limpeza', 'LIMPEZA', 'Limpeza química'...) para
// o código canônico usado no escopo previsto. Retorna null quando não há equivalente no previsto.
export function normalizeRdoServiceType(raw) {
  const key = String(raw ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase().replace(/[^a-z]/g, ''); // só letras
  if (!key) return null;
  if (key.startsWith('limpezaquimica') || key === 'limpeza') return 'LIMPEZA_QUIMICA';
  if (key.startsWith('testedepressao') || key === 'pressao') return 'TESTE_PRESSAO';
  if (key.startsWith('flushing')) return 'FLUSHING';
  if (key.startsWith('filtragem') || key.startsWith('unidadedefiltragem')) return 'FILTRAGEM';
  return null; // mecânica, inibição etc. não têm previsto — fora do avanço
}

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

// Extrai o realizado comparável de um ReportService.extraData: tubulação (m) e óleo (L).
export function realizedFromExtraData(extraData) {
  const data = extraData && typeof extraData === 'object' ? extraData : {};
  let tubulacaoM = 0;
  const tubes = Array.isArray(data.tubes) ? data.tubes : [];
  for (const tube of tubes) {
    const c = num(tube?.c);
    if (c === null) continue;
    tubulacaoM += (tube?.lengthUnit === 'cm') ? c / 100 : c;
  }
  let oleoL = 0;
  const vol = num(data.volumeOleo);
  if (vol !== null) oleoL += (data.volumeOleoUnit === 'mL') ? vol / 1000 : vol;

  return { tubulacaoM, oleoL };
}

// Valor realizado de um sistema (mesma unidade do previsto: TUBULACAO=m, OLEO=L).
function realizedForSystem(systemType, realized) {
  if (systemType === 'TUBULACAO') return realized.tubulacaoM;
  if (systemType === 'OLEO') return realized.oleoL;
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
      const pct = planned && planned > 0 ? Math.min(real / planned, 1) * 100 : null;
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

  return {
    hasScope: services.some(s => s.systems.some(sys => sys.plannedQty && sys.plannedQty > 0)),
    progressPct,
    services
  };
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

  const services = (progress?.services ?? []).map(service => ({
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

  return {
    status,
    remainingDays,
    remainingPctPoints,
    requiredPctPointsPerWeek,
    services
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
  const rawPoints = [];
  const dates = Array.from(servicesByDate.keys()).sort((a, b) => dateMs(a) - dateMs(b));
  for (const date of dates) {
    for (const service of servicesByDate.get(date) ?? []) {
      const acc = realizedByType.get(service.canonical) ?? { tubulacaoM: 0, oleoL: 0 };
      const realized = realizedFromExtraData(service.extraData);
      acc.tubulacaoM += realized.tubulacaoM;
      acc.oleoL += realized.oleoL;
      realizedByType.set(service.canonical, acc);
    }
    const progress = buildProgress(plannedServices, realizedByType);
    if (progress.progressPct !== null) rawPoints.push({ date, progressPct: progress.progressPct });
  }

  const history = compactWeeklyProgressHistory(rawPoints, { startDate });
  if (history.length === 0 && startDate) return [{ date: toDateKey(startDate), progressPct: 0 }];
  return history;
}

// Agrega o realizado dos RDOs (por projeto → por serviço canônico) para um conjunto de projetos.
export function realizedReportWhere(projectIds) {
  return { report: { projectId: { in: projectIds }, deletedAt: null } };
}

async function aggregateRealized(projectIds) {
  const byProject = new Map(); // projectId -> Map<serviceType, {tubulacaoM, oleoL}>
  if (projectIds.length === 0) return byProject;

  const services = await prisma.reportService.findMany({
    where: realizedReportWhere(projectIds),
    select: {
      finalized: true,
      serviceType: true,
      extraData: true,
      report: { select: { projectId: true, reportType: true, specialConditions: true } }
    }
  });

  for (const svc of services) {
    if (!isServiceFinalized(svc)) continue; // só serviços finalizados entram no avanço
    if (!isRealizedSourceReport(svc.report)) continue;
    const canonical = normalizeRdoServiceType(svc.serviceType);
    if (!canonical) continue;
    const projectId = svc.report?.projectId;
    if (!projectId) continue;
    if (!byProject.has(projectId)) byProject.set(projectId, new Map());
    const byType = byProject.get(projectId);
    const acc = byType.get(canonical) ?? { tubulacaoM: 0, oleoL: 0 };
    const r = realizedFromExtraData(svc.extraData);
    acc.tubulacaoM += r.tubulacaoM;
    acc.oleoL += r.oleoL;
    byType.set(canonical, acc);
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
      include: { systems: { orderBy: [{ order: 'asc' }] } }
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

export async function computeProgressHistoryForProjects(projectIds) {
  const result = new Map();
  if (!projectIds || projectIds.length === 0) return result;

  const [plannedServices, projects, reportServices, manualProgressHistory] = await Promise.all([
    prisma.projectPlannedService.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: [{ order: 'asc' }],
      include: { systems: { orderBy: [{ order: 'asc' }] } }
    }),
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, startDate: true, manualProgressPct: true, updatedAt: true }
    }),
    prisma.reportService.findMany({
      where: {
        report: {
          projectId: { in: projectIds },
          deletedAt: null
        }
      },
      select: {
        finalized: true,
        serviceType: true,
        extraData: true,
        report: { select: { projectId: true, reportType: true, reportDate: true, specialConditions: true } }
      }
    }),
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
  const servicesByProject = new Map();
  for (const service of reportServices) {
    const projectId = service.report?.projectId;
    if (!projectId) continue;
    if (!servicesByProject.has(projectId)) servicesByProject.set(projectId, []);
    servicesByProject.get(projectId).push({
      finalized: service.finalized,
      serviceType: service.serviceType,
      extraData: service.extraData,
      reportDate: service.report?.reportDate,
      reportType: service.report?.reportType,
      specialConditions: service.report?.specialConditions
    });
  }

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

// Avanço detalhado de um projeto (endpoint do modal do cronograma).
export async function computeProjectProgress(projectId) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new Error('Projeto não encontrado.');
  const map = await computeProgressForProjects([projectId]);
  return map.get(projectId) ?? { hasScope: false, progressPct: null, progressMethod: null, services: [] };
}
