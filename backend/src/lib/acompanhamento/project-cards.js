/*
 * Aba "Projetos" do módulo Acompanhamento — um card por projeto com indicadores cruzando o previsto
 * (comercial + escopo manual) e o realizado (RDOs e relatórios de serviço independentes).
 * Reaproveita listCommercialDashboard como base
 * (mesmos projetos casados com proposta, já com plannedDays/workedDays/startDate/avanço) e enriquece
 * com agregações dos relatórios-fonte: dias trabalhados (datas distintas), horas normais/extra, colaboradores
 * distintos e status do último dia (trabalhado / parado por standby de jornada cheia).
 */

import { listCommercialDashboard } from './access-import.js';
import { computeAlerts } from './alerts.js';
import { isConfirmedReportParticipant, selectRealizedSourceReportData } from './avanco.js';
import { laborCostByProject } from './labor-cost.js';
import { getEquipmentUsageByProject } from './equipment-usage.js';
import { reportAllCollaboratorIds, reportPersonTimeMetrics } from './report-time.js';
import prisma from '../prisma.js';

function toNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// "HH:MM" ou minutos em texto/número -> minutos.
function parseMinutes(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const str = String(value).trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const parts = str.split(':');
  if (parts.length >= 2) return parseInt(parts[0], 10) * 60 + (parseInt(parts[1], 10) || 0);
  return 0;
}

function dateKey(date) {
  return date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
}

function addCalendarDays(startDate, days) {
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// Jornada cheia (min) da data do relatório: fim de semana usa weekendWorkdayHours.
function journeyMinutes(project, reportDate) {
  const day = new Date(reportDate).getUTCDay(); // 0=dom, 6=sáb
  const isWeekend = day === 0 || day === 6;
  const hours = isWeekend ? (project?.weekendWorkdayHours || project?.workdayHours) : project?.workdayHours;
  return parseMinutes(hours);
}

function toHours(minutes) {
  return Math.round((Math.max(0, minutes) / 60) * 10) / 10;
}

export function buildWorkedHoursProgress({
  normalWorkedMinutes = 0,
  overtimeWorkedMinutes = 0,
  plannedNormalHours = 0,
  plannedOvertimeHours = 0
} = {}) {
  const normalWorkedHours = toHours(normalWorkedMinutes);
  const overtimeWorkedHours = toHours(overtimeWorkedMinutes);
  const totalWorkedHours = Math.round((normalWorkedHours + overtimeWorkedHours) * 10) / 10;
  const plannedNormal = Math.max(0, toNum(plannedNormalHours) ?? 0);
  const plannedOvertime = Math.max(0, toNum(plannedOvertimeHours) ?? 0);
  const plannedTotalHours = plannedNormal + plannedOvertime;
  const hasPlan = plannedTotalHours > 0;

  return {
    normalWorkedHours,
    overtimeWorkedHours,
    totalWorkedHours,
    plannedNormalHours: plannedNormal,
    plannedOvertimeHours: plannedOvertime,
    plannedTotalHours: hasPlan ? plannedTotalHours : null,
    normalPct: hasPlan ? Math.round((normalWorkedHours / plannedTotalHours) * 100) : null,
    overtimePct: hasPlan ? Math.round((overtimeWorkedHours / plannedTotalHours) * 100) : null,
    totalPct: hasPlan ? Math.round((totalWorkedHours / plannedTotalHours) * 100) : null
  };
}

export const PROJECT_CARD_CATEGORIES = {
  IN_PROGRESS: 'ANDAMENTO',
  FUTURE: 'FUTURO',
  ARCHIVED: 'ARQUIVADO'
};

export function deriveProjectTrackingState({
  archivedInReports = false,
  archivedAt = null,
  reviewedAt = null
} = {}) {
  const archivedInAcompanhamento = Boolean(archivedAt);
  const archived = Boolean(archivedInReports) || archivedInAcompanhamento;
  return {
    archived,
    archivedInReports: Boolean(archivedInReports),
    archivedInAcompanhamento,
    reviewed: archived && Boolean(reviewedAt),
    reviewedAt: archived ? reviewedAt : null
  };
}

export function deriveProjectCardCategory({ archived = false, workedDays = 0, workedHours = null, progressPct = null } = {}) {
  if (archived) return PROJECT_CARD_CATEGORIES.ARCHIVED;

  const days = toNum(workedDays) ?? 0;
  const hours = toNum(workedHours?.totalWorkedHours) ?? 0;
  const progress = toNum(progressPct) ?? 0;

  return days <= 0 && hours <= 0 && progress <= 0
    ? PROJECT_CARD_CATEGORIES.FUTURE
    : PROJECT_CARD_CATEGORIES.IN_PROGRESS;
}

// Status do último relatório-fonte: parado quando houve standby cobrindo a jornada cheia; senão trabalhado.
export function lastDayStatus(lastReport, project) {
  if (!lastReport) return { date: null, status: 'SEM_RDO' };
  const sc = lastReport.specialConditions || {};
  let status = 'TRABALHADO';
  if (sc.standby === true) {
    const standbyMin = parseMinutes(sc.standbyDetails?.total);
    const journeyMin = journeyMinutes(project, lastReport.reportDate);
    if (standbyMin > 0 && journeyMin > 0 && standbyMin >= journeyMin) status = 'PARADO';
  }
  return { date: lastReport.reportDate, status };
}

// Cards da aba Projetos (previsto x realizado por projeto).
export async function listProjectCards({ includeAdminOnlyCategories = true } = {}) {
  const rows = await listCommercialDashboard({ includeAdminOnlyCategories });
  const projectIds = rows.map(r => r.projectId);
  if (projectIds.length === 0) return [];

  const [projects, queriedReports, queriedCollaborators, labor, plannedNormalHours, plannedOvertime] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, workdayHours: true, weekendWorkdayHours: true }
    }),
    prisma.report.findMany({
      where: { projectId: { in: projectIds }, deletedAt: null },
      select: {
        id: true,
        projectId: true,
        reportType: true,
        reportDate: true,
        specialConditions: true,
        daytimeCount: true,
        daytimeWorkedMinutes: true,
        nighttimeWorkedMinutes: true,
        daytimeOvertimeMinutes: true,
        nighttimeOvertimeMinutes: true,
        totalOvertimeMinutes: true
      },
      orderBy: { reportDate: 'asc' }
    }),
    prisma.reportCollaborator.findMany({
      where: { report: { projectId: { in: projectIds }, deletedAt: null } },
      select: { reportId: true, collaboratorId: true }
    }),
    laborCostByProject(), // custo de mão de obra (HH) do ponto vigente — separado do realizado Omie
    prisma.projectPlannedNormalHours.findMany({
      where: { projectId: { in: projectIds } },
      select: { projectId: true, hours: true }
    }),
    prisma.projectPlannedOvertime.findMany({
      where: { projectId: { in: projectIds } },
      select: { projectId: true, hours: true }
    })
  ]);
  const { reports, collaborators } = selectRealizedSourceReportData(queriedReports, queriedCollaborators);
  const laborByProject = labor.byProjectId;
  const hasAllocatedHours = (collaboratorId, projectId) => {
    const rate = labor.byCollaboratorId?.get(collaboratorId) || null;
    const allocation = rate?.analyticalByProject?.[projectId] || rate?.byProject?.[projectId] || null;
    return Math.max(0, toNum(allocation?.hours) ?? 0) > 0;
  };
  const equipmentByProject = await getEquipmentUsageByProject(projectIds);
  const now = new Date();

  const projById = new Map(projects.map(p => [p.id, p]));
  const dayCollaboratorIdsByReport = new Map();
  for (const c of collaborators) {
    if (!dayCollaboratorIdsByReport.has(c.reportId)) dayCollaboratorIdsByReport.set(c.reportId, []);
    dayCollaboratorIdsByReport.get(c.reportId).push(c.collaboratorId);
  }

  // Agrega por projeto: datas distintas de execução, colaboradores distintos e o último relatório-fonte.
  const agg = new Map();
  const ensure = (id) => {
    if (!agg.has(id)) {
      agg.set(id, {
        dates: new Set(),
        collabs: new Set(),
        lastReport: null,
        normalWorkedMinutes: 0,
        overtimeWorkedMinutes: 0
      });
    }
    return agg.get(id);
  };
  for (const r of reports) {
    const a = ensure(r.projectId);
    a.dates.add(dateKey(r.reportDate));
    if (!a.lastReport || new Date(r.reportDate) > new Date(a.lastReport.reportDate)) a.lastReport = r;
    const dayCollaboratorIds = dayCollaboratorIdsByReport.get(r.id) || [];
    const metrics = reportPersonTimeMetrics(r, dayCollaboratorIds);
    a.overtimeWorkedMinutes += metrics.overtimeWorkedMinutes;
    a.normalWorkedMinutes += metrics.normalWorkedMinutes;
    for (const collaboratorId of reportAllCollaboratorIds(r, dayCollaboratorIds)) {
      if (isConfirmedReportParticipant(r, hasAllocatedHours(collaboratorId, r.projectId))) {
        a.collabs.add(collaboratorId);
      }
    }
  }

  const sumHoursByProject = (items) => {
    const out = new Map();
    for (const item of items) {
      out.set(item.projectId, (out.get(item.projectId) || 0) + (toNum(item.hours) ?? 0));
    }
    return out;
  };
  const plannedNormalByProject = sumHoursByProject(plannedNormalHours);
  const plannedOvertimeByProject = sumHoursByProject(plannedOvertime);

  return rows.map(row => {
    const a = agg.get(row.projectId) || {
      dates: new Set(),
      collabs: new Set(),
      lastReport: null,
      normalWorkedMinutes: 0,
      overtimeWorkedMinutes: 0
    };
    const workedDays = a.dates.size;
    const totalDays = toNum(row.workedDays) ?? toNum(row.plannedDays);
    const daysConsumedPct = totalDays && totalDays > 0 ? Math.round((workedDays / totalDays) * 100) : null;
    const plannedDays = toNum(row.plannedDays);
    const expectedEndDate = row.startDate && plannedDays ? addCalendarDays(row.startDate, plannedDays) : null;
    const lastDay = lastDayStatus(a.lastReport, projById.get(row.projectId));
    const projectReferenceDate = row.archived && lastDay.date ? new Date(lastDay.date) : now;

    // Tempo de cada equipamento na obra: da saída até o "final do projeto"
    // (arquivado → último RDO; em andamento → hoje). Só equipamentos do módulo Equipamentos.
    const equipEndDate = projectReferenceDate;
    const equipment = (equipmentByProject.get(row.projectId) || [])
      .map(e => {
        const since = new Date(e.sinceDate);
        const days = Math.max(0, Math.round((equipEndDate.getTime() - since.getTime()) / 86400000));
        return { code: e.code, name: e.name, days, since: e.sinceDate };
      })
      .sort((x, y) => y.days - x.days);

    // Realizado total = compras Omie (sem salário) + consumo do estoque + mão de obra do ponto.
    const laborCost = laborByProject.get(row.projectId)?.laborCost ?? null;
    const stockCost = toNum(row.stockCost) ?? 0;
    const plannedCost = toNum(row.plannedTotalCost);
    const gastoTotal = (toNum(row.realizedCost) ?? 0) + (laborCost ?? 0);
    const costConsumedPct = plannedCost && plannedCost > 0 ? Math.round((gastoTotal / plannedCost) * 100) : null;
    const alerts = computeAlerts({
      startDate: row.startDate ?? null,
      plannedDays,
      gasto: gastoTotal,
      plannedCost,
      lastRdoDate: lastDay.date,
      lastDayStatus: lastDay.status,
      progressPct: row.progressPct ?? null,
      now: projectReferenceDate
    });
    const workedHours = buildWorkedHoursProgress({
      normalWorkedMinutes: a.normalWorkedMinutes,
      overtimeWorkedMinutes: a.overtimeWorkedMinutes,
      plannedNormalHours: plannedNormalByProject.get(row.projectId) || 0,
      plannedOvertimeHours: plannedOvertimeByProject.get(row.projectId) || 0
    });
    const trackingState = deriveProjectTrackingState({
      archivedInReports: row.archived,
      archivedAt: row.acompanhamentoArchivedAt,
      reviewedAt: row.acompanhamentoReviewedAt
    });
    const { archived } = trackingState;

    return {
      projectId: row.projectId,
      code: row.code,
      name: row.name,
      clientName: row.clientName,
      clientCnpj: row.clientCnpj ?? null,
      archived,
      ...trackingState,
      reportArchivedAt: trackingState.archivedInReports ? row.acompanhamentoReportArchivedAt ?? null : null,
      category: deriveProjectCardCategory({
        archived,
        workedDays,
        workedHours,
        progressPct: row.progressPct ?? null
      }),
      workedDays,
      totalDays,
      daysConsumedPct,
      workedHours,
      progressPct: row.progressPct ?? null,
      progressMethod: row.progressMethod ?? null,
      progressWeight: row.progressWeight ?? null,
      plannedCost,
      originalPlannedCost: toNum(row.originalPlannedTotalCost),
      additionalPlannedCost: toNum(row.additionalPlannedTotalCost),
      originalSalePrice: toNum(row.originalSalePrice),
      additionalSalePrice: toNum(row.additionalSalePrice),
      budgetBreakdown: row.budgetBreakdown ?? null,
      invoicedRevenue: row.invoicedRevenue ?? null,
      invoiceCount: row.invoiceCount ?? 0,
      presumedProfitTaxes: row.presumedProfitTaxes ?? null,
      realizedCost: gastoTotal,
      costConsumedPct,
      lastDay,
      collaboratorsCount: a.collabs.size,
      collaboratorIds: Array.from(a.collabs),
      startDate: row.startDate ?? null,
      expectedEndDate,
      // Custo de mão de obra (HH) do ponto vigente.
      // laborCost = com adicional offshore; laborCostBase = sem offshore (para comparação).
      laborCost,
      laborCostBase: laborByProject.get(row.projectId)?.laborCostBase ?? null,
      laborHours: laborByProject.get(row.projectId)?.hours ?? null,
      stockCost,
      manualCost: toNum(row.manualCost) ?? 0,
      equipment, // equipamentos (módulo Equipamentos) em obra: { code, name, days, since }
      alerts
    };
  });
}
