/*
 * Dashboard de um projeto (módulo Acompanhamento). Cruza previsto (comercial + escopo manual) com o
 * realizado dos RDOs e das compras do Omie, para a tela de detalhe aberta ao clicar num card.
 *
 * Regras do cliente:
 *  - Gasto = TOTAL (pago + a pagar) dos títulos do Omie do projeto.
 *  - Excluir custos de salário/mão de obra (serão calculados no app via VR): filtramos categorias
 *    cuja descrição contém palavras-chave de folha (salário, INSS, FGTS, férias, 13º, rescisão...).
 *  - Standby cobrindo a jornada cheia do dia = dia "parado".
 */

import { listCommercialDashboard } from './acompanhamento-access-import.js';
import prisma from './prisma.js';

// Palavras-chave (sem acento, minúsculas) que marcam uma categoria como salário/mão de obra.
const SALARY_KEYWORDS = [
  'salario', 'folha', 'pro-labore', 'prolabore', 'pro labore', 'inss', 'fgts',
  'ferias', 'rescisao', 'adiantamento', 'decimo terceiro', '13o salario', 'vale transporte',
  'vale alimentacao', 'vale refeicao'
];

function normalize(text) {
  return String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function isSalaryCategory(descricao) {
  const key = normalize(descricao);
  return SALARY_KEYWORDS.some(word => key.includes(word));
}

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

// Status do dia a partir do standby agregado vs jornada cheia.
function dayStatus(standbyMin, journeyMin) {
  if (standbyMin > 0 && journeyMin > 0 && standbyMin >= journeyMin) return 'PARADO';
  if (standbyMin > 0) return 'STANDBY';
  return 'TRABALHADO';
}

export async function getProjectDetail(projectId) {
  const rows = await listCommercialDashboard();
  const row = rows.find(r => r.projectId === projectId);
  if (!row) throw new Error('Projeto não encontrado no acompanhamento comercial.');

  const [project, reports, collaborators, costGroups] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { clientSegment: true, mobilizationDate: true, workdayHours: true, weekendWorkdayHours: true }
    }),
    prisma.report.findMany({
      where: { projectId, reportType: 'RDO', deletedAt: null },
      select: {
        reportDate: true, specialConditions: true, totalOvertimeMinutes: true,
        daytimeWorkedMinutes: true, nighttimeWorkedMinutes: true
      },
      orderBy: { reportDate: 'asc' }
    }),
    prisma.reportCollaborator.findMany({
      where: { report: { projectId, reportType: 'RDO', deletedAt: null } },
      select: { collaboratorId: true, collaborator: { select: { name: true, role: true } } }
    }),
    prisma.omiePurchase.groupBy({
      by: ['categoriaCodigo', 'categoriaDescricao'],
      where: { projectId },
      _sum: { valor: true }
    })
  ]);

  // --- Custos (Omie), excluindo salários ---
  const nonSalary = costGroups
    .filter(g => !isSalaryCategory(g.categoriaDescricao || g.categoriaCodigo))
    .map(g => ({
      categoria: g.categoriaDescricao || g.categoriaCodigo || 'Sem categoria',
      total: toNum(g._sum.valor) ?? 0
    }))
    .filter(g => g.total > 0)
    .sort((a, b) => b.total - a.total);
  const gasto = nonSalary.reduce((sum, g) => sum + g.total, 0);
  const previstoCusto = toNum(row.plannedTotalCost);
  const maioresGastos = nonSalary.slice(0, 5);

  // --- Agregação dos RDOs (por dia) ---
  const byDay = new Map(); // dateKey -> { standbyMin, workedMin, overtimeMin, reportDate }
  let standbyCount = 0;
  let standbyMinutesTotal = 0;
  let overtimeMinutesTotal = 0;
  let lastRdoDate = null;

  for (const r of reports) {
    const key = dateKey(r.reportDate);
    if (!lastRdoDate || new Date(r.reportDate) > new Date(lastRdoDate)) lastRdoDate = r.reportDate;
    const sc = r.specialConditions || {};
    const standbyMin = sc.standby === true ? parseMinutes(sc.standbyDetails?.total) : 0;
    if (sc.standby === true) standbyCount += 1;
    standbyMinutesTotal += standbyMin;
    overtimeMinutesTotal += r.totalOvertimeMinutes || 0;

    const acc = byDay.get(key) || { standbyMin: 0, workedMin: 0, overtimeMin: 0, reportDate: r.reportDate };
    acc.standbyMin += standbyMin;
    acc.workedMin += (r.daytimeWorkedMinutes || 0) + (r.nighttimeWorkedMinutes || 0);
    acc.overtimeMin += r.totalOvertimeMinutes || 0;
    byDay.set(key, acc);
  }

  const workedDays = byDay.size;

  // Últimos 5 dias (cronológico) com status para a régua de bolinhas.
  const ultimosDias = [...byDay.entries()]
    .sort((a, b) => new Date(a[1].reportDate) - new Date(b[1].reportDate))
    .slice(-5)
    .map(([key, d]) => ({
      date: key,
      status: dayStatus(d.standbyMin, journeyMinutes(project, d.reportDate)),
      workedMinutes: d.workedMin,
      standbyMinutes: d.standbyMin
    }));

  // --- Colaboradores distintos (nome + cargo) ---
  const collabMap = new Map();
  for (const c of collaborators) {
    if (!collabMap.has(c.collaboratorId)) {
      collabMap.set(c.collaboratorId, { name: c.collaborator?.name || '—', role: c.collaborator?.role || '—' });
    }
  }
  const colaboradores = [...collabMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  // --- Prazos / dias ---
  const plannedDays = toNum(row.plannedDays);
  const plannedWorkedDays = toNum(row.workedDays) ?? plannedDays;
  const today = new Date();

  const elapsedCorridos = row.startDate ? Math.max(0, diffCalendarDays(row.startDate, today) ?? 0) : null;
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

  const expectedEndDate = row.startDate && plannedDays ? addCalendarDays(row.startDate, plannedDays) : null;
  const avancoPct = row.progressPct ?? null;
  const projectedEndByPace = (row.startDate && elapsedCorridos && elapsedCorridos > 0 && avancoPct && avancoPct > 0)
    ? addCalendarDays(row.startDate, elapsedCorridos * (100 / avancoPct))
    : null;

  return {
    header: {
      code: row.code,
      clientName: row.clientName,
      proposalCode: row.proposalCode,
      lastRdoDate,
      segment: project?.clientSegment ?? null
    },
    diasCorridos,
    diasTrabalhados,
    consumo: {
      gasto,
      previsto: previstoCusto,
      pct: previstoCusto && previstoCusto > 0 ? Math.round((gasto / previstoCusto) * 100) : null
    },
    maioresGastos,
    avancoPct,
    standby: { count: standbyCount, minutes: standbyMinutesTotal },
    ultimosDias,
    overtimeMinutes: overtimeMinutesTotal,
    colaboradores,
    footer: {
      mobilizationDate: project?.mobilizationDate ?? null,
      startDate: row.startDate ?? null,
      expectedEndDate,
      projectedEndByPace
    }
  };
}
