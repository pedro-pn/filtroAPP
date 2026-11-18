import prisma from '../prisma.js';
import { mergePontoPeriods, rdoDataByCollaboratorFromReports } from './labor-cost.js';

// 176 HH mensais × 11 meses produtivos ÷ 12 meses do ano.
export const HH_PRODUTIVAS_REF = 161;

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dateFromKey(key) {
  return new Date(`${key}T00:00:00.000Z`);
}

function addDaysKey(key, days) {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function yearBounds(year) {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    endExclusive: new Date(Date.UTC(year + 1, 0, 1))
  };
}

function monthKeysForYear(year) {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
}

export function normalizeRoleName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function buildJobRoleLookup(jobRoles = []) {
  const byId = new Map();
  const byName = new Map();
  for (const role of jobRoles) {
    if (!role) continue;
    if (role.id) byId.set(role.id, role);
    const normalized = normalizeRoleName(role.name);
    if (normalized) byName.set(normalized, role);
  }
  return { byId, byName };
}

export function resolveOperationalStatus(collaborator, jobRoles = [], lookup = buildJobRoleLookup(jobRoles)) {
  const directJobRoleId = collaborator?.jobRoleId || collaborator?.costProfile?.jobRoleId || null;
  if (directJobRoleId && lookup.byId.has(directJobRoleId)) {
    const role = lookup.byId.get(directJobRoleId);
    return { isOperational: role.isOperational !== false, source: 'jobRoleId', jobRole: role };
  }

  const roleName = normalizeRoleName(collaborator?.role);
  if (roleName && lookup.byName.has(roleName)) {
    const role = lookup.byName.get(roleName);
    return { isOperational: role.isOperational !== false, source: 'roleName', jobRole: role };
  }

  return { isOperational: true, source: 'fallback', jobRole: null };
}

function monthlyData(monthly, monthKey) {
  const raw = monthly && typeof monthly === 'object' && !Array.isArray(monthly) ? monthly[monthKey] : null;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function monthWorkedDates(monthData) {
  if (Array.isArray(monthData.workedDates)) return monthData.workedDates.map(String).filter(Boolean);
  if (Array.isArray(monthData.days)) {
    return monthData.days
      .filter(day => day?.date && numberValue(day.workedMinutes) > 0)
      .map(day => String(day.date));
  }
  return [];
}

function activeMonth(monthData) {
  return numberValue(monthData.normalMinutes) > 0 || monthWorkedDates(monthData).length > 0;
}

function workedDatesFromMonthly(year, monthly) {
  const dates = new Set();
  for (const monthKey of monthKeysForYear(year)) {
    for (const date of monthWorkedDates(monthlyData(monthly, monthKey))) {
      if (date.startsWith(`${year}-`)) dates.add(date);
    }
  }
  return [...dates].sort();
}

function projectLabel(project) {
  const code = String(project?.code || '').trim();
  const name = String(project?.name || '').trim();
  if (code && name) return `${code} - ${name}`;
  return name || code || '';
}

function projectLabelsFromReports(reports = []) {
  const labels = new Map();
  for (const report of reports) {
    const label = projectLabel(report.project) || report.projectId;
    if (report.projectId && label) labels.set(report.projectId, label);
  }
  return labels;
}

function dayProjectMap(rdoEntry) {
  if (rdoEntry instanceof Map) return rdoEntry;
  if (rdoEntry?.dayProject instanceof Map) return rdoEntry.dayProject;
  return new Map();
}

export function classifyAllocationDay(date, workedDates, rdoEntry, projectLabels = new Map()) {
  const hasPoint = workedDates instanceof Set ? workedDates.has(date) : (workedDates || []).includes(date);
  if (!hasPoint) {
    return { date, situacao: 'folga', projectId: null, projeto: null, disponivel: false };
  }

  const project = dayProjectMap(rdoEntry).get(date);
  if (project?.projectId) {
    return {
      date,
      situacao: 'alocado',
      projectId: project.projectId,
      projeto: projectLabels.get(project.projectId) || project.projectId,
      disponivel: false
    };
  }

  return { date, situacao: 'sede', projectId: null, projeto: 'Sede', disponivel: true };
}

function sameAllocation(left, right) {
  return left.situacao === right.situacao && (left.projectId || '') === (right.projectId || '');
}

export function buildCollaboratorAllocation({ year, monthly = {}, rdoEntry = null, projectLabels = new Map() }) {
  const workedDates = workedDatesFromMonthly(year, monthly);
  const workedDateSet = new Set(workedDates);
  if (!workedDates.length) {
    return { situacaoAtual: 'folga', projetoAtual: null, disponivel: false, periodos: [] };
  }

  const days = workedDates.map(date => classifyAllocationDay(date, workedDateSet, rdoEntry, projectLabels));
  const periodos = [];
  for (const day of days) {
    const current = periodos[periodos.length - 1];
    if (current && sameAllocation(current, day) && addDaysKey(current.fim, 1) === day.date) {
      current.fim = day.date;
      current.dias += 1;
      continue;
    }

    periodos.push({
      situacao: day.situacao,
      projectId: day.projectId,
      projeto: day.projeto || (day.situacao === 'sede' ? 'Sede' : null),
      inicio: day.date,
      fim: day.date,
      dias: 1
    });
  }

  const current = days[days.length - 1];
  return {
    situacaoAtual: current.situacao,
    projetoAtual: current.situacao === 'alocado' ? current.projeto : null,
    disponivel: current.situacao === 'sede',
    periodos
  };
}

function productivityForPeriod({ period, year, lookup, projectLabels, rdoEntry }) {
  const collaborator = period.collaborator || {
    id: period.collaboratorId,
    code: period.collaboratorId,
    name: period.rawName,
    role: ''
  };
  const monthly = period.monthly && typeof period.monthly === 'object' && !Array.isArray(period.monthly)
    ? period.monthly
    : {};
  const porMes = monthKeysForYear(year).map(mes => {
    const month = monthlyData(monthly, mes);
    const hhProdutivas = numberValue(month.normalMinutes) / 60;
    return { mes, hhProdutivas, acimaDaRef: hhProdutivas >= HH_PRODUTIVAS_REF };
  });
  const mesesAtivos = monthKeysForYear(year).filter(mes => activeMonth(monthlyData(monthly, mes))).length;
  const totalHHprodutivas = porMes.reduce((sum, item) => sum + item.hhProdutivas, 0);
  const mediaMensal = mesesAtivos > 0 ? totalHHprodutivas / mesesAtivos : null;
  const taxaIndividual = mediaMensal == null
    ? null
    : Math.max(0, (HH_PRODUTIVAS_REF - mediaMensal) / HH_PRODUTIVAS_REF);
  const operational = resolveOperationalStatus(collaborator, [], lookup);

  return {
    collaboratorId: collaborator.id || period.collaboratorId,
    code: collaborator.code || period.collaboratorId || '',
    name: collaborator.name || period.rawName || '',
    role: collaborator.role || '',
    isOperational: operational.isOperational,
    totalHHprodutivas,
    mesesAtivos,
    mediaMensal,
    taxaIndividual,
    porMes,
    alocacao: buildCollaboratorAllocation({ year, monthly, rdoEntry, projectLabels })
  };
}

function normalizeSearch(value) {
  return normalizeRoleName(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function filterRows(rows, filters = {}) {
  const q = normalizeSearch(filters.q || '');
  return rows.filter(row => {
    if (filters.disponivel === true && !row.alocacao.disponivel) return false;
    if (!q) return true;
    return normalizeSearch(`${row.code} ${row.name} ${row.role}`).includes(q);
  });
}

export function buildCollaboratorProductivityReport({ year, pontoPeriods = [], jobRoles = [], reports = [], filters = {} }) {
  const lookup = buildJobRoleLookup(jobRoles);
  const projectLabels = projectLabelsFromReports(reports);
  const rdoByCollaborator = rdoDataByCollaboratorFromReports(reports);
  const rows = mergePontoPeriods(pontoPeriods)
    .map(period => productivityForPeriod({
      period,
      year,
      lookup,
      projectLabels,
      rdoEntry: rdoByCollaborator.get(period.collaboratorId)
    }))
    .filter(row => row.isOperational && row.mesesAtivos > 0)
    .sort((left, right) => {
      const byTaxa = numberValue(right.taxaIndividual) - numberValue(left.taxaIndividual);
      if (byTaxa !== 0) return byTaxa;
      return left.name.localeCompare(right.name, 'pt-BR');
    });

  const taxaRows = rows.filter(row => row.taxaIndividual != null);
  const taxaGeral = taxaRows.length
    ? taxaRows.reduce((sum, row) => sum + numberValue(row.taxaIndividual), 0) / taxaRows.length
    : null;

  return {
    year,
    refMensal: HH_PRODUTIVAS_REF,
    taxaGeral,
    colaboradores: filterRows(rows, filters)
  };
}

export async function getCollaboratorProductivityReport({ year, q, disponivel } = {}) {
  const targetYear = Number.isInteger(year) ? year : new Date().getFullYear();
  const { start, endExclusive } = yearBounds(targetYear);
  const [pontoPeriods, jobRoles, reports] = await Promise.all([
    prisma.pontoPeriodSummary.findMany({
      where: {
        collaboratorId: { not: null },
        periodStart: { lt: endExclusive },
        periodEnd: { gte: start }
      },
      include: {
        import: { select: { createdAt: true } },
        collaborator: { select: { id: true, code: true, name: true, role: true, isActive: true } }
      }
    }),
    prisma.jobRole.findMany(),
    prisma.report.findMany({
      where: {
        deletedAt: null,
        reportDate: { gte: start, lt: endExclusive },
        OR: [
          { reportType: 'RDO' },
          { daytimeWorkedMinutes: { gt: 0 } },
          { nighttimeWorkedMinutes: { gt: 0 } },
          { services: { some: { startTime: { not: null }, endTime: { not: null } } } }
        ]
      },
      select: {
        reportType: true,
        projectId: true,
        reportDate: true,
        daytimeWorkedMinutes: true,
        nighttimeWorkedMinutes: true,
        project: {
          select: {
            code: true,
            name: true,
            offshore: true,
            laborSleepModeByCollaborator: true
          }
        },
        collaborators: { select: { collaboratorId: true } },
        services: { select: { startTime: true, endTime: true } }
      }
    })
  ]);

  return buildCollaboratorProductivityReport({
    year: targetYear,
    pontoPeriods,
    jobRoles,
    reports,
    filters: { q, disponivel }
  });
}
