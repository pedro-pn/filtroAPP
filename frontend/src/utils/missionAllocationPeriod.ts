import type { MissionAllocation, PlanningMission } from '../api/efetivoPlanning';

export function dateKey(value: string) {
  return value.slice(0, 10);
}

export function missionCyclePeriods(mission: PlanningMission) {
  if (mission.cycles?.length) return mission.cycles.map(cycle => ({
    id: cycle.id,
    startDate: dateKey(cycle.mobilizationDate),
    endDate: dateKey(cycle.demobilizationDate || mission.returnDate || mission.executionEndDate),
    isOpen: !cycle.demobilizationDate
  }));
  return [{
    id: null,
    startDate: dateKey(mission.mobilizationDate),
    endDate: dateKey(mission.returnDate || mission.executionEndDate),
    isOpen: false
  }];
}

export function missionAllocationPeriods(allocation: MissionAllocation, mission: PlanningMission) {
  if (allocation.cycles?.length) return allocation.cycles.map(cycle => ({
    id: cycle.id,
    startDate: dateKey(cycle.mobilizationDate),
    endDate: dateKey(cycle.demobilizationDate || mission.returnDate || mission.executionEndDate),
    isOpen: !cycle.demobilizationDate
  }));
  if (allocation.mobilizationDate || allocation.demobilizationDate) return [{
    id: null,
    startDate: dateKey(allocation.mobilizationDate || mission.mobilizationDate),
    endDate: dateKey(allocation.demobilizationDate || mission.returnDate || mission.executionEndDate),
    isOpen: false
  }];
  return missionCyclePeriods(mission);
}

export function missionAllocationPeriod(allocation: MissionAllocation, mission: PlanningMission) {
  const periods = missionAllocationPeriods(allocation, mission);
  return {
    startDate: periods[0].startDate,
    endDate: periods.reduce((latest, period) => period.endDate > latest ? period.endDate : latest, periods[0].endDate)
  };
}

export function allocationIncludesDate(allocation: MissionAllocation, mission: PlanningMission, date: string) {
  return missionAllocationPeriods(allocation, mission)
    .some(period => period.startDate <= date && period.endDate >= date);
}

export function allocationOverlapsPeriod(
  allocation: MissionAllocation,
  mission: PlanningMission,
  startDate: string,
  endDate: string
) {
  return missionAllocationPeriods(allocation, mission)
    .some(period => period.startDate <= endDate && period.endDate >= startDate);
}

export function missionAllocationsOn(mission: PlanningMission, date: string) {
  return mission.allocations.filter(allocation => allocationIncludesDate(allocation, mission, date));
}

export function missionFinalAllocations(mission: PlanningMission) {
  return mission.allocations;
}

export function missionRolePeakCount(mission: PlanningMission, jobRoleId: string) {
  const roleAllocations = mission.allocations.filter(allocation => allocation.jobRoleId === jobRoleId);
  if (!roleAllocations.length
    && mission.demands.length === 1
    && mission.allocations.every(allocation => !allocation.jobRoleId)) {
    return mission.allocations.length;
  }
  const dates = [...new Set(roleAllocations.flatMap(allocation => missionAllocationPeriods(allocation, mission)
    .map(period => period.startDate)))];
  return dates.reduce((maximum, date) => Math.max(
    maximum,
    roleAllocations.filter(allocation => allocationIncludesDate(allocation, mission, date)).length
  ), 0);
}

export function missionCoveredDemand(mission: PlanningMission) {
  return mission.demands.reduce((covered, demand) => (
    covered + Math.min(demand.requiredCount, missionRolePeakCount(mission, demand.jobRoleId))
  ), 0);
}
