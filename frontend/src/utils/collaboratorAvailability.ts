import type { PlanningAbsence, PlanningCollaborator, PlanningMission } from '../api/efetivoPlanning';
import { allocationIncludesDate, allocationOverlapsPeriod, missionAllocationPeriods } from './missionAllocationPeriod';

export const AVAILABILITY_STATUSES = ['AVAILABLE', 'AWAITING_MOBILIZATION', 'MOBILIZED', 'ON_VACATION'] as const;
export type AvailabilityStatus = typeof AVAILABILITY_STATUSES[number];

export interface AvailabilityEntry {
  collaborator: PlanningCollaborator;
  status: AvailabilityStatus;
  mission: PlanningMission | null;
  absence: PlanningAbsence | null;
}

export type AvailabilityColumns = Record<AvailabilityStatus, AvailabilityEntry[]>;

function dateKey(value: string) {
  return value.slice(0, 10);
}

function includesDate(startDate: string, endDate: string, date: string) {
  return dateKey(startDate) <= date && dateKey(endDate) >= date;
}

function overlapsPeriod(startDate: string, endDate: string, periodStart: string, periodEnd: string) {
  return dateKey(startDate) <= periodEnd && dateKey(endDate) >= periodStart;
}

export function buildAvailabilityColumns(
  collaborators: PlanningCollaborator[],
  missions: PlanningMission[],
  absences: PlanningAbsence[],
  date: string
): { columns: AvailabilityColumns; otherUnavailable: number } {
  const columns: AvailabilityColumns = {
    AVAILABLE: [],
    AWAITING_MOBILIZATION: [],
    MOBILIZED: [],
    ON_VACATION: []
  };
  let otherUnavailable = 0;

  for (const collaborator of collaborators) {
    const currentAbsence = absences.find(absence => absence.collaboratorId === collaborator.id
      && includesDate(absence.startDate, absence.endDate, date)) || null;
    if (currentAbsence) {
      if (currentAbsence.type === 'FERIAS') {
        columns.ON_VACATION.push({ collaborator, status: 'ON_VACATION', mission: null, absence: currentAbsence });
      } else {
        otherUnavailable += 1;
      }
      continue;
    }

    const allocatedMissions = missions
      .flatMap(mission => {
        if (mission.scheduleStatus !== 'CONFIRMED' || mission.stage === 'FINISHED') return [];
        const allocation = mission.allocations.find(item => item.collaboratorId === collaborator.id
          && missionAllocationPeriods(item, mission).some(period => period.endDate >= date));
        return allocation ? [{ mission, allocation }] : [];
      })
      .sort((left, right) => missionAllocationPeriods(left.allocation, left.mission)[0].startDate
        .localeCompare(missionAllocationPeriods(right.allocation, right.mission)[0].startDate));
    const currentMission = allocatedMissions.find(item => allocationIncludesDate(item.allocation, item.mission, date))?.mission || null;
    const nextMission = allocatedMissions.find(item => missionAllocationPeriods(item.allocation, item.mission)
      .some(period => period.startDate > date))?.mission || null;

    if (currentMission) {
      const status: AvailabilityStatus = currentMission.stage === 'STANDBY' ? 'AWAITING_MOBILIZATION' : 'MOBILIZED';
      columns[status].push({ collaborator, status, mission: currentMission, absence: null });
    } else if (nextMission) {
      columns.AWAITING_MOBILIZATION.push({ collaborator, status: 'AWAITING_MOBILIZATION', mission: nextMission, absence: null });
    } else if (collaborator.status === 'FREE') {
      columns.AVAILABLE.push({ collaborator, status: 'AVAILABLE', mission: null, absence: null });
    } else if (collaborator.status === 'UNAVAILABLE') {
      otherUnavailable += 1;
    }
  }

  for (const status of AVAILABILITY_STATUSES) {
    columns[status].sort((left, right) => left.collaborator.name.localeCompare(right.collaborator.name, 'pt-BR'));
  }
  return { columns, otherUnavailable };
}

export function buildMissionAvailabilityColumns(
  collaborators: PlanningCollaborator[],
  missions: PlanningMission[],
  absences: PlanningAbsence[],
  startDate: string,
  endDate: string,
  ignoredMissionId?: string
): { columns: AvailabilityColumns; otherUnavailable: number } {
  const columns: AvailabilityColumns = {
    AVAILABLE: [],
    AWAITING_MOBILIZATION: [],
    MOBILIZED: [],
    ON_VACATION: []
  };
  let otherUnavailable = 0;

  for (const collaborator of collaborators) {
    const overlappingAbsence = absences.find(absence => absence.collaboratorId === collaborator.id
      && overlapsPeriod(absence.startDate, absence.endDate, startDate, endDate)) || null;
    if (overlappingAbsence) {
      if (overlappingAbsence.type === 'FERIAS') {
        columns.ON_VACATION.push({ collaborator, status: 'ON_VACATION', mission: null, absence: overlappingAbsence });
      } else {
        otherUnavailable += 1;
      }
      continue;
    }

    const overlappingMissions = missions.filter(mission => mission.id !== ignoredMissionId
      && mission.scheduleStatus === 'CONFIRMED'
      && mission.stage !== 'FINISHED'
      && mission.allocations.some(allocation => allocation.collaboratorId === collaborator.id
        && allocationOverlapsPeriod(allocation, mission, startDate, endDate)));
    const mobilizedMission = overlappingMissions.find(mission => mission.stage !== 'STANDBY') || null;
    const waitingMission = overlappingMissions.find(mission => mission.stage === 'STANDBY') || null;
    if (mobilizedMission) {
      columns.MOBILIZED.push({ collaborator, status: 'MOBILIZED', mission: mobilizedMission, absence: null });
      continue;
    }
    if (waitingMission) {
      columns.AWAITING_MOBILIZATION.push({ collaborator, status: 'AWAITING_MOBILIZATION', mission: waitingMission, absence: null });
      continue;
    }

    const admissionDate = collaborator.admissionDate ? dateKey(collaborator.admissionDate) : null;
    const terminationDate = collaborator.terminationDate ? dateKey(collaborator.terminationDate) : null;
    const employedThroughout = (!admissionDate || admissionDate <= startDate)
      && (!terminationDate || terminationDate >= endDate)
      && (collaborator.isActive || Boolean(terminationDate && terminationDate >= endDate));
    if (employedThroughout) columns.AVAILABLE.push({ collaborator, status: 'AVAILABLE', mission: null, absence: null });
    else otherUnavailable += 1;
  }

  for (const status of AVAILABILITY_STATUSES) {
    columns[status].sort((left, right) => left.collaborator.name.localeCompare(right.collaborator.name, 'pt-BR'));
  }
  return { columns, otherUnavailable };
}
