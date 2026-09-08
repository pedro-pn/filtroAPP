import { addCalendarDays, parseDateKey } from './date-only.js';
import { missionPeriod } from './mission-period.js';

function normalizedCycle(cycle, fallbackEndDate) {
  const startDate = parseDateKey(cycle.mobilizationDate);
  const isOpen = !cycle.demobilizationDate;
  return {
    id: cycle.id || null,
    startDate,
    endDate: isOpen ? (fallbackEndDate < startDate ? startDate : fallbackEndDate) : parseDateKey(cycle.demobilizationDate),
    isOpen
  };
}

export function missionCycles(mission) {
  const fallback = missionPeriod(mission);
  if (Array.isArray(mission?.cycles) && mission.cycles.length) {
    return mission.cycles
      .map(cycle => normalizedCycle(cycle, fallback.endDate))
      .sort((left, right) => left.startDate.localeCompare(right.startDate));
  }
  return [{ id: null, ...fallback, isOpen: false }];
}

export function allocationPeriods(allocation, mission = allocation?.mission) {
  const fallback = missionPeriod(mission);
  if (Array.isArray(allocation?.cycles) && allocation.cycles.length) {
    return allocation.cycles
      .map(cycle => normalizedCycle(cycle, fallback.endDate))
      .sort((left, right) => left.startDate.localeCompare(right.startDate));
  }
  if (allocation?.mobilizationDate || allocation?.demobilizationDate) {
    return [{
      id: null,
      startDate: allocation?.mobilizationDate ? parseDateKey(allocation.mobilizationDate) : fallback.startDate,
      endDate: allocation?.demobilizationDate ? parseDateKey(allocation.demobilizationDate) : fallback.endDate,
      isOpen: false
    }];
  }
  return missionCycles(mission);
}

export function allocationPeriod(allocation, mission = allocation?.mission) {
  const periods = allocationPeriods(allocation, mission);
  return {
    startDate: periods[0].startDate,
    endDate: periods.reduce((latest, period) => period.endDate > latest ? period.endDate : latest, periods[0].endDate)
  };
}

export function allocationPeriodWithinMission(period, mission) {
  const bounds = missionPeriod(mission);
  return period.startDate >= bounds.startDate
    && period.endDate <= bounds.endDate
    && period.startDate <= period.endDate;
}

export function allocationCoversDate(allocation, mission, value) {
  const date = parseDateKey(value);
  return allocationPeriods(allocation, mission).some(period => (
    period.startDate <= date && period.endDate >= date
  ));
}

export function missionCoversDate(mission, value) {
  const date = parseDateKey(value);
  return missionCycles(mission).some(period => (
    period.startDate <= date && period.endDate >= date
  ));
}

export function maximumConcurrentAllocationCount(periods = []) {
  const events = new Map();
  for (const period of periods) {
    const startDate = parseDateKey(period.startDate);
    const endDate = parseDateKey(period.endDate);
    if (endDate < startDate) continue;
    events.set(startDate, (events.get(startDate) || 0) + 1);
    const afterEnd = addCalendarDays(endDate, 1);
    events.set(afterEnd, (events.get(afterEnd) || 0) - 1);
  }
  let current = 0;
  let maximum = 0;
  for (const date of [...events.keys()].sort()) {
    current += events.get(date) || 0;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}
