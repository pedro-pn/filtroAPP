const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateKey(value, label = 'data') {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const key = String(value || '').slice(0, 10);
  if (!DATE_ONLY_PATTERN.test(key)) throw new TypeError(`Informe ${label} no formato AAAA-MM-DD.`);
  const parsed = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== key) {
    throw new TypeError(`Informe ${label} válida.`);
  }
  return key;
}

export function dateKeyToUtc(value) {
  return new Date(`${parseDateKey(value)}T00:00:00.000Z`);
}

export function addCalendarDays(value, days) {
  const date = dateKeyToUtc(value);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString().slice(0, 10);
}

export function eachDateInclusive(startValue, endValue) {
  const startDate = parseDateKey(startValue, 'a data inicial');
  const endDate = parseDateKey(endValue, 'a data final');
  if (endDate < startDate) throw new TypeError('A data final não pode ser anterior à data inicial.');
  const values = [];
  for (let cursor = startDate; cursor <= endDate; cursor = addCalendarDays(cursor, 1)) values.push(cursor);
  return values;
}

export function periodsOverlap(left, right) {
  const leftStart = parseDateKey(left?.startDate, 'a data inicial');
  const leftEnd = parseDateKey(left?.endDate, 'a data final');
  const rightStart = parseDateKey(right?.startDate, 'a data inicial');
  const rightEnd = parseDateKey(right?.endDate, 'a data final');
  if (leftEnd < leftStart || rightEnd < rightStart) throw new TypeError('O período informado está invertido.');
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

export function intersectPeriods(left, right) {
  if (!periodsOverlap(left, right)) return null;
  return {
    startDate: parseDateKey(left.startDate) > parseDateKey(right.startDate)
      ? parseDateKey(left.startDate) : parseDateKey(right.startDate),
    endDate: parseDateKey(left.endDate) < parseDateKey(right.endDate)
      ? parseDateKey(left.endDate) : parseDateKey(right.endDate)
  };
}

export function inclusiveDayCount(startValue, endValue) {
  return eachDateInclusive(startValue, endValue).length;
}

export function compareDateKeys(left, right) {
  return parseDateKey(left).localeCompare(parseDateKey(right));
}
