const DAY_MS = 86400000;

function calendarDate(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Mesmo intervalo dos dias corridos: início incluído, data de referência excluída.
// Dias úteis representam segunda a sexta; não há calendário de feriados no projeto.
export function projectElapsedDays(startDate, referenceDate) {
  const start = calendarDate(startDate);
  const end = calendarDate(referenceDate);
  if (!start || !end) return { elapsedDays: null, businessDays: null };
  const elapsedDays = Math.max(0, Math.floor((new Date(referenceDate) - new Date(startDate)) / DAY_MS));
  const calendarDays = Math.max(0, Math.round((end - start) / DAY_MS));
  let businessDays = Math.floor(calendarDays / 7) * 5;
  for (let offset = 0; offset < calendarDays % 7; offset += 1) {
    const weekday = (start.getUTCDay() + offset) % 7;
    if (weekday !== 0 && weekday !== 6) businessDays += 1;
  }
  return { elapsedDays, businessDays };
}

export function reportDayStatus(standbyMinutes, journeyMinutes) {
  if (standbyMinutes > 0 && journeyMinutes > 0 && standbyMinutes >= journeyMinutes) return 'PARADO';
  if (standbyMinutes > 0) return 'STANDBY';
  return 'TRABALHADO';
}

export function countStoppedReportDays(byDay, journeyForDate) {
  return [...byDay.values()].filter(day =>
    reportDayStatus(day.statusStandbyMin, journeyForDate(day.reportDate)) === 'PARADO'
  ).length;
}
