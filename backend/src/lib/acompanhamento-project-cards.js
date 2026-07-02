/*
 * Aba "Projetos" do módulo Acompanhamento — um card por projeto com indicadores cruzando o previsto
 * (comercial + escopo manual) e o realizado (RDOs). Reaproveita listCommercialDashboard como base
 * (mesmos projetos casados com proposta, já com plannedDays/workedDays/startDate/avanço) e enriquece
 * com agregações dos RDOs: dias trabalhados (datas distintas), colaboradores distintos e status do
 * último dia (trabalhado / parado por standby de jornada cheia).
 */

import { listCommercialDashboard } from './acompanhamento-access-import.js';
import prisma from './prisma.js';

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

// Status do último RDO: parado quando houve standby cobrindo a jornada cheia; senão trabalhado.
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
export async function listProjectCards() {
  const rows = await listCommercialDashboard();
  const projectIds = rows.map(r => r.projectId);
  if (projectIds.length === 0) return [];

  const [projects, reports, collaborators] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, workdayHours: true, weekendWorkdayHours: true }
    }),
    prisma.report.findMany({
      where: { projectId: { in: projectIds }, reportType: 'RDO', deletedAt: null },
      select: { projectId: true, reportDate: true, specialConditions: true },
      orderBy: { reportDate: 'asc' }
    }),
    prisma.reportCollaborator.findMany({
      where: { report: { projectId: { in: projectIds }, reportType: 'RDO', deletedAt: null } },
      select: { collaboratorId: true, report: { select: { projectId: true } } }
    })
  ]);

  const projById = new Map(projects.map(p => [p.id, p]));

  // Agrega por projeto: datas distintas de RDO, colaboradores distintos e o último RDO.
  const agg = new Map();
  const ensure = (id) => {
    if (!agg.has(id)) agg.set(id, { dates: new Set(), collabs: new Set(), lastReport: null });
    return agg.get(id);
  };
  for (const r of reports) {
    const a = ensure(r.projectId);
    a.dates.add(dateKey(r.reportDate));
    if (!a.lastReport || new Date(r.reportDate) > new Date(a.lastReport.reportDate)) a.lastReport = r;
  }
  for (const c of collaborators) {
    if (c.report?.projectId) ensure(c.report.projectId).collabs.add(c.collaboratorId);
  }

  return rows.map(row => {
    const a = agg.get(row.projectId) || { dates: new Set(), collabs: new Set(), lastReport: null };
    const workedDays = a.dates.size;
    const totalDays = toNum(row.workedDays) ?? toNum(row.plannedDays);
    const daysConsumedPct = totalDays && totalDays > 0 ? Math.round((workedDays / totalDays) * 100) : null;
    const plannedDays = toNum(row.plannedDays);
    const expectedEndDate = row.startDate && plannedDays ? addCalendarDays(row.startDate, plannedDays) : null;

    return {
      projectId: row.projectId,
      code: row.code,
      name: row.name,
      clientName: row.clientName,
      workedDays,
      totalDays,
      daysConsumedPct,
      progressPct: row.progressPct ?? null,
      lastDay: lastDayStatus(a.lastReport, projById.get(row.projectId)),
      collaboratorsCount: a.collabs.size,
      startDate: row.startDate ?? null,
      expectedEndDate
    };
  });
}
