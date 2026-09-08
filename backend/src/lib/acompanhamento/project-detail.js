/*
 * Dashboard de um projeto (módulo Acompanhamento). Cruza previsto (comercial + escopo manual) com o
 * realizado dos relatórios-fonte e das compras do Omie, para a tela de detalhe aberta ao clicar num card.
 *
 * Regras do cliente:
 *  - Gasto = TOTAL (pago + a pagar) dos títulos do Omie do projeto.
 *  - Excluir custos de salário/mão de obra (serão calculados no app via VR): filtramos categorias
 *    cuja descrição contém palavras-chave de folha (salário, INSS, FGTS, férias, 13º, rescisão...).
 *  - Standby cobrindo a jornada cheia do dia = dia "parado".
 */

import { listCommercialDashboard } from './access-import.js';
import { computeAlerts } from './alerts.js';
import { buildOmieCostCategoryWhere } from './cost-categories.js';
import { getEquipmentUsageByProject } from './equipment-usage.js';
import { laborCostByProject } from './labor-cost.js';
import { getManualProjectCostsByProject } from './manual-costs.js';
import { buildWorkedHoursProgress } from './project-cards.js';
import {
  buildRequiredWeeklyProgress,
  computeProgressHistoryForProjects,
  computeProjectProgress,
  isConfirmedReportParticipant,
  selectRealizedSourceReportData
} from './avanco.js';
import {
  nightCollaboratorIdsFromReport,
  nightCollaboratorSnapshotsFromReport,
  reportPersonTimeMetrics,
  reportWorkedMinutesByCollaborator
} from './report-time.js';
import { isSalaryCategory } from './salary.js';
import { getStockConsumptionCostByProject } from './stock-cost.js';
import prisma from '../prisma.js';

function toNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMinutes(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const str = String(value).trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const parts = str.split(':');
  if (parts.length >= 2) return parseInt(parts[0], 10) * 60 + (parseInt(parts[1], 10) || 0);
  return 0;
}

function journeyMinutes(project, reportDate) {
  const day = new Date(reportDate).getUTCDay();
  const isWeekend = day === 0 || day === 6;
  const hours = isWeekend ? (project?.weekendWorkdayHours || project?.workdayHours) : project?.workdayHours;
  return parseMinutes(hours);
}

function dateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function diffCalendarDays(from, to) {
  const a = new Date(from); const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function addCalendarDays(startDate, days) {
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + Math.round(days));
  return d.toISOString();
}

function normalizeRole(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function plannedRoleName(item) {
  return item.roleName || item.jobRole?.name || null;
}

function addRoleWork(collaboratorIdsByRole, workedHoursByRole, collaboratorId, role, workedMinutes) {
  const roleKey = normalizeRole(role);
  if (!roleKey || !collaboratorId) return;
  if (!collaboratorIdsByRole.has(roleKey)) collaboratorIdsByRole.set(roleKey, new Set());
  collaboratorIdsByRole.get(roleKey).add(collaboratorId);
  workedHoursByRole.set(roleKey, (workedHoursByRole.get(roleKey) || 0) + (workedMinutes / 60));
}

function nightCollaboratorRole(report, collaboratorId, index, roleByCollaboratorId) {
  const noturnoDetails = report?.specialConditions?.noturnoDetails || {};
  const snapshots = Array.isArray(noturnoDetails.colaboradores) ? noturnoDetails.colaboradores : [];
  const snapshot = snapshots.find(item => item?.id === collaboratorId) || snapshots[index];
  return snapshot && typeof snapshot === 'object'
    ? snapshot.role || roleByCollaboratorId.get(collaboratorId)
    : roleByCollaboratorId.get(collaboratorId);
}

export function buildPlannedRoleCounts(plannedRows = [], collaborators = [], plannedTotalHours = 0, reports = null) {
  const collaboratorIdsByRole = new Map();
  const workedHoursByRole = new Map();
  const roleByCollaboratorId = new Map();
  const useTurnAwareReports = Array.isArray(reports);
  for (const c of collaborators) {
    const currentRole = c.roleNameSnapshot || c.collaborator?.jobRole?.name;
    if (c.collaboratorId && currentRole) roleByCollaboratorId.set(c.collaboratorId, currentRole);
    const workedMinutes = (c.report?.daytimeWorkedMinutes || 0) + (useTurnAwareReports ? 0 : c.report?.nighttimeWorkedMinutes || 0);
    addRoleWork(collaboratorIdsByRole, workedHoursByRole, c.collaboratorId, currentRole, workedMinutes);
  }

  if (useTurnAwareReports) {
    for (const report of reports) {
      const nightWorkedMinutes = report?.nighttimeWorkedMinutes || 0;
      if (nightWorkedMinutes <= 0) continue;
      nightCollaboratorIdsFromReport(report).forEach((collaboratorId, index) => {
        addRoleWork(
          collaboratorIdsByRole,
          workedHoursByRole,
          collaboratorId,
          nightCollaboratorRole(report, collaboratorId, index, roleByCollaboratorId),
          nightWorkedMinutes
        );
      });
    }
  }

  const plannedRoles = new Map();
  for (const row of plannedRows) {
    const label = plannedRoleName(row);
    const roleKey = normalizeRole(label);
    if (roleKey && !plannedRoles.has(roleKey)) plannedRoles.set(roleKey, label);
  }

  return [...plannedRoles.entries()]
    .map(([roleKey, roleName]) => ({
      roleName,
      collaboratorCount: collaboratorIdsByRole.get(roleKey)?.size ?? 0,
      usedHours: Math.round((workedHoursByRole.get(roleKey) || 0) * 10) / 10
    }))
    .map(item => ({
      ...item,
      pctOfPlannedTotal: plannedTotalHours > 0 ? Math.round((item.usedHours / plannedTotalHours) * 100) : null
    }))
    .filter(item => item.collaboratorCount > 0)
    .sort((a, b) => a.roleName.localeCompare(b.roleName, 'pt-BR'));
}

function isPaidTitle(status) {
  return String(status || '').trim().toUpperCase() === 'PAGO';
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function minutesToHours(minutes) {
  return Math.round((Math.max(0, minutes) / 60) * 10) / 10;
}

export function buildOmieCostPaymentSummary(groups = []) {
  let paid = 0;
  let pending = 0;

  for (const group of groups) {
    if (isSalaryCategory(group.categoriaDescricao || group.categoriaCodigo)) continue;
    const value = toNum(group._sum?.valor) ?? 0;
    if (value <= 0) continue;
    if (isPaidTitle(group.statusTitulo)) paid += value;
    else pending += value;
  }

  return {
    pago: roundMoney(paid),
    previstoPagar: roundMoney(pending)
  };
}

export function buildProjectReportHours(reports, collaboratorIdsByReport, projectCode) {
  const byCollaborator = new Map();
  for (const report of reports) {
    const data = dateKey(report.reportDate);
    const ids = collaboratorIdsByReport.get(report.id) || [];
    for (const [collaboratorId, minutes] of reportWorkedMinutesByCollaborator(report, ids)) {
      const entry = byCollaborator.get(collaboratorId) || {
        workedMinutes: 0,
        workedMinutesByDate: new Map(),
        reportSourcesByDate: new Map()
      };
      entry.workedMinutes += minutes;
      entry.workedMinutesByDate.set(data, (entry.workedMinutesByDate.get(data) || 0) + minutes);
      const sources = entry.reportSourcesByDate.get(data) || [];
      sources.push({
        id: report.id,
        tipo: report.reportType,
        numero: report.sequenceNumber ?? null,
        projetoId: report.projectId,
        projetoCodigo: projectCode ? String(projectCode) : null,
        horas: minutes / 60
      });
      entry.reportSourcesByDate.set(data, sources);
      byCollaborator.set(collaboratorId, entry);
    }
  }
  return byCollaborator;
}

export function buildProjectDetailCollaborator({
  name = '',
  role = '',
  rate = null,
  allocation = null,
  projectId = null,
  workedMinutes = 0,
  workedMinutesByDate = new Map(),
  reportSourcesByDate = new Map(),
  includeCollaboratorCosts = false
} = {}) {
  const custo = allocation?.cost ?? null;
  const horasApropriadas = Math.max(0, toNum(allocation?.hours) ?? 0);
  const horasDeslocamento = Math.min(
    horasApropriadas,
    Math.max(0, toNum(allocation?.travelHours) ?? 0)
  );
  const custoHora = allocation && horasApropriadas > 0 ? allocation.cost / horasApropriadas : null;
  const custoDeslocamento = custo != null && horasApropriadas > 0 && horasDeslocamento > 0
    ? roundMoney(custo * (horasDeslocamento / horasApropriadas))
    : null;
  const horasRelatorios = minutesToHours(workedMinutes);
  const horasRelatoriosPorData = [...workedMinutesByDate.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([data, minutes]) => ({
      data,
      horas: minutes / 60,
      relatorios: reportSourcesByDate.get(data) || []
    }));
  const diasApropriados = projectId && rate
    ? buildProjectAppropriationDays(rate, projectId)
    : [];

  return {
    name: name || rate?.name || '—',
    role: role || rate?.role || '—',
    // Jornada informada nos RDOs. Em grupos, ela sera deduplicada por pessoa e data.
    horas: horasRelatorios,
    horasLancadas: Math.max(0, workedMinutes) / 60,
    horasApropriadas: allocation?.hours ?? null,
    horasDeslocamento,
    diasApropriados,
    sobreposicaoHoras: 0,
    horasRelatoriosPorData,
    // Custo é dado sensível (salário): só para gestores.
    custo: includeCollaboratorCosts ? custo : null,
    custoHora: includeCollaboratorCosts ? custoHora : null,
    custoDeslocamento: includeCollaboratorCosts ? custoDeslocamento : null
  };
}

export function buildProjectAppropriationDays(rate = null, projectId = null) {
  if (!rate || !projectId) return [];
  const analyticalTrail = Array.isArray(rate.analyticalAllocationTrail)
    ? rate.analyticalAllocationTrail
    : [];
  const trail = analyticalTrail.length > 0
    ? analyticalTrail
    : Array.isArray(rate.allocationTrail) ? rate.allocationTrail : [];

  return trail.flatMap(day => {
    const weight = (day.allocations || [])
      .filter(item => item.projectId === projectId)
      .reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
    if (weight <= 0) return [];

    const horasNormais = Math.max(0, Number(day.costNormalHours ?? day.normalHours) || 0) * weight;
    const horasExtras = (
      Math.max(0, Number(day.he70Hours) || 0)
      + Math.max(0, Number(day.he100Hours) || 0)
    ) * weight;
    const rdos = (day.rdoProjects || []).map(item => ({
      numero: item.rdoNumber ?? null,
      projetoId: item.projectId ?? null,
      projetoCodigo: item.projectCode ? String(item.projectCode) : null
    }));

    return [{
      data: day.date,
      horas: horasNormais + horasExtras,
      horasNormais,
      horasExtras,
      emViagem: Boolean(day.travelContext),
      rdos
    }];
  }).sort((left, right) => left.data.localeCompare(right.data));
}

// Status do dia a partir do standby agregado vs jornada cheia.
function dayStatus(standbyMin, journeyMin) {
  if (standbyMin > 0 && journeyMin > 0 && standbyMin >= journeyMin) return 'PARADO';
  if (standbyMin > 0) return 'STANDBY';
  return 'TRABALHADO';
}

export function buildRecentReportDays(byDay, project, limit = 10) {
  return [...byDay.entries()]
    .sort((a, b) => new Date(a[1].reportDate) - new Date(b[1].reportDate))
    .slice(-limit)
    .map(([key, day]) => ({
      date: key,
      status: dayStatus(day.statusStandbyMin, journeyMinutes(project, day.reportDate)),
      workedMinutes: day.workedMin,
      standbyMinutes: day.standbyMin
    }));
}

export async function getProjectDetail(projectId, {
  includeCollaboratorCosts = false,
  includeAdminOnlyCategories = true
} = {}) {
  const rows = await listCommercialDashboard({ includeAdminOnlyCategories });
  const row = rows.find(r => r.projectId === projectId);
  if (!row) throw new Error('Projeto não encontrado no acompanhamento comercial.');
  const categoryWhere = await buildOmieCostCategoryWhere({
    includeAdminOnly: includeAdminOnlyCategories
  });

  const [
    project,
    queriedReports,
    queriedCollaborators,
    costGroups,
    costStatusGroups,
    labor,
    equipmentByProject,
    stockCosts,
    manualCostsByProject,
    plannedNormalHours,
    plannedOvertime,
    progressHistoryByProject,
    projectProgress
  ] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { clientSegment: true, mobilizationDate: true, workdayHours: true, weekendWorkdayHours: true }
    }),
    prisma.report.findMany({
      where: { projectId, deletedAt: null },
      select: {
        id: true,
        projectId: true,
        reportType: true,
        sequenceNumber: true,
        reportDate: true, specialConditions: true, totalOvertimeMinutes: true,
        daytimeCount: true,
        daytimeWorkedMinutes: true, nighttimeWorkedMinutes: true,
        daytimeOvertimeMinutes: true, nighttimeOvertimeMinutes: true
      },
      orderBy: { reportDate: 'asc' }
    }),
    prisma.reportCollaborator.findMany({
      where: { report: { projectId, deletedAt: null } },
      select: {
        reportId: true,
        collaboratorId: true,
        roleNameSnapshot: true,
        collaborator: { select: { name: true, jobRole: { select: { name: true } } } },
        report: { select: { daytimeWorkedMinutes: true, nighttimeWorkedMinutes: true } }
      }
    }),
    prisma.omiePurchase.groupBy({
      by: ['categoriaCodigo', 'categoriaDescricao'],
      where: { projectId, ...categoryWhere },
      _sum: { valor: true }
    }),
    prisma.omiePurchase.groupBy({
      by: ['statusTitulo', 'categoriaCodigo', 'categoriaDescricao'],
      where: { projectId, ...categoryWhere },
      _sum: { valor: true }
    }),
    laborCostByProject(), // custo de mão de obra (HH) do ponto vigente
    getEquipmentUsageByProject([projectId]),
    getStockConsumptionCostByProject([projectId]),
    getManualProjectCostsByProject([projectId], { includeEntries: true }),
    prisma.projectPlannedNormalHours.findMany({
      where: { projectId },
      select: { hours: true, roleName: true, jobRole: { select: { name: true } } }
    }),
    prisma.projectPlannedOvertime.findMany({
      where: { projectId },
      select: { hours: true, roleName: true, jobRole: { select: { name: true } } }
    }),
    computeProgressHistoryForProjects([projectId]),
    computeProjectProgress(projectId)
  ]);
  const { reports, collaborators } = selectRealizedSourceReportData(queriedReports, queriedCollaborators);

  // Mão de obra (HH) do ponto — mantido SEPARADO do gasto Omie (em validação, não somado).
  const laborAgg = labor.byProjectId.get(projectId) || null;
  const maoDeObra = {
    custo: laborAgg?.laborCost ?? null, // com adicional offshore
    custoBase: laborAgg?.laborCostBase ?? null, // sem offshore
    horas: laborAgg?.hours ?? null,
    periodStart: labor.periodStart ?? null,
    periodEnd: labor.periodEnd ?? null
  };

  // --- Custos (Omie), excluindo salários ---
  const nonSalary = costGroups
    .filter(g => !isSalaryCategory(g.categoriaDescricao || g.categoriaCodigo))
    .map(g => ({
      categoria: g.categoriaDescricao || g.categoriaCodigo || 'Sem categoria',
      total: toNum(g._sum.valor) ?? 0
    }))
    .filter(g => g.total > 0)
    .sort((a, b) => b.total - a.total);
  const omieGasto = nonSalary.reduce((sum, g) => sum + g.total, 0);
  const omiePayment = buildOmieCostPaymentSummary(costStatusGroups);
  const stockCost = stockCosts.get(projectId) || { total: 0, categories: [] };
  const manualCost = manualCostsByProject.get(projectId) || { total: 0, entries: [], categories: [] };
  const gasto = omieGasto + stockCost.total + manualCost.total;
  const previstoCusto = toNum(row.plannedTotalCost);
  const maioresGastos = [...nonSalary, ...stockCost.categories, ...manualCost.categories]
    .filter(g => g.total > 0)
    .sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria, 'pt-BR'))
    .slice(0, 5);

  // --- Agregação dos relatórios-fonte de execução (por dia) ---
  const dayCollaboratorIdsByReport = new Map();
  for (const c of collaborators) {
    if (!dayCollaboratorIdsByReport.has(c.reportId)) dayCollaboratorIdsByReport.set(c.reportId, []);
    dayCollaboratorIdsByReport.get(c.reportId).push(c.collaboratorId);
  }

  const byDay = new Map(); // dateKey -> { standbyMin, statusStandbyMin, workedMin, overtimeMin, reportDate }
  let standbyCount = 0;
  let standbyMinutesTotal = 0;
  let overtimeMinutesTotal = 0;
  let normalWorkedMinutesTotal = 0;
  let overtimeWorkedMinutesTotal = 0;
  let lastRdoDate = null;
  const reportHoursByCollaborator = buildProjectReportHours(reports, dayCollaboratorIdsByReport, row.code);

  for (const r of reports) {
    const key = dateKey(r.reportDate);
    if (!lastRdoDate || new Date(r.reportDate) > new Date(lastRdoDate)) lastRdoDate = r.reportDate;
    const sc = r.specialConditions || {};
    const dayCollaboratorIds = dayCollaboratorIdsByReport.get(r.id) || [];
    const metrics = reportPersonTimeMetrics(r, dayCollaboratorIds);
    const standbyMin = metrics.standbyDurationMinutes;
    if (sc.standby === true) standbyCount += 1;
    standbyMinutesTotal += metrics.standbyPersonMinutes;
    overtimeMinutesTotal += metrics.overtimeWorkedMinutes;
    normalWorkedMinutesTotal += metrics.normalWorkedMinutes;
    overtimeWorkedMinutesTotal += metrics.overtimeWorkedMinutes;
    const acc = byDay.get(key) || { standbyMin: 0, statusStandbyMin: 0, workedMin: 0, overtimeMin: 0, reportDate: r.reportDate };
    acc.standbyMin += metrics.standbyPersonMinutes;
    acc.statusStandbyMin += standbyMin;
    acc.workedMin += metrics.normalWorkedMinutes + metrics.overtimeWorkedMinutes;
    acc.overtimeMin += metrics.overtimeWorkedMinutes;
    byDay.set(key, acc);
  }

  const workedDays = byDay.size;

  // Últimos 10 dias (cronológico) com status para a régua de bolinhas.
  const ultimosDias = buildRecentReportDays(byDay, project);

  // --- Colaboradores distintos (nome + cargo + custo/hora do ponto vigente) ---
  const ratesById = labor.byCollaboratorId || new Map();
  const reportById = new Map(reports.map(report => [report.id, report]));
  const projectAllocation = collaboratorId => {
    const rate = ratesById.get(collaboratorId) || null;
    return rate?.analyticalByProject?.[projectId] || rate?.byProject?.[projectId] || null;
  };
  const hasAllocatedHours = collaboratorId => (
    Math.max(0, toNum(projectAllocation(collaboratorId)?.hours) ?? 0) > 0
  );
  const confirmedReportParticipantIds = new Set();
  for (const item of collaborators) {
    if (isConfirmedReportParticipant(reportById.get(item.reportId), hasAllocatedHours(item.collaboratorId))) {
      confirmedReportParticipantIds.add(item.collaboratorId);
    }
  }
  for (const report of reports) {
    for (const collaboratorId of nightCollaboratorIdsFromReport(report)) {
      if (isConfirmedReportParticipant(report, hasAllocatedHours(collaboratorId))) {
        confirmedReportParticipantIds.add(collaboratorId);
      }
    }
  }
  const collabMap = new Map();
  const ensureCollaborator = (collaboratorId, { name = '', role = '' } = {}) => {
    if (!collaboratorId || collabMap.has(collaboratorId)) return;
    const rate = ratesById.get(collaboratorId) || null;
    const alloc = projectAllocation(collaboratorId);
    collabMap.set(collaboratorId, buildProjectDetailCollaborator({
      name,
      role,
      rate,
      allocation: alloc,
      projectId,
      ...reportHoursByCollaborator.get(collaboratorId),
      includeCollaboratorCosts
    }));
  };
  for (const c of collaborators) {
    ensureCollaborator(c.collaboratorId, {
      name: c.collaborator?.name || '',
      role: c.roleNameSnapshot || c.collaborator?.jobRole?.name || ''
    });
  }
  for (const report of reports) {
    for (const snapshot of nightCollaboratorSnapshotsFromReport(report)) {
      ensureCollaborator(snapshot.id, snapshot);
    }
    for (const collaboratorId of nightCollaboratorIdsFromReport(report)) {
      ensureCollaborator(collaboratorId);
    }
  }
  for (const collaboratorId of reportHoursByCollaborator.keys()) {
    ensureCollaborator(collaboratorId);
  }
  // A exceção de viagem pode apropriar ponto pela janela do cronograma mesmo quando o colaborador
  // não consta em nenhum RDO da obra. Esses colaboradores também precisam aparecer no dashboard.
  for (const [collaboratorId, rate] of ratesById) {
    if (rate?.analyticalByProject?.[projectId] || rate?.byProject?.[projectId]) {
      ensureCollaborator(collaboratorId, { name: rate.name, role: rate.role });
    }
  }
  const colaboradores = [...collabMap.entries()]
    .filter(([collaboratorId]) => (
      confirmedReportParticipantIds.has(collaboratorId)
      || hasAllocatedHours(collaboratorId)
    ))
    .map(([, item]) => item)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  // --- Prazos / dias ---
  const plannedDays = toNum(row.plannedDays);
  const plannedWorkedDays = toNum(row.workedDays) ?? plannedDays;
  const today = new Date();

  // --- Equipamentos em obra (módulo Equipamentos), mesma lógica do card de projetos ---
  const projectReferenceDate = row.archived && lastRdoDate ? new Date(lastRdoDate) : today;
  const equipmentEndDate = projectReferenceDate;
  const equipamentos = (equipmentByProject.get(projectId) || [])
    .map(e => {
      const since = new Date(e.sinceDate);
      const days = Math.max(0, Math.round((equipmentEndDate.getTime() - since.getTime()) / 86400000));
      return { name: e.name, days, since: e.sinceDate };
    })
    .sort((a, b) => b.days - a.days);

  const elapsedCorridos = row.startDate ? Math.max(0, diffCalendarDays(row.startDate, projectReferenceDate) ?? 0) : null;
  const diasCorridos = {
    elapsed: elapsedCorridos,
    planned: plannedDays,
    pct: elapsedCorridos != null && plannedDays ? Math.round((elapsedCorridos / plannedDays) * 100) : null
  };
  const diasTrabalhados = {
    worked: workedDays,
    planned: plannedWorkedDays,
    pct: plannedWorkedDays ? Math.round((workedDays / plannedWorkedDays) * 100) : null
  };
  const plannedNormalHoursTotal = plannedNormalHours.reduce((sum, item) => sum + (toNum(item.hours) ?? 0), 0);
  const plannedOvertimeHoursTotal = plannedOvertime.reduce((sum, item) => sum + (toNum(item.hours) ?? 0), 0);
  const workedHours = buildWorkedHoursProgress({
    normalWorkedMinutes: normalWorkedMinutesTotal,
    overtimeWorkedMinutes: overtimeWorkedMinutesTotal,
    plannedNormalHours: plannedNormalHoursTotal,
    plannedOvertimeHours: plannedOvertimeHoursTotal
  });
  workedHours.roleCounts = buildPlannedRoleCounts(
    [...plannedNormalHours, ...plannedOvertime],
    collaborators,
    workedHours.plannedTotalHours ?? 0,
    reports
  );

  const expectedEndDate = row.startDate && plannedDays ? addCalendarDays(row.startDate, plannedDays) : null;
  const avancoPct = row.progressPct ?? null;
  const projectedEndByPace = (row.startDate && elapsedCorridos && elapsedCorridos > 0 && avancoPct && avancoPct > 0)
    ? addCalendarDays(row.startDate, elapsedCorridos * (100 / avancoPct))
    : null;
  const requiredWeeklyProgress = buildRequiredWeeklyProgress(projectProgress, {
    startDate: row.startDate,
    expectedEndDate,
    referenceDate: projectReferenceDate
  });

  const alerts = computeAlerts({
    startDate: row.startDate ?? null,
    plannedDays,
    gasto: gasto + (maoDeObra.custo ?? 0), // realizado total = compras Omie + mão de obra
    plannedCost: previstoCusto,
    lastRdoDate,
    lastDayStatus: ultimosDias.length ? ultimosDias[ultimosDias.length - 1].status : null,
    progressPct: avancoPct,
    now: projectReferenceDate
  });

  return {
    header: {
      code: row.code,
      clientName: row.clientName,
      clientCnpj: row.clientCnpj ?? null,
      proposalCode: row.proposalCode,
      lastRdoDate,
      segment: project?.clientSegment ?? null
    },
    alerts,
    diasCorridos,
    diasTrabalhados,
    consumo: {
      gasto,
      omie: omieGasto,
      pago: omiePayment.pago,
      previstoPagar: omiePayment.previstoPagar,
      estoque: stockCost.total,
      manual: manualCost.total,
      previsto: previstoCusto,
      previstoOriginal: toNum(row.originalPlannedTotalCost),
      previstoAdicional: toNum(row.additionalPlannedTotalCost),
      pct: previstoCusto && previstoCusto > 0 ? Math.round((gasto / previstoCusto) * 100) : null
    },
    faturamento: {
      previsto: row.salePrice ?? null,
      previstoOriginal: row.originalSalePrice ?? null,
      previstoAdicional: row.additionalSalePrice ?? null,
      realizado: row.invoicedRevenue ?? null,
      notas: row.invoiceCount ?? 0
    },
    budgetBreakdown: row.budgetBreakdown ?? null,
    presumedProfitTaxes: row.presumedProfitTaxes ?? null,
    maoDeObra,
    workedHours,
    maioresGastos,
    manualCosts: manualCost.entries,
    avancoPct,
    avancoMethod: row.progressMethod ?? null,
    progressHistory: progressHistoryByProject.get(projectId) ?? [],
    requiredWeeklyProgress,
    standby: { count: standbyCount, minutes: standbyMinutesTotal },
    ultimosDias,
    overtimeMinutes: overtimeMinutesTotal,
    colaboradores,
    equipamentos,
    footer: {
      mobilizationDate: project?.mobilizationDate ?? null,
      startDate: row.startDate ?? null,
      expectedEndDate,
      projectedEndByPace
    }
  };
}
