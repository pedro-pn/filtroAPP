import { absenceMonths } from './absences.js';

const MINUTES_PER_HOUR = 60;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dateKey(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function monthEntries(monthly) {
  if (!monthly || typeof monthly !== 'object' || Array.isArray(monthly)) return [];
  const source = monthly.schemaVersion === 2 && monthly.months && typeof monthly.months === 'object'
    ? monthly.months
    : monthly;
  return Object.entries(source).filter(([month]) => /^\d{4}-\d{2}$/.test(month));
}

function monthMinutes(month = {}) {
  const days = Array.isArray(month.days) ? month.days : [];
  const normalMinutes = Number.isFinite(Number(month.normalMinutes))
    ? finiteNumber(month.normalMinutes)
    : days.reduce((total, day) => total + finiteNumber(day.workedMinutes), 0);
  let extrasMinutes;
  if (Number.isFinite(Number(month.extrasMinutes))) {
    extrasMinutes = finiteNumber(month.extrasMinutes);
  } else {
    extrasMinutes = days.reduce((total, day) => {
      if (Number.isFinite(Number(day.extrasMinutes))) return total + finiteNumber(day.extrasMinutes);
      return total
        + finiteNumber(day.genericOvertimeMinutes)
        + finiteNumber(day.he70Minutes)
        + finiteNumber(day.he100Minutes);
    }, 0);
  }
  return { normalMinutes, extrasMinutes };
}

export function buildMonthlyProductiveHours(periods = []) {
  const byCollaborator = new Map();
  for (const period of periods) {
    const collaboratorId = String(period?.collaboratorId || '').trim();
    if (!collaboratorId) continue;
    let collaboratorMonths = byCollaborator.get(collaboratorId);
    if (!collaboratorMonths) {
      collaboratorMonths = new Map();
      byCollaborator.set(collaboratorId, collaboratorMonths);
    }
    for (const [month, value] of monthEntries(period.monthly)) {
      const minutes = monthMinutes(value);
      const current = collaboratorMonths.get(month) || { normalHours: 0, excludedOvertimeHours: 0 };
      collaboratorMonths.set(month, {
        normalHours: current.normalHours + (minutes.normalMinutes / MINUTES_PER_HOUR),
        excludedOvertimeHours: current.excludedOvertimeHours + (minutes.extrasMinutes / MINUTES_PER_HOUR)
      });
    }
  }
  return byCollaborator;
}

function utcMonthBounds(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start, end, days: end.getUTCDate() };
}

function inclusiveDays(start, end) {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function selectAnalyzedMonths({
  year,
  cutoffMonth,
  admissionDate,
  terminationDate,
  currentMonth = new Date().toISOString().slice(0, 7)
} = {}) {
  const normalizedYear = Number(year);
  const normalizedCutoff = Math.min(12, Math.max(1, Number(cutoffMonth) || 12));
  const admissionKey = dateKey(admissionDate);
  const terminationKey = dateKey(terminationDate);
  const admission = admissionKey ? new Date(`${admissionKey}T00:00:00.000Z`) : null;
  const termination = terminationKey ? new Date(`${terminationKey}T00:00:00.000Z`) : null;
  const analyzed = [];

  for (let month = 1; month <= normalizedCutoff; month += 1) {
    const monthKey = `${normalizedYear}-${String(month).padStart(2, '0')}`;
    if (monthKey >= currentMonth) continue;
    const bounds = utcMonthBounds(normalizedYear, month);
    if (admission && admission > bounds.end) continue;
    if (termination && termination < bounds.start) continue;
    const activeStart = admission && admission > bounds.start ? admission : bounds.start;
    const activeEnd = termination && termination < bounds.end ? termination : bounds.end;
    if (activeEnd < activeStart) continue;
    analyzed.push({
      month: monthKey,
      weight: inclusiveDays(activeStart, activeEnd) / bounds.days
    });
  }
  return analyzed;
}

export function computeIndividualRate({ totalHours, analyzedMonths, reference }) {
  const denominator = finiteNumber(analyzedMonths);
  const monthlyReference = finiteNumber(reference);
  if (denominator <= 0 || monthlyReference <= 0) return null;
  const average = finiteNumber(totalHours) / denominator;
  return Math.max(0, (monthlyReference - average) / monthlyReference);
}

// Situação da competência do colaborador. Não existe fechamento manual aqui: a taxa é
// consolidada quando todos os meses analisados já saíram da janela de reprocessamento do ponto.
export function collaboratorProductivityStatus({ rate, analyzedMonths, months = [] }) {
  if (rate === null || finiteNumber(analyzedMonths) <= 0) return 'SEM_BASE';
  return months.some(item => item.instavel) ? 'PODE_MUDAR' : 'CONSOLIDADO';
}

export function computeGeneralRate(individualRates = []) {
  const valid = individualRates.filter(value => typeof value === 'number' && Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((total, value) => total + value, 0) / valid.length;
}

function absenceMonthSet(absences, collaboratorId) {
  const months = new Set();
  for (const absence of absences || []) {
    if (absence.deletedAt || absence.collaboratorId !== collaboratorId || absence.type !== 'FERIAS') continue;
    for (const month of absenceMonths(absence)) months.add(month);
  }
  return months;
}

export function isUnstableMonth(month, referenceDate = new Date()) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!match) return false;
  const monthEnd = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0));
  const referenceKey = dateKey(referenceDate);
  if (!referenceKey) return false;
  const reference = new Date(`${referenceKey}T00:00:00.000Z`);
  const daysSinceMonthEnd = Math.floor((reference.getTime() - monthEnd.getTime()) / 86_400_000);
  return daysSinceMonthEnd >= 0 && daysSinceMonthEnd <= 31;
}

export function buildProductivityReport({
  collaborators = [],
  jobRoles = [],
  periods = [],
  filters = {},
  reference,
  absences = [],
  stabilityReferenceDate = new Date()
} = {}) {
  const year = Number(filters.year ?? filters.ano);
  const cutoffMonth = Number(filters.cutoffMonth ?? filters.ateMes);
  const currentMonth = filters.currentMonth || new Date().toISOString().slice(0, 7);
  const roles = new Map(jobRoles.map(role => [role.id, role]));
  const monthlyByCollaborator = buildMonthlyProductiveHours(periods);
  const rows = [];

  for (const collaborator of collaborators) {
    const role = roles.get(collaborator.jobRoleId) || collaborator.jobRole;
    if (!role || role.isOperational === false) continue;
    const analyzed = selectAnalyzedMonths({
      year,
      cutoffMonth,
      admissionDate: collaborator.admissionDate,
      terminationDate: collaborator.terminationDate,
      currentMonth
    });
    const monthly = monthlyByCollaborator.get(collaborator.id) || new Map();
    if (!analyzed.some(item => monthly.has(item.month))) continue;
    const vacationMonths = absenceMonthSet(absences, collaborator.id);
    const details = analyzed.map(item => {
      const hours = monthly.get(item.month) || { normalHours: 0, excludedOvertimeHours: 0 };
      return {
        mes: item.month,
        hhNormais: hours.normalHours,
        heExcluidas: hours.excludedOvertimeHours,
        mesesEquivalentes: item.weight,
        distanciaReferencia: Math.max(0, reference * item.weight - hours.normalHours),
        ferias: vacationMonths.has(item.month),
        instavel: isUnstableMonth(item.month, stabilityReferenceDate)
      };
    });
    const analyzedMonths = details.reduce((total, item) => total + item.mesesEquivalentes, 0);
    const totalHours = details.reduce((total, item) => total + item.hhNormais, 0);
    const overtime = details.reduce((total, item) => total + item.heExcluidas, 0);
    const average = analyzedMonths > 0 ? totalHours / analyzedMonths : 0;
    const rate = computeIndividualRate({ totalHours, analyzedMonths, reference });
    rows.push({
      id: collaborator.id,
      nome: collaborator.name,
      cargo: role.name,
      hhAcumuladas: totalHours,
      mediaMensal: average,
      heExcluidas: overtime,
      mesesAnalisados: analyzedMonths,
      improdutividade: rate,
      situacao: collaboratorProductivityStatus({ rate, analyzedMonths, months: details }),
      mesesInstaveis: details.filter(item => item.instavel).map(item => item.mes),
      mesesComFerias: details.filter(item => item.ferias).map(item => item.mes),
      meses: details
    });
  }

  rows.sort((left, right) => left.nome.localeCompare(right.nome, 'pt-BR'));
  const evolution = [];
  for (let month = 1; month <= cutoffMonth; month += 1) {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    if (monthKey >= currentMonth) continue;
    const values = rows
      .map(row => row.meses.find(item => item.mes === monthKey))
      .filter(Boolean);
    const normalized = values
      .filter(item => item.mesesEquivalentes > 0)
      .map(item => item.hhNormais / item.mesesEquivalentes);
    evolution.push({
      mes: monthKey,
      mediaHH: normalized.length
        ? normalized.reduce((total, value) => total + value, 0) / normalized.length
        : null,
      referencia: reference,
      instavel: isUnstableMonth(monthKey, stabilityReferenceDate),
      temFerias: values.some(item => item.ferias)
    });
  }

  const publicRows = rows.map(({ meses: _months, ...row }) => row);
  return {
    referenciaMensalHH: reference,
    periodo: { ano: year, ateMes: cutoffMonth },
    resumo: {
      hhAcumuladas: rows.reduce((total, item) => total + item.hhAcumuladas, 0),
      mediaMensalEquipe: rows.length
        ? rows.reduce((total, item) => total + item.mediaMensal, 0) / rows.length
        : null,
      taxaGeral: computeGeneralRate(rows.map(item => item.improdutividade)),
      pendencias: 0
    },
    evolucaoMensal: evolution,
    colaboradores: publicRows,
    detalhesPorColaborador: new Map(rows.map(row => [row.id, row.meses]))
  };
}
