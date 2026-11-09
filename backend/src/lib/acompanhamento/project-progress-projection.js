import { buildRequiredWeeklyProgress } from './avanco.js';
import { progressSourceRevision } from './progress-projection.js';

export function addCalendarDays(startDate, days) {
  const date = new Date(startDate);
  if (Number.isNaN(date.getTime())) return null;
  date.setTime(date.getTime() + days * 86400000);
  return date.toISOString();
}

export function buildProjectCalendarPeriod({ division = null, startDate = null, referenceDate = new Date() } = {}) {
  const activeStartDate = division ? division.mobilizationDate ?? null : startDate;
  const elapsed = activeStartDate ? Math.floor((new Date(referenceDate) - new Date(activeStartDate)) / 86400000) : null;
  return { startDate: activeStartDate, elapsed: activeStartDate ? Math.max(0, Number.isFinite(elapsed) ? elapsed : 0) : null };
}

export function projectProgressCalendar(row, division, lastRdoDate, today = new Date()) {
  const rawDays = row.plannedDays == null || row.plannedDays === '' ? null : Number(row.plannedDays);
  const plannedDays = division ? division.plannedDays : Number.isFinite(rawDays) ? rawDays : null;
  const referenceDate = division
    ? division.endDate && division.endDate < today.toISOString().slice(0, 10)
      ? new Date(`${division.endDate}T00:00:00.000Z`) : today
    : row.archived && lastRdoDate ? new Date(lastRdoDate) : today;
  const period = buildProjectCalendarPeriod({ division, startDate: row.startDate, referenceDate });
  const expectedEndDate = division ? division.endDate ?? null
    : period.startDate && plannedDays ? addCalendarDays(period.startDate, plannedDays) : null;
  return { ...period, plannedDays, referenceDate, expectedEndDate };
}

export function projectProgressProjection(details, mode, calendar) {
  const { progress, progressHistory, dailyProgressHistory, progressSlices } = details;
  const pace = value => buildRequiredWeeklyProgress(value, {
    startDate: calendar.startDate, expectedEndDate: calendar.expectedEndDate, referenceDate: calendar.referenceDate
  });
  return {
    avancoPct: progress.progressPct ?? null,
    avancoMethod: progress.progressMethod ?? null,
    progressBreakdown: progress,
    progressReadMode: mode,
    progressRevision: details.progressRevision ? progressSourceRevision({
      source: details.progressRevision, startDate: calendar.startDate,
      expectedEndDate: calendar.expectedEndDate, referenceDate: calendar.referenceDate.toISOString().slice(0, 10)
    }) : undefined,
    progressHistory: mode === 'current' ? undefined : progressHistory,
    dailyProgressHistory: mode === 'current' ? undefined : dailyProgressHistory,
    requiredWeeklyProgress: pace(progress),
    progressFilters: progressSlices ? {
      scopes: progressSlices.scopes, equipments: progressSlices.equipments, lookup: progressSlices.lookup,
      slices: progressSlices.slices.map(slice => ({
        avancoPct: slice.progress.progressPct, progressHistory: slice.progressHistory,
        dailyProgressHistory: slice.dailyProgressHistory, requiredWeeklyProgress: pace(slice.progress)
      }))
    } : null
  };
}
