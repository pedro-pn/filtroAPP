import { corporateDateKey } from '../../calendar/corporate-calendar.js';
import { allocationCoversDate, missionCoversDate } from './allocation-period.js';
import { resolvePlanningDatabase } from './plan-context.js';
import { missionEndsOnOrAfter } from './mission-period.js';

function utcDate(value) {
  return new Date(`${corporateDateKey(value)}T00:00:00.000Z`);
}

function missionContextDto(mission, calendarRevision = 1, date = null) {
  if (!mission) return null;
  const allocations = date
    ? mission.allocations.filter(allocation => allocationCoversDate(allocation, mission, date))
    : mission.allocations;
  return {
    missionId: mission.id,
    missionVersion: mission.version,
    planRevision: mission.plan.revision,
    calendarRevision,
    projectId: mission.projectId,
    needsReplanning: mission.needsReplanning,
    replanningReason: mission.replanningReason,
    responsible: {
      userId: mission.headquartersResponsibleUserId,
      name: mission.headquartersResponsibleName,
      role: mission.headquartersResponsibleRole
    },
    dates: {
      mobilizationDate: corporateDateKey(mission.mobilizationDate),
      executionStartDate: corporateDateKey(mission.executionStartDate),
      executionEndDate: corporateDateKey(mission.executionEndDate),
      returnDate: mission.returnDate ? corporateDateKey(mission.returnDate) : null
    },
    collaborators: allocations.map(allocation => ({
      id: allocation.collaborator.id,
      name: allocation.collaborator.name,
      jobRole: {
        id: allocation.jobRoleId,
        name: allocation.jobRoleNameSnapshot,
        isActive: allocation.jobRole.isActive
      }
    })),
    demands: mission.demands.map(demand => ({
      jobRoleId: demand.jobRoleId,
      jobRoleName: demand.jobRole.name,
      requiredCount: demand.requiredCount
    }))
  };
}

export async function getOfficialMissionContext({ projectId, date }, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const position = utcDate(date);
  const [mission, calendarState] = await Promise.all([
    database.efetivoMissionPlan.findFirst({
      where: {
        projectId,
        deletedAt: null,
        scheduleStatus: 'CONFIRMED',
        mobilizationDate: { lte: position },
        ...missionEndsOnOrAfter(position),
        plan: { kind: 'OFFICIAL', status: 'ACTIVE' }
      },
      include: {
        plan: { select: { id: true, revision: true } },
        cycles: { orderBy: { mobilizationDate: 'asc' } },
        allocations: {
          where: { deletedAt: null },
          include: {
            collaborator: { select: { id: true, name: true } },
            jobRole: { select: { id: true, name: true, isActive: true } },
            cycles: { orderBy: { mobilizationDate: 'asc' } }
          }
        },
        demands: { include: { jobRole: { select: { id: true, name: true } } } }
      }
    }),
    database.workforceCalendarState.findUnique({ where: { id: 'global' } })
  ]);
  return mission && missionCoversDate(mission, date)
    ? missionContextDto(mission, calendarState?.revision || 1, date)
    : null;
}

export { missionContextDto };
