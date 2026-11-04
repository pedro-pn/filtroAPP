import prisma from '../../prisma.js';
import { formatCnpj } from '../../cnpj.js';
import { getAllocationTrailsForRange } from '../../acompanhamento/allocation-audit.js';
import { effectiveProjectsForDay, loadEffectiveAllocationIndex } from '../../acompanhamento/labor-cost.js';
import { loadCorporateCalendar } from '../../calendar/corporate-calendar.js';
import { isPontoTravelTag } from '../../pontomais/normalize.js';
import { SEDE_OMIE_CODES, SEDE_OPERATIONAL_CODES } from '../../acompanhamento/sede-cost-centers.js';
import { isCollaboratorActiveOn } from '../planning/capacity.js';
import { isAppAdmin } from '../access.js';
import { ABSENCE_ALERT_KINDS } from './schemas.js';
import { PENDING_REASON, sameAllocation, sourceFingerprint, suggestDay } from './suggestion.js';

/*
 * Read-model da conferência semanal de alocação (feature 037).
 * loadReviewWeekContext lê o banco; assembleReviewWeek é pura e monta a resposta do contrato.
 */

const DAY_MS = 86400000;
// Dias carregados antes e depois da semana: servem para achar o projeto de origem/destino de
// um dia "em viagem" nas bordas da semana.
export const NEIGHBOR_DAYS = 7;
const SEDE_CODES = new Set([...SEDE_OMIE_CODES, ...SEDE_OPERATIONAL_CODES]);
const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SYNTHETIC_TAGS = new Set(['Dia sem atividade/viagem']);
const SAO_PAULO_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});

export function saoPauloToday(now = new Date()) {
  return SAO_PAULO_DATE.format(now);
}

export function utcDate(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function dateKeyOf(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

export function weekDateKeys(weekStart) {
  const start = utcDate(weekStart).getTime();
  return Array.from({ length: 7 }, (_, index) => new Date(start + index * DAY_MS).toISOString().slice(0, 10));
}

// Segunda-feira da semana que contém a data.
export function mondayOf(dateKey) {
  const date = utcDate(dateKey);
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  return new Date(date.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}

function isWeekendKey(dateKey) {
  const day = utcDate(dateKey).getUTCDay();
  return day === 0 || day === 6;
}

function absenceCovers(absence, dateKey) {
  return dateKeyOf(absence.startDate) <= dateKey && dateKeyOf(absence.endDate) >= dateKey;
}

const ABSENCE_PRIORITY = ['FERIAS', 'AFASTAMENTO', 'FADIGA_OFFSHORE', 'ASO', 'TREINAMENTO', 'FOLGA'];

function absenceForDay(absences = [], dateKey) {
  const covering = absences.filter(item => absenceCovers(item, dateKey));
  covering.sort((a, b) => ABSENCE_PRIORITY.indexOf(a.type) - ABSENCE_PRIORITY.indexOf(b.type));
  return covering[0] || null;
}

function shiftKey(dateKey, days) {
  return new Date(utcDate(dateKey).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

// Etiquetas que apontam para um centro de custo da Sede (5000, 5002...) contam como Sede.
function pontoFromTrail(trail, sedeProjectIds = new Set()) {
  if (!trail) return null;
  const tags = (trail.tags || []).filter(tag => !SYNTHETIC_TAGS.has(tag));
  const total = (Number(trail.normalHours) || 0) + (Number(trail.he70Hours) || 0) + (Number(trail.he100Hours) || 0);
  if (total <= 0 && !tags.length) return null;
  const allTagProjects = trail.tagProjectIds || [];
  return {
    normalHours: Number(trail.normalHours) || 0,
    he70Hours: Number(trail.he70Hours) || 0,
    he100Hours: Number(trail.he100Hours) || 0,
    tags,
    tagProjectIds: allTagProjects.filter(id => !sedeProjectIds.has(id)),
    sedeTag: allTagProjects.some(id => sedeProjectIds.has(id)) || tags.some(tag => /\bsede\b/i.test(tag)),
    travel: tags.some(isPontoTravelTag)
  };
}

function savedValue(day) {
  if (!day) return null;
  return { kind: day.kind, projectIds: (day.projects || []).map(item => item.projectId).sort() };
}

function mostFrequentProject(days) {
  const counts = new Map();
  for (const day of days) {
    const value = day.value;
    if (!value || !['PROJECT', 'TRAVEL'].includes(value.kind)) continue;
    for (const projectId of value.projectIds) counts.set(projectId, (counts.get(projectId) || 0) + 1);
  }
  let best = null;
  for (const [projectId, count] of counts) {
    if (!best || count > best.count || (count === best.count && projectId < best.projectId)) best = { projectId, count };
  }
  return best?.projectId || null;
}

export async function loadReviewWeekContext({ weekStart, collaboratorIds = null }, deps = {}) {
  const database = deps.database || prisma;
  const getTrails = deps.getTrails || getAllocationTrailsForRange;
  const loadEffectiveIndex = deps.loadEffectiveIndex || loadEffectiveAllocationIndex;
  const loadCalendar = deps.loadCalendar || loadCorporateCalendar;
  const dates = weekDateKeys(weekStart);
  const from = dates[0];
  const to = dates[6];
  const fromDate = utcDate(from);
  const toDate = utcDate(to);
  const padFrom = shiftKey(from, -NEIGHBOR_DAYS);
  const padTo = shiftKey(to, NEIGHBOR_DAYS);
  const padFromDate = utcDate(padFrom);
  const padToDate = utcDate(padTo);
  const onlyIds = collaboratorIds ? { collaboratorId: { in: collaboratorIds } } : {};

  const [trails, reports, effectiveIndex, overrides, absences, calendar, savedWeek] = await Promise.all([
    getTrails({ from: padFrom, to: padTo }),
    database.report.findMany({
      where: { deletedAt: null, reportType: 'RDO', reportDate: { gte: padFromDate, lt: new Date(padToDate.getTime() + DAY_MS) } },
      select: {
        id: true,
        sequenceNumber: true,
        status: true,
        projectId: true,
        reportDate: true,
        collaborators: { select: { collaboratorId: true } }
      }
    }),
    loadEffectiveIndex(database),
    database.pontoDayProjectOverride.findMany({
      where: { workDate: { gte: padFromDate, lte: padToDate }, ...onlyIds },
      select: { collaboratorId: true, workDate: true, projectId: true }
    }),
    database.collaboratorAbsence.findMany({
      where: { deletedAt: null, startDate: { lte: toDate }, endDate: { gte: fromDate }, ...onlyIds },
      select: { id: true, collaboratorId: true, type: true, startDate: true, endDate: true }
    }),
    loadCalendar(database, from, to),
    database.allocationReviewWeek.findUnique({
      where: { weekStart: fromDate },
      include: { rows: { include: { days: { include: { projects: { select: { projectId: true } } } } } } }
    })
  ]);

  const inWeek = key => key >= from && key <= to;
  const extraIds = new Set();
  for (const [collaboratorId, days] of trails) {
    if ([...days.entries()].some(([key, trail]) => inWeek(key) && pontoFromTrail(trail))) extraIds.add(collaboratorId);
  }
  for (const report of reports) {
    if (!inWeek(dateKeyOf(report.reportDate))) continue;
    for (const link of report.collaborators) if (link.collaboratorId) extraIds.add(link.collaboratorId);
  }
  for (const row of savedWeek?.rows || []) extraIds.add(row.collaboratorId);

  const collaboratorWhere = collaboratorIds
    ? { id: { in: collaboratorIds } }
    : {
      OR: [
        {
          AND: [
            { jobRole: { isActive: true, isOperational: true } },
            { OR: [{ isActive: true }, { terminationDate: { gte: fromDate } }] },
            { OR: [{ admissionDate: null }, { admissionDate: { lte: toDate } }] }
          ]
        },
        { id: { in: [...extraIds] } }
      ]
    };
  const collaborators = await database.collaborator.findMany({
    where: collaboratorWhere,
    select: {
      id: true,
      name: true,
      isActive: true,
      admissionDate: true,
      terminationDate: true,
      jobRole: { select: { id: true, name: true } }
    },
    orderBy: { name: 'asc' }
  });

  const referencedProjectIds = new Set();
  for (const report of reports) referencedProjectIds.add(report.projectId);
  for (const days of trails.values()) for (const trail of days.values()) for (const id of trail.tagProjectIds || []) referencedProjectIds.add(id);
  for (const item of overrides) referencedProjectIds.add(item.projectId);
  for (const context of effectiveIndex.values()) for (const window of context.windows) {
    if (window.startKey <= padTo && window.endKey >= padFrom) referencedProjectIds.add(window.projectId);
  }
  for (const row of savedWeek?.rows || []) for (const day of row.days) for (const item of day.projects) referencedProjectIds.add(item.projectId);

  const closedByUserId = savedWeek?.closedByUserId || null;
  const [projects, closedBy] = await Promise.all([
    database.project.findMany({
      where: { OR: [{ id: { in: [...referencedProjectIds] } }, { isActive: true, deletedAt: null }] },
      select: { id: true, code: true, name: true, clientName: true, clientCnpj: true, isActive: true, deletedAt: true },
      orderBy: { code: 'asc' }
    }),
    closedByUserId
      ? database.user.findUnique({ where: { id: closedByUserId }, select: { id: true, name: true } })
      : null
  ]);

  return {
    weekStart: from,
    dates,
    sedeProjectIds: new Set(projects.filter(project => SEDE_CODES.has(String(project.code || '').trim())).map(project => project.id)),
    trails,
    reports,
    effectiveIndex,
    overrides,
    absences,
    holidays: calendar?.holidays || [],
    holidayDates: calendar?.holidayDates || new Set(),
    savedWeek,
    collaborators,
    projects,
    closedBy
  };
}

function indexesOf(context) {
  if (context.__indexes) return context.__indexes;
  const reportsByKey = new Map();
  for (const report of context.reports) {
    const date = dateKeyOf(report.reportDate);
    for (const link of report.collaborators) {
      const key = `${link.collaboratorId}|${date}`;
      const list = reportsByKey.get(key) || [];
      list.push({ reportId: report.id, number: report.sequenceNumber, projectId: report.projectId, status: report.status });
      reportsByKey.set(key, list);
    }
  }
  const manualByKey = new Map();
  for (const item of context.overrides) {
    const key = `${item.collaboratorId}|${dateKeyOf(item.workDate)}`;
    manualByKey.set(key, [...(manualByKey.get(key) || []), item.projectId]);
  }
  const savedByKey = new Map();
  for (const row of context.savedWeek?.rows || []) {
    for (const day of row.days || []) savedByKey.set(`${row.collaboratorId}|${dateKeyOf(day.workDate)}`, day);
  }
  const indexes = { reportsByKey, manualByKey, savedByKey };
  Object.defineProperty(context, '__indexes', { value: indexes, enumerable: false });
  return indexes;
}

// Projetos em que o colaborador comprovadamente esteve num dia (sem viagem): base dos vizinhos.
function projectEvidence(context, collaboratorId, dateKey) {
  const { reportsByKey, manualByKey, savedByKey } = indexesOf(context);
  const key = `${collaboratorId}|${dateKey}`;
  const saved = savedByKey.get(key);
  if (saved && ['PROJECT', 'TRAVEL'].includes(saved.kind)) return (saved.projects || []).map(item => item.projectId);
  if (saved) return [];
  const manual = manualByKey.get(key);
  if (manual?.length) return [...new Set(manual)];
  const rdo = (reportsByKey.get(key) || []).map(item => item.projectId);
  if (rdo.length) return [...new Set(rdo)];
  const ponto = pontoFromTrail(context.trails.get(collaboratorId)?.get(dateKey) || null, context.sedeProjectIds);
  if (ponto?.travel) return [];
  if (ponto?.tagProjectIds.length) return [...new Set(ponto.tagProjectIds)];
  if (ponto && ponto.normalHours + ponto.he70Hours + ponto.he100Hours > 0) {
    return effectiveProjectsForDay({ effectiveAllocationIndex: context.effectiveIndex, collaboratorId, dateKey });
  }
  return [];
}

function nearestProjects(context, collaboratorId, dateKey, direction) {
  for (let distance = 1; distance <= NEIGHBOR_DAYS; distance += 1) {
    const projectIds = projectEvidence(context, collaboratorId, shiftKey(dateKey, direction * distance))
      .filter(id => !context.sedeProjectIds?.has(id));
    if (projectIds.length) return { distance, projectIds: [...new Set(projectIds)].sort() };
  }
  return null;
}

// Entradas das fontes de um colaborador num dia (base da sugestão e do fingerprint).
export function dayInputs(context, collaboratorId, dateKey) {
  const { reportsByKey, manualByKey } = indexesOf(context);
  const key = `${collaboratorId}|${dateKey}`;
  const trail = context.trails.get(collaboratorId)?.get(dateKey) || null;
  const reports = reportsByKey.get(key) || [];
  const absence = absenceForDay(context.absences.filter(item => item.collaboratorId === collaboratorId), dateKey);
  const ponto = pontoFromTrail(trail, context.sedeProjectIds || new Set());
  return {
    trail,
    reports,
    input: {
      isWeekend: isWeekendKey(dateKey),
      isHoliday: context.holidayDates.has(dateKey),
      ponto,
      rdoProjectIds: reports.map(item => item.projectId),
      efetivoProjectIds: effectiveProjectsForDay({ effectiveAllocationIndex: context.effectiveIndex, collaboratorId, dateKey }),
      manualProjectIds: manualByKey.get(key) || [],
      absence: absence ? { type: absence.type, id: absence.id } : null,
      neighborProjects: ponto?.travel
        ? { before: nearestProjects(context, collaboratorId, dateKey, -1), after: nearestProjects(context, collaboratorId, dateKey, 1) }
        : null
    }
  };
}

export function sourceProjectIds(input) {
  return new Set([
    ...(input.rdoProjectIds || []),
    ...(input.efetivoProjectIds || []),
    ...(input.manualProjectIds || []),
    ...(input.ponto?.tagProjectIds || []),
    ...(input.neighborProjects?.before?.projectIds || []),
    ...(input.neighborProjects?.after?.projectIds || [])
  ]);
}

export function assembleReviewWeek(context, { now = new Date(), user = null } = {}) {
  const today = saoPauloToday(now);
  const weekEnded = context.dates[6] < today;
  const savedRows = new Map((context.savedWeek?.rows || []).map(row => [row.collaboratorId, row]));
  const holidayNames = new Map((context.holidays || []).map(item => [item.date, item.name]));

  const days = context.dates.map(date => {
    const weekday = utcDate(date).getUTCDay();
    return {
      date,
      weekday: WEEKDAY_LABELS[weekday],
      isWeekend: weekday === 0 || weekday === 6,
      isHoliday: context.holidayDates.has(date),
      holidayName: holidayNames.get(date) || null,
      isFuture: date > today
    };
  });

  const rows = context.collaborators.map(collaborator => {
    const savedRow = savedRows.get(collaborator.id) || null;
    const savedDays = new Map((savedRow?.days || []).map(day => [dateKeyOf(day.workDate), day]));
    const confirmed = Boolean(savedRow?.confirmedAt);
    const rowDays = days.map(dayMeta => {
      const eligible = isCollaboratorActiveOn(collaborator, dayMeta.date);
      const { reports, input } = dayInputs(context, collaborator.id, dayMeta.date);
      const result = suggestDay(input);
      const fingerprint = sourceFingerprint(input);
      const saved = savedDays.get(dayMeta.date) || null;
      const value = eligible ? (savedValue(saved) || result.suggestion) : null;
      const edited = Boolean(saved) && !sameAllocation(savedValue(saved), result.suggestion);
      const pending = eligible && !dayMeta.isFuture && !confirmed && !saved && result.pending;
      return {
        date: dayMeta.date,
        eligible,
        isFuture: dayMeta.isFuture,
        isWeekend: dayMeta.isWeekend,
        isHoliday: dayMeta.isHoliday,
        suggestion: result.suggestion,
        value,
        saved: Boolean(saved),
        edited,
        note: saved?.note || null,
        pending,
        pendingReason: pending ? result.pendingReason : null,
        reasons: result.reasons,
        sources: {
          ponto: {
            state: result.sources.ponto.state,
            normalHours: input.ponto?.normalHours || 0,
            he70Hours: input.ponto?.he70Hours || 0,
            he100Hours: input.ponto?.he100Hours || 0,
            tags: input.ponto?.tags || []
          },
          rdo: { state: result.sources.rdo.state, reports },
          efetivo: { state: result.sources.efetivo.state, projectIds: input.efetivoProjectIds },
          manualProjectIds: input.manualProjectIds,
          absence: input.absence ? { type: input.absence.type, absenceId: input.absence.id } : null
        },
        candidateProjectIds: [...sourceProjectIds(input)].sort(),
        sourceFingerprint: fingerprint,
        sourceChangedAfterReview: confirmed && Boolean(saved?.sourceFingerprint) && saved.sourceFingerprint !== fingerprint,
        absenceAlert: Boolean(value) && ABSENCE_ALERT_KINDS.has(value.kind) && !input.absence
          && !sameAllocation(value, result.suggestion)
      };
    });
    const pendingCount = rowDays.filter(day => day.pending).length;
    const hasFutureEligible = rowDays.some(day => day.eligible && day.isFuture);
    return {
      collaborator: { id: collaborator.id, name: collaborator.name, jobRole: collaborator.jobRole?.name || null },
      mainProjectId: mostFrequentProject(rowDays),
      confirmed,
      confirmedAt: savedRow?.confirmedAt || null,
      confirmedByUserId: savedRow?.confirmedByUserId || null,
      pendingCount,
      canConfirm: !confirmed && pendingCount === 0 && !hasFutureEligible && rowDays.some(day => day.eligible),
      days: rowDays
    };
  }).filter(row => row.days.some(day => day.eligible));

  const summary = { agreeDays: 0, divergenceDays: 0, noInformationDays: 0, editedDays: 0, confirmedRows: 0, totalRows: rows.length, readyRows: 0 };
  for (const row of rows) {
    if (row.confirmed) summary.confirmedRows += 1;
    if (row.canConfirm) summary.readyRows += 1;
    for (const day of row.days) {
      if (!day.eligible || day.isFuture) continue;
      if (day.edited) summary.editedDays += 1;
      if (day.pendingReason === PENDING_REASON.NO_INFORMATION) summary.noInformationDays += 1;
      else if (day.pending) summary.divergenceDays += 1;
      else summary.agreeDays += 1;
    }
  }

  const status = context.savedWeek?.status || 'OPEN';
  const closeBlockers = [];
  if (status === 'OPEN') {
    if (!weekEnded) closeBlockers.push('A semana só pode ser fechada depois do domingo.');
    const missing = rows.length - summary.confirmedRows;
    if (missing > 0) closeBlockers.push(`Faltam ${missing} colaborador${missing > 1 ? 'es' : ''} para conferir.`);
    if (!rows.length) closeBlockers.push('Não há colaboradores nesta semana.');
  }

  return {
    week: {
      weekStart: context.dates[0],
      weekEnd: context.dates[6],
      status,
      version: context.savedWeek?.version || 0,
      closedAt: context.savedWeek?.closedAt || null,
      closedBy: context.closedBy || null,
      ended: weekEnded,
      canClose: status === 'OPEN' && closeBlockers.length === 0,
      closeBlockers,
      canReopen: status === 'CLOSED' && isAppAdmin(user)
    },
    days,
    summary,
    rows,
    projects: context.projects.map(project => ({
      id: project.id,
      code: project.code,
      name: project.name,
      clientName: project.clientName || null,
      clientCnpj: project.clientCnpj ? formatCnpj(project.clientCnpj) : null,
      isActive: Boolean(project.isActive) && !project.deletedAt
    }))
  };
}

export async function getReviewWeek({ weekStart, now = new Date(), user = null }, deps = {}) {
  const context = await loadReviewWeekContext({ weekStart }, deps);
  return assembleReviewWeek(context, { now, user });
}

// Contagem para o badge: semanas já encerradas, desde a primeira semana com conferência registrada
// (no máximo 8 para trás), que ainda não foram fechadas. Antes da primeira conferência, só a última
// semana encerrada conta, para a implantação não acusar semanas antigas.
export async function getReviewPendingCount({ now = new Date() } = {}, deps = {}) {
  const database = deps.database || prisma;
  const today = saoPauloToday(now);
  const lastEndedMonday = mondayOf(new Date(utcDate(today).getTime() - 7 * DAY_MS).toISOString().slice(0, 10));
  const [first, absenceAlertsOpen] = await Promise.all([
    database.allocationReviewWeek.findFirst({ orderBy: { weekStart: 'asc' }, select: { weekStart: true } }),
    database.allocationReviewAbsenceAlert.count({ where: { status: 'OPEN' } })
  ]);
  const earliest = first ? dateKeyOf(first.weekStart) : lastEndedMonday;
  const mondays = [];
  for (let index = 0; index < 8; index += 1) {
    const monday = new Date(utcDate(lastEndedMonday).getTime() - index * 7 * DAY_MS).toISOString().slice(0, 10);
    if (monday < earliest) break;
    mondays.push(monday);
  }
  const closed = mondays.length
    ? await database.allocationReviewWeek.findMany({
      where: { weekStart: { in: mondays.map(utcDate) }, status: 'CLOSED' },
      select: { weekStart: true }
    })
    : [];
  const closedSet = new Set(closed.map(item => dateKeyOf(item.weekStart)));
  return {
    openWeeks: mondays.filter(monday => !closedSet.has(monday)).map(weekStart => ({ weekStart })),
    absenceAlertsOpen
  };
}

/*
 * Visão do mês inteiro: junta as semanas (seg–dom) que tocam o mês e devolve só os dias do mês.
 * As semanas são montadas em sequência para aproveitar o cache das trilhas do ponto.
 */
export async function getReviewMonth({ yearMonth, now = new Date(), user = null }, deps = {}) {
  const [year, month] = yearMonth.split('-').map(Number);
  const first = `${yearMonth}-01`;
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const weekStarts = [];
  for (let monday = mondayOf(first); monday <= last; monday = shiftKey(monday, 7)) weekStarts.push(monday);

  const weeks = [];
  for (const weekStart of weekStarts) {
    weeks.push(await getReviewWeek({ weekStart, now, user }, deps));
  }
  const inMonth = date => date >= first && date <= last;
  const days = weeks.flatMap(week => week.days).filter(day => inMonth(day.date));
  const projectsById = new Map();
  for (const week of weeks) for (const project of week.projects) projectsById.set(project.id, project);

  const rowsById = new Map();
  for (const week of weeks) {
    for (const row of week.rows) {
      let entry = rowsById.get(row.collaborator.id);
      if (!entry) {
        entry = { collaborator: row.collaborator, days: new Map(), pendingCount: 0 };
        rowsById.set(row.collaborator.id, entry);
      }
      for (const day of row.days) {
        if (!inMonth(day.date)) continue;
        entry.days.set(day.date, {
          date: day.date,
          eligible: day.eligible,
          isFuture: day.isFuture,
          value: day.value,
          pending: day.pending,
          pendingReason: day.pendingReason,
          edited: day.edited,
          confirmed: row.confirmed,
          weekStart: week.week.weekStart
        });
        if (day.pending) entry.pendingCount += 1;
      }
    }
  }

  const rows = [...rowsById.values()].map(entry => {
    const totals = new Map();
    const monthDays = days.map(meta => entry.days.get(meta.date) || {
      date: meta.date, eligible: false, isFuture: meta.isFuture, value: null, pending: false,
      pendingReason: null, edited: false, confirmed: false, weekStart: mondayOf(meta.date)
    });
    for (const day of monthDays) {
      if (!day.eligible || !day.value || day.isFuture) continue;
      const keys = ['PROJECT', 'TRAVEL'].includes(day.value.kind)
        ? day.value.projectIds.map(id => `P:${id}`)
        : [`K:${day.value.kind}`];
      const share = 1 / Math.max(1, keys.length);
      for (const key of keys) totals.set(key, (totals.get(key) || 0) + share);
    }
    return {
      collaborator: entry.collaborator,
      pendingCount: entry.pendingCount,
      totals: [...totals.entries()]
        .map(([key, count]) => (key.startsWith('P:')
          ? { kind: 'PROJECT', projectId: key.slice(2), days: Math.round(count * 10) / 10 }
          : { kind: key.slice(2), projectId: null, days: Math.round(count * 10) / 10 }))
        .sort((a, b) => b.days - a.days),
      days: monthDays
    };
  }).sort((a, b) => a.collaborator.name.localeCompare(b.collaborator.name, 'pt-BR'));

  return {
    month: { yearMonth, first, last },
    weeks: weeks.map(week => ({
      weekStart: week.week.weekStart,
      weekEnd: week.week.weekEnd,
      status: week.week.status,
      ended: week.week.ended,
      confirmedRows: week.summary.confirmedRows,
      totalRows: week.summary.totalRows,
      pendingDays: week.summary.divergenceDays + week.summary.noInformationDays
    })),
    days,
    rows,
    projects: [...projectsById.values()]
  };
}
