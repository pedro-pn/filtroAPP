function parseHm(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseBreak(value) {
  if (!value || typeof value !== 'string') return 0;
  const text = value.trim().toLowerCase();
  if (text === 'sem intervalo') return 0;
  const hourMinute = text.match(/^(\d{1,2}):(\d{2})$/);
  if (hourMinute) return Number(hourMinute[1]) * 60 + Number(hourMinute[2]);
  const compactHourMinute = text.match(/^(\d{1,2})h(\d{1,2})$/);
  if (compactHourMinute) return Number(compactHourMinute[1]) * 60 + Number(compactHourMinute[2]);
  const onlyHours = text.match(/^(\d{1,2})\s*h(?:ora|oras)?$/);
  if (onlyHours) return Number(onlyHours[1]) * 60;
  const minutes = text.match(/^(\d{1,3})\s*min$/);
  if (minutes) return Number(minutes[1]);
  return 0;
}

function formatMinutes(total) {
  const safe = Math.max(0, Number(total) || 0);
  const hours = String(Math.floor(safe / 60)).padStart(2, '0');
  const minutes = String(safe % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function easterDate(year) {
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

function addDays(date, days) {
  const clone = new Date(date.getTime());
  clone.setUTCDate(clone.getUTCDate() + days);
  return clone;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function isBrazilHoliday(reportDate) {
  const date = new Date(reportDate);
  if (Number.isNaN(date.getTime())) return false;
  const year = date.getUTCFullYear();
  const key = dateKey(date);
  const easter = easterDate(year);
  const fixed = new Set([
    `${year}-01-01`,
    `${year}-04-21`,
    `${year}-05-01`,
    `${year}-09-07`,
    `${year}-10-12`,
    `${year}-11-02`,
    `${year}-11-15`,
    `${year}-11-20`,
    `${year}-12-25`
  ]);
  const movable = new Set([
    dateKey(addDays(easter, -48)),
    dateKey(addDays(easter, -47)),
    dateKey(addDays(easter, -2)),
    dateKey(easter),
    dateKey(addDays(easter, 60))
  ]);
  return fixed.has(key) || movable.has(key);
}

function calculateWorkedMinutes(startTime, endTime, breakValue) {
  const start = parseHm(startTime);
  const end = parseHm(endTime);
  if (start == null || end == null) return 0;
  let duration = end - start;
  if (duration < 0) duration += 24 * 60;
  return Math.max(0, duration - parseBreak(breakValue));
}

function getExpectedMinutes(project, reportDate) {
  if (!project) return 0;
  const date = new Date(reportDate);
  if (Number.isNaN(date.getTime())) return parseBreak(project.workdayHours || '09:00');
  const dow = date.getUTCDay();
  const holiday = isBrazilHoliday(reportDate);
  const weekendBase = parseBreak(project.weekendWorkdayHours || '08:00');
  const weekdayBase = parseBreak(project.workdayHours || '09:00');

  if (holiday) return 0;
  if (dow === 5) return weekendBase;
  if (dow === 6) return project.includesSaturday ? weekendBase : 0;
  if (dow === 0) return project.includesSunday ? weekendBase : 0;
  return weekdayBase;
}

function calculateTurnOvertime(workedMinutes, expectedMinutes) {
  if (!workedMinutes) return 0;
  if (!expectedMinutes) return workedMinutes;
  const delta = workedMinutes - expectedMinutes;
  if (delta <= 30) return 0;
  return delta;
}

export function calculateReportOvertime(project, payload) {
  const special = payload.specialConditions || {};
  const night = special.noturnoDetails || {};
  const daytimeWorkedMinutes = calculateWorkedMinutes(payload.arrivalTime, payload.departureTime, payload.lunchBreak);
  const nighttimeWorkedMinutes = special.noturno
    ? calculateWorkedMinutes(night.inicio, night.termino, night.intervalo || night.jantaIntervalo || '')
    : 0;
  const expectedMinutes = getExpectedMinutes(project, payload.reportDate);
  const daytimeOvertimeMinutes = calculateTurnOvertime(daytimeWorkedMinutes, expectedMinutes);
  const nighttimeOvertimeMinutes = calculateTurnOvertime(nighttimeWorkedMinutes, expectedMinutes);
  const totalOvertimeMinutes = daytimeOvertimeMinutes + nighttimeOvertimeMinutes;

  return {
    daytimeWorkedMinutes,
    nighttimeWorkedMinutes,
    daytimeOvertimeMinutes,
    nighttimeOvertimeMinutes,
    totalOvertimeMinutes,
    expectedMinutes,
    isHoliday: isBrazilHoliday(payload.reportDate),
    display: {
      daytimeWorked: formatMinutes(daytimeWorkedMinutes),
      nighttimeWorked: formatMinutes(nighttimeWorkedMinutes),
      daytimeOvertime: formatMinutes(daytimeOvertimeMinutes),
      nighttimeOvertime: formatMinutes(nighttimeOvertimeMinutes),
      totalOvertime: formatMinutes(totalOvertimeMinutes),
      expected: formatMinutes(expectedMinutes)
    }
  };
}

