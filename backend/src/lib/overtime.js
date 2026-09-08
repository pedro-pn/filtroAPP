import { isCorporateHoliday, resolveCorporateCalendar } from './calendar/corporate-calendar.js';

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
  const hourMinuteSecond = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hourMinuteSecond) {
    return Number(hourMinuteSecond[1]) * 60 + Number(hourMinuteSecond[2]);
  }
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

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

export function isBrazilHoliday(reportDate) {
  const date = new Date(reportDate);
  if (Number.isNaN(date.getTime())) return false;
  const key = dateKey(date);
  return isCorporateHoliday(key, resolveCorporateCalendar({ startDate: key, endDate: key }));
}

function calculateWorkedMinutes(startTime, endTime, breakValue) {
  const start = parseHm(startTime);
  const end = parseHm(endTime);
  if (start == null || end == null) return 0;
  let duration = end - start;
  if (duration < 0) duration += 24 * 60;
  return Math.max(0, duration - parseBreak(breakValue));
}

export function getExpectedMinutes(project, reportDate, corporateCalendar = null) {
  if (!project) return 0;
  const date = new Date(reportDate);
  if (Number.isNaN(date.getTime())) return parseBreak(project.workdayHours || '09:00');
  const dow = date.getUTCDay();
  const holiday = corporateCalendar
    ? isCorporateHoliday(reportDate, corporateCalendar)
    : isBrazilHoliday(reportDate);
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

export function calculateReportOvertime(project, payload, corporateCalendar = null) {
  const special = payload.specialConditions || {};
  const night = special.noturnoDetails || {};
  const daytimeWorkedMinutes = calculateWorkedMinutes(payload.arrivalTime, payload.departureTime, payload.lunchBreak);
  const nighttimeWorkedMinutes = (special.noturno || night.enabled)
    ? calculateWorkedMinutes(night.inicio, night.termino, night.intervalo || night.jantaIntervalo || '')
    : 0;
  const expectedMinutes = getExpectedMinutes(project, payload.reportDate, corporateCalendar);
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
    isHoliday: corporateCalendar
      ? isCorporateHoliday(payload.reportDate, corporateCalendar)
      : isBrazilHoliday(payload.reportDate),
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
