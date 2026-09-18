import { addCalendarDays, parseDateKey } from './date-only.js';
import { businessDatesInclusive, holidayDateSet, isBusinessDay } from './business-days.js';
import { allocationPeriods, missionCoversDate } from './allocation-period.js';
import { jobRoleFamilyKey, jobRoleFamilyName } from '../../collaborators/job-role-service.js';

function collaboratorRoleId(collaborator) {
  return collaborator.jobRoleId || null;
}

export function isCollaboratorActiveOn(collaborator, value) {
  const date = parseDateKey(value);
  const admission = collaborator.admissionDate ? parseDateKey(collaborator.admissionDate) : null;
  const termination = collaborator.terminationDate ? parseDateKey(collaborator.terminationDate) : null;
  if (admission && date < admission) return false;
  if (termination && date > termination) return false;
  return collaborator.isActive !== false || Boolean(termination && date <= termination);
}

function indexAbsencesByCollaborator(absences) {
  const index = new Map();
  for (const absence of absences) {
    if (absence.deletedAt || !['FERIAS', 'FOLGA', 'AFASTAMENTO'].includes(absence.type)) continue;
    const periods = index.get(absence.collaboratorId) || [];
    periods.push({
      record: absence,
      startDate: parseDateKey(absence.startDate),
      endDate: parseDateKey(absence.endDate)
    });
    index.set(absence.collaboratorId, periods);
  }
  return index;
}

function indexMissionsByCollaborator(missions) {
  const index = new Map();
  for (const mission of missions) {
    if (mission.deletedAt || mission.scheduleStatus !== 'CONFIRMED') continue;
    for (const allocation of mission.allocations || []) {
      if (allocation.deletedAt) continue;
      const periods = index.get(allocation.collaboratorId) || [];
      periods.push(...allocationPeriods(allocation, mission).map(period => ({
        record: mission,
        startDate: period.startDate,
        endDate: period.endDate
      })));
      index.set(allocation.collaboratorId, periods);
    }
  }
  return index;
}

function recordOn(index, collaboratorId, date) {
  return index.get(collaboratorId)?.find(period => period.startDate <= date && period.endDate >= date)?.record;
}

function demandByRoleOn(missions, date) {
  const totals = new Map();
  for (const mission of missions) {
    if (mission.deletedAt
      || mission.scheduleStatus !== 'CONFIRMED'
      || !missionCoversDate(mission, date)) continue;
    for (const demand of mission.demands || []) {
      totals.set(demand.jobRoleId, (totals.get(demand.jobRoleId) || 0) + Number(demand.requiredCount || 0));
    }
  }
  return totals;
}

function roleGroups(roles) {
  const groups = new Map();
  for (const role of roles) {
    const key = jobRoleFamilyKey(role.name);
    const group = groups.get(key) || { role, roles: [] };
    group.roles.push(role);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function calculateDailyCapacity({
  date,
  collaborators = [],
  jobRoles = [],
  missions = [],
  absences = []
}) {
  const dateKey = parseDateKey(date);
  const roles = jobRoles.filter(role => role.isActive !== false && role.isOperational !== false);
  const groups = roleGroups(roles);
  const absenceIndex = indexAbsencesByCollaborator(absences);
  const missionIndex = indexMissionsByCollaborator(missions);
  const demandTotals = demandByRoleOn(missions, dateKey);
  const statuses = [];

  for (const collaborator of collaborators) {
    if (!isCollaboratorActiveOn(collaborator, dateKey)) continue;
    const jobRoleId = collaboratorRoleId(collaborator);
    if (!jobRoleId || !roles.some(role => role.id === jobRoleId)) continue;
    const absence = recordOn(absenceIndex, collaborator.id, dateKey);
    const mission = recordOn(missionIndex, collaborator.id, dateKey);
    statuses.push({
      collaborator,
      jobRoleId,
      status: absence ? 'UNAVAILABLE' : mission ? 'ALLOCATED' : 'FREE',
      absence: absence || null,
      mission: mission || null
    });
  }

  const byRole = groups.map(group => {
    const roleIds = group.roles.map(role => role.id);
    const people = statuses.filter(item => roleIds.includes(item.jobRoleId));
    const allocated = people.filter(item => item.status === 'ALLOCATED').length;
    const unavailable = people.filter(item => item.status === 'UNAVAILABLE').length;
    const free = people.filter(item => item.status === 'FREE').length;
    const demand = roleIds.reduce((sum, roleId) => sum + (demandTotals.get(roleId) || 0), 0);
    return {
      jobRoleId: group.role.id,
      jobRoleIds: roleIds,
      jobRoleName: jobRoleFamilyName(group.role.name),
      calendarColor: group.role.calendarColor || '#64748B',
      active: people.length,
      allocated,
      unavailable,
      free,
      demand,
      deficit: Math.max(0, demand - allocated)
    };
  });

  const totals = byRole.reduce((sum, item) => ({
    jobRoleId: 'all',
    jobRoleName: 'Total',
    active: sum.active + item.active,
    allocated: sum.allocated + item.allocated,
    unavailable: sum.unavailable + item.unavailable,
    free: sum.free + item.free,
    demand: sum.demand + item.demand,
    deficit: sum.deficit + item.deficit
  }), { active: 0, allocated: 0, unavailable: 0, free: 0, demand: 0, deficit: 0 });

  return { date: dateKey, totals, byRole, statuses };
}

export function calculateUtilization90Days({
  date,
  endDate: requestedEndDate,
  collaborators = [],
  jobRoles = [],
  missions = [],
  absences = [],
  holidays = []
}) {
  const startDate = parseDateKey(date);
  const endDate = requestedEndDate ? parseDateKey(requestedEndDate) : addCalendarDays(startDate, 89);
  const holidaySet = holidayDateSet(holidays);
  const roles = jobRoles.filter(role => role.isActive !== false && role.isOperational !== false);
  const absenceIndex = indexAbsencesByCollaborator(absences);
  const missionIndex = indexMissionsByCollaborator(missions);
  const businessDates = businessDatesInclusive(startDate, endDate, holidaySet);
  const available = new Set();
  const committed = new Set();
  const groups = roleGroups(roles);
  const roleGroupById = new Map(groups.flatMap(group => group.roles.map(role => [role.id, group])));
  const availableByRole = new Map(groups.map(group => [group.role.id, new Set()]));
  const committedByRole = new Map(groups.map(group => [group.role.id, new Set()]));

  for (const collaborator of collaborators) {
    const jobRoleId = collaboratorRoleId(collaborator);
    const group = roleGroupById.get(jobRoleId);
    if (!group) continue;
    for (const day of businessDates) {
      if (!isCollaboratorActiveOn(collaborator, day) || recordOn(absenceIndex, collaborator.id, day)) continue;
      const key = `${collaborator.id}|${day}`;
      available.add(key);
      availableByRole.get(group.role.id).add(key);
      if (recordOn(missionIndex, collaborator.id, day)) {
        committed.add(key);
        committedByRole.get(group.role.id).add(key);
      }
    }
  }

  const ratio = (numerator, denominator) => denominator ? Math.min(100, numerator / denominator * 100) : null;
  return {
    startDate,
    endDate,
    availablePersonDays: available.size,
    committedPersonDays: committed.size,
    rate: ratio(committed.size, available.size),
    byRole: groups.map(group => ({
      jobRoleId: group.role.id,
      jobRoleIds: group.roles.map(role => role.id),
      jobRoleName: jobRoleFamilyName(group.role.name),
      availablePersonDays: availableByRole.get(group.role.id).size,
      committedPersonDays: committedByRole.get(group.role.id).size,
      rate: ratio(committedByRole.get(group.role.id).size, availableByRole.get(group.role.id).size)
    }))
  };
}

export function dateIsCapacityDay(date, holidays) {
  return isBusinessDay(date, holidayDateSet(holidays));
}
