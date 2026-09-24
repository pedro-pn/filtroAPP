import { addCalendarDays, parseDateKey } from './date-only.js';
import { calculateDailyCapacity } from './capacity.js';
import { jobRoleFamilyKey } from '../../collaborators/job-role-service.js';
import { efetivoProjectWhere } from '../project-visibility.js';
import { loadPlanningProjection } from './read-model.js';
import { resolvePlanningDatabase } from './plan-context.js';
import { missionCoversDate } from './allocation-period.js';

const STATUS = {
  FREE: 'AVAILABLE',
  STANDBY: 'AWAITING_MOBILIZATION',
  ALLOCATED: 'MOBILIZED',
  FERIAS: 'ON_VACATION',
  UNAVAILABLE: 'OTHER_UNAVAILABLE'
};

export function buildAvailabilityPeriod({ startDate, endDate, jobRoleId, projection, plannedWorkflows = [] }) {
  const first = parseDateKey(startDate);
  const last = parseDateKey(endDate);
  const days = [];
  const people = new Map();
  const roles = new Map();
  const plannedRisks = [];
  const confirmedMissionByProject = new Map(projection.missions
    .filter(mission => mission.scheduleStatus === 'CONFIRMED')
    .map(mission => [mission.projectId, mission]));
  const selectedRole = projection.jobRoles.find(role => role.id === jobRoleId);
  const selectedIds = selectedRole
    ? new Set(projection.jobRoles.filter(role => jobRoleFamilyKey(role.name) === jobRoleFamilyKey(selectedRole.name)).map(role => role.id))
    : null;

  for (let date = first; date <= last; date = addCalendarDays(date, 1)) {
    const daily = calculateDailyCapacity({ date, ...projection });
    const relevantRoles = selectedIds
      ? daily.byRole.filter(role => role.jobRoleIds.some(id => selectedIds.has(id)))
      : daily.byRole;
    const deficit = relevantRoles.reduce((sum, role) => sum + role.deficit, 0);
    days.push({ date, deficit });
    for (const role of relevantRoles) {
      const item = roles.get(role.jobRoleId) || {
        jobRoleId: role.jobRoleId,
        jobRoleName: role.jobRoleName,
        calendarColor: role.calendarColor,
        peakDeficit: 0,
        deficitDays: 0,
        totalOpenPositions: 0,
        daily: []
      };
      item.daily.push({ date, demand: role.demand, allocated: role.allocated, deficit: role.deficit });
      item.peakDeficit = Math.max(item.peakDeficit, role.deficit);
      if (role.deficit) {
        item.deficitDays += 1;
        item.totalOpenPositions += role.deficit;
      }
      roles.set(role.jobRoleId, item);
    }
    const plannedByRole = new Map();
    for (const workflow of plannedWorkflows) {
      if (parseDateKey(workflow.plannedMobilizationDate) !== date) continue;
      const mission = confirmedMissionByProject.get(workflow.projectId);
      const confirmedMission = mission && missionCoversDate(mission, date) ? mission : null;
      for (const role of relevantRoles) {
        const plannedCount = (workflow.teamDemands || [])
          .filter(demand => role.jobRoleIds.includes(demand.jobRoleId))
          .reduce((sum, demand) => sum + Number(demand.requiredCount || 0), 0);
        const programmedCount = (confirmedMission?.demands || [])
          .filter(demand => role.jobRoleIds.includes(demand.jobRoleId))
          .reduce((sum, demand) => sum + Number(demand.requiredCount || 0), 0);
        const additionalNeed = Math.max(0, plannedCount - programmedCount);
        if (!additionalNeed) continue;
        const item = plannedByRole.get(role.jobRoleId) || { role, required: 0, projects: new Map() };
        item.required += additionalNeed;
        item.projects.set(workflow.projectId, {
          id: workflow.projectId,
          code: workflow.project?.code || '',
          name: workflow.project?.name || ''
        });
        plannedByRole.set(role.jobRoleId, item);
      }
    }
    for (const item of plannedByRole.values()) {
      const free = Math.max(0, item.role.free - item.role.deficit);
      const deficit = Math.max(0, item.required - free);
      if (deficit) plannedRisks.push({
        date,
        jobRoleId: item.role.jobRoleId,
        jobRoleName: item.role.jobRoleName,
        required: item.required,
        free,
        deficit,
        projects: [...item.projects.values()]
      });
    }
    for (const entry of daily.statuses) {
      if (selectedIds && !selectedIds.has(entry.jobRoleId)) continue;
      const collaborator = entry.collaborator;
      const person = people.get(collaborator.id) || {
        id: collaborator.id,
        name: collaborator.name,
        role: collaborator.jobRole?.name || '',
        jobRoleId: entry.jobRoleId,
        days: []
      };
      const status = entry.absence
        ? STATUS[entry.absence.type] || STATUS.UNAVAILABLE
        : entry.mission
          ? entry.mission.stage === 'STANDBY' ? STATUS.STANDBY : STATUS.ALLOCATED
          : STATUS.FREE;
      person.days.push({
        date,
        status,
        detail: entry.absence
          ? entry.absence.type === 'FERIAS' ? 'Férias' : entry.absence.type === 'FOLGA' ? 'Folga' : 'Afastamento'
          : entry.mission ? `${entry.mission.project?.code || ''} · ${entry.mission.project?.name || ''}`.trim() : null
      });
      people.set(collaborator.id, person);
    }
  }

  return {
    startDate: first,
    endDate: last,
    days,
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    roles: [...roles.values()].sort((a, b) => b.peakDeficit - a.peakDeficit || a.jobRoleName.localeCompare(b.jobRoleName, 'pt-BR')),
    plannedRisks: plannedRisks.sort((a, b) => a.date.localeCompare(b.date) || b.deficit - a.deficit)
  };
}

export async function getPlanningAvailabilityPeriod(filters, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const [projection, plannedWorkflows] = await Promise.all([
    loadPlanningProjection({ date: filters.startDate, returnDate: filters.endDate }, { database }),
    database.projectWorkflow.findMany({
      where: {
        teamPlanDefined: true,
        stage: { not: 'FINISHED' },
        plannedMobilizationDate: {
          gte: new Date(`${filters.startDate}T00:00:00.000Z`),
          lte: new Date(`${filters.endDate}T00:00:00.000Z`)
        },
        teamDemands: { some: {} },
        project: { isActive: true, ...efetivoProjectWhere() }
      },
      select: {
        projectId: true,
        plannedMobilizationDate: true,
        teamDemands: { select: { jobRoleId: true, requiredCount: true } },
        project: { select: { code: true, name: true } }
      }
    })
  ]);
  return buildAvailabilityPeriod({ ...filters, projection, plannedWorkflows });
}
