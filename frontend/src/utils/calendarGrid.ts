export function parseDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Data civil inválida.');
  }
  return date;
}

export function addDateOnlyDays(value: string, days: number) {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function todayDateOnly(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function calendarInterval(date: string, view: 'day' | 'week' | 'month') {
  const parsed = parseDateOnly(date);
  if (view === 'day') return { startDate: date, endDate: date };
  if (view === 'week') {
    const mondayOffset = (parsed.getUTCDay() + 6) % 7;
    const startDate = addDateOnlyDays(date, -mondayOffset);
    return { startDate, endDate: addDateOnlyDays(startDate, 6) };
  }
  const startDate = `${date.slice(0, 7)}-01`;
  const nextMonth = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 1));
  nextMonth.setUTCDate(0);
  return { startDate, endDate: nextMonth.toISOString().slice(0, 10) };
}

export function monthCalendarGrid(date: string) {
  const interval = calendarInterval(date, 'month');
  const first = parseDateOnly(interval.startDate);
  const leading = (first.getUTCDay() + 6) % 7;
  const gridStart = addDateOnlyDays(interval.startDate, -leading);
  return Array.from({ length: 42 }, (_, index) => addDateOnlyDays(gridStart, index));
}

export function moveCalendarPosition(date: string, view: 'day' | 'week' | 'month', direction: -1 | 1) {
  if (view === 'day') return addDateOnlyDays(date, direction);
  if (view === 'week') return addDateOnlyDays(date, direction * 7);
  const parsed = parseDateOnly(date);
  const target = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + direction, 1));
  return target.toISOString().slice(0, 10);
}

export function displayDateOnly(value: string | null | undefined, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return '—';
  return parseDateOnly(String(value || '').slice(0, 10)).toLocaleDateString('pt-BR', { timeZone: 'UTC', ...options });
}
