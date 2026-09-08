const DAY_MS = 86_400_000;

export function corporateDateKey(value) {
  if (typeof value === 'string') {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Data civil inválida.');
  return date.toISOString().slice(0, 10);
}

export function easterDateUtc(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function relativeHoliday(easter, offset, name) {
  return {
    date: new Date(easter.getTime() + offset * DAY_MS).toISOString().slice(0, 10),
    name,
    source: 'NATIONAL',
    mutable: false
  };
}

export function nationalBrazilHolidays(year) {
  const easter = easterDateUtc(year);
  const fixed = [
    ['01-01', 'Confraternização Universal'],
    ['04-21', 'Tiradentes'],
    ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência do Brasil'],
    ['10-12', 'Nossa Senhora Aparecida'],
    ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'],
    ['11-20', 'Dia da Consciência Negra'],
    ['12-25', 'Natal']
  ].map(([suffix, name]) => ({
    date: `${year}-${suffix}`,
    name,
    source: 'NATIONAL',
    mutable: false
  }));
  return [
    ...fixed,
    relativeHoliday(easter, -48, 'Carnaval'),
    relativeHoliday(easter, -47, 'Carnaval'),
    relativeHoliday(easter, -2, 'Paixão de Cristo'),
    relativeHoliday(easter, 0, 'Páscoa'),
    relativeHoliday(easter, 60, 'Corpus Christi')
  ].sort((left, right) => left.date.localeCompare(right.date));
}

function yearsInRange(startDate, endDate) {
  const startYear = Number(corporateDateKey(startDate).slice(0, 4));
  const endYear = Number(corporateDateKey(endDate).slice(0, 4));
  return Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
}

export function resolveCorporateCalendar({ startDate, endDate, manualHolidays = [], revision = 1 }) {
  const startKey = corporateDateKey(startDate);
  const endKey = corporateDateKey(endDate);
  if (endKey < startKey) throw new TypeError('O fim do calendário não pode anteceder o início.');
  const holidaysByDate = new Map();
  for (const year of yearsInRange(startKey, endKey)) {
    for (const holiday of nationalBrazilHolidays(year)) {
      if (holiday.date >= startKey && holiday.date <= endKey) holidaysByDate.set(holiday.date, holiday);
    }
  }
  for (const holiday of manualHolidays) {
    if (holiday.deletedAt) continue;
    const date = corporateDateKey(holiday.holidayDate ?? holiday.date);
    if (date < startKey || date > endKey || holidaysByDate.has(date)) continue;
    holidaysByDate.set(date, {
      id: holiday.id || null,
      date,
      name: String(holiday.name || '').trim(),
      source: 'COMPANY',
      mutable: true
    });
  }
  const holidays = [...holidaysByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  return {
    revision,
    holidays,
    holidayDates: new Set(holidays.map(holiday => holiday.date))
  };
}

export function isCorporateHoliday(value, calendarOrDates) {
  const dates = calendarOrDates instanceof Set ? calendarOrDates : calendarOrDates?.holidayDates;
  return Boolean(dates?.has(corporateDateKey(value)));
}

export async function loadCorporateCalendar(database, startDate, endDate) {
  const start = new Date(`${corporateDateKey(startDate)}T00:00:00.000Z`);
  const end = new Date(`${corporateDateKey(endDate)}T00:00:00.000Z`);
  const [manualHolidays, state] = await Promise.all([
    database.workforceHoliday.findMany({
      where: { deletedAt: null, holidayDate: { gte: start, lte: end } },
      orderBy: { holidayDate: 'asc' }
    }),
    database.workforceCalendarState.findUnique({ where: { id: 'global' } })
  ]);
  return resolveCorporateCalendar({
    startDate,
    endDate,
    manualHolidays,
    revision: state?.revision || 1
  });
}
