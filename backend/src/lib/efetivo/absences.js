const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dateKey(value) {
  if (typeof value === 'string' && DATE_PATTERN.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function absenceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function validateAbsencePeriod(period) {
  const startDate = dateKey(period?.startDate);
  const endDate = dateKey(period?.endDate);
  if (!startDate || !endDate) throw absenceError('Informe início e fim válidos para o período de férias.');
  if (endDate < startDate) throw absenceError('A data de fim não pode ser anterior à data de início.');
  return { startDate, endDate };
}

export function periodsOverlap(left, right) {
  const leftPeriod = validateAbsencePeriod(left);
  const rightPeriod = validateAbsencePeriod(right);
  return leftPeriod.startDate <= rightPeriod.endDate
    && rightPeriod.startDate <= leftPeriod.endDate;
}

export function ensureNoAbsenceOverlap(absences, candidate, ignoredId = null) {
  const conflict = (absences || []).find(absence => (
    !absence.deletedAt
    && absence.id !== ignoredId
    && periodsOverlap(absence, candidate)
  ));
  if (conflict) throw absenceError('O período informado se sobrepõe a férias já cadastradas para este colaborador.', 409);
}

export function absenceMonths(period) {
  const normalized = validateAbsencePeriod(period);
  let cursor = new Date(`${normalized.startDate.slice(0, 7)}-01T00:00:00.000Z`);
  const last = new Date(`${normalized.endDate.slice(0, 7)}-01T00:00:00.000Z`);
  const months = [];
  while (cursor <= last) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return months;
}

export function markAbsenceDeleted(absence, deletedAt = new Date()) {
  return { ...absence, deletedAt };
}
