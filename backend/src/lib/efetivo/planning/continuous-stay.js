import { addCalendarDays, inclusiveDayCount, parseDateKey } from './date-only.js';
import { allocationPeriods } from './allocation-period.js';

function normalizedRoleName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

export function defaultContinuousWorkLimitDays(roleName) {
  const normalized = normalizedRoleName(roleName);
  if (normalized.includes('coordenador') || normalized.includes('engenheir')) return 30;
  if (normalized.includes('supervisor')) return 60;
  return 90;
}

export function mergeContinuousMissionIntervals(intervals = []) {
  const sorted = intervals.map(interval => ({
    ...interval,
    startDate: parseDateKey(interval.startDate),
    endDate: parseDateKey(interval.endDate)
  })).sort((left, right) => left.startDate.localeCompare(right.startDate));
  const merged = [];
  for (const interval of sorted) {
    const current = merged.at(-1);
    if (!current || interval.startDate > addCalendarDays(current.endDate, 1)) {
      merged.push({ ...interval, missionIds: interval.missionIds || [interval.missionId].filter(Boolean) });
      continue;
    }
    if (interval.endDate > current.endDate) current.endDate = interval.endDate;
    current.missionIds = [...new Set([...(current.missionIds || []), ...(interval.missionIds || [interval.missionId].filter(Boolean))])];
  }
  return merged;
}

export function splitIntervalsByRestDays(intervals, restPeriods = []) {
  let result = [...intervals];
  for (const rest of restPeriods.filter(item => !item.deletedAt && item.type === 'FOLGA')) {
    const restStart = parseDateKey(rest.startDate);
    const restEnd = parseDateKey(rest.endDate);
    result = result.flatMap(interval => {
      if (restStart > interval.endDate || restEnd < interval.startDate) return [interval];
      const parts = [];
      const beforeEnd = addCalendarDays(restStart, -1);
      const afterStart = addCalendarDays(restEnd, 1);
      if (beforeEnd >= interval.startDate) parts.push({ ...interval, endDate: beforeEnd });
      if (afterStart <= interval.endDate) parts.push({ ...interval, startDate: afterStart });
      return parts;
    });
  }
  return result;
}

export function buildContinuousStayAlerts({ missions = [], collaborators = [], jobRoles = [], absences = [], date }) {
  const position = parseDateKey(date);
  const alerts = [];
  for (const collaborator of collaborators) {
    const intervals = missions.flatMap(mission => {
      if (mission.scheduleStatus !== 'CONFIRMED' || mission.deletedAt) return [];
      return (mission.allocations || [])
        .filter(item => item.collaboratorId === collaborator.id && !item.deletedAt)
        .flatMap(item => allocationPeriods(item, mission)
          .map(period => ({ ...period, missionId: mission.id })));
    });
    const merged = splitIntervalsByRestDays(mergeContinuousMissionIntervals(intervals), absences.filter(item => item.collaboratorId === collaborator.id));
    const current = merged.find(interval => interval.startDate <= position && interval.endDate >= position)
      || merged.find(interval => interval.startDate > position);
    if (!current) continue;
    const role = jobRoles.find(item => item.id === collaborator.jobRoleId);
    const limit = role?.continuousWorkLimitDays
      ?? defaultContinuousWorkLimitDays(role?.name);
    const projectedDays = inclusiveDayCount(current.startDate, current.endDate);
    if (projectedDays < limit) continue;
    alerts.push({
      collaboratorId: collaborator.id,
      collaboratorName: collaborator.name,
      jobRoleId: role?.id || collaborator.jobRoleId || null,
      jobRoleName: role?.name || collaborator.jobRole?.name || '',
      missionIds: current.missionIds || [],
      startDate: current.startDate,
      projectedEndDate: current.endDate,
      projectedDays,
      limitDays: limit,
      restDueDate: addCalendarDays(current.startDate, limit - 1)
    });
  }
  return alerts.sort((left, right) => left.restDueDate.localeCompare(right.restDueDate));
}
