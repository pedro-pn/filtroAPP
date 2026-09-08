import { parseDateKey, periodsOverlap } from './date-only.js';
import { conflictDescriptor } from './errors.js';
import { allocationPeriods, missionCycles } from './allocation-period.js';
import { missionEndsOnOrAfter } from './mission-period.js';
import { resolvePlanningDatabase, getActiveOfficialPlan } from './plan-context.js';
import { efetivoProjectWhere } from '../project-visibility.js';

function utcDate(value) {
  return new Date(`${parseDateKey(value)}T00:00:00.000Z`);
}

export async function getPlanningCalendar(filters, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const startDate = parseDateKey(filters.startDate);
  const endDate = parseDateKey(filters.endDate);
  const plan = await getActiveOfficialPlan(database, { create: true });
  const [missions, absences] = await Promise.all([
    database.efetivoMissionPlan.findMany({
      where: {
        planId: plan.id,
        deletedAt: null,
        project: efetivoProjectWhere(),
        scheduleStatus: 'CONFIRMED',
        mobilizationDate: { lte: utcDate(endDate) },
        ...missionEndsOnOrAfter(utcDate(startDate)),
        ...(filters.jobRoleId ? { demands: { some: { jobRoleId: filters.jobRoleId } } } : {})
      },
      include: {
        project: { select: { id: true, code: true, name: true, clientName: true, location: true } },
        cycles: { orderBy: { mobilizationDate: 'asc' } },
        demands: true,
        allocations: {
          where: { deletedAt: null },
          include: {
            collaborator: { select: { id: true, name: true } },
            cycles: { orderBy: { mobilizationDate: 'asc' } }
          }
        }
      }
    }),
    database.collaboratorAbsence.findMany({
      where: {
        deletedAt: null,
        type: { in: ['FERIAS', 'FOLGA', 'AFASTAMENTO'] },
        startDate: { lte: utcDate(endDate) },
        endDate: { gte: utcDate(startDate) },
        ...(filters.jobRoleId ? { collaborator: { jobRoleId: filters.jobRoleId } } : {})
      },
      include: { collaborator: { select: { id: true, name: true, jobRoleId: true, jobRole: { select: { id: true, name: true } } } } }
    })
  ]);
  const missionEvents = missions.flatMap(mission => missionCycles(mission).map((cycle, index) => ({
    id: cycle.id || `${mission.id}-cycle-${index}`,
    missionId: mission.id,
    type: 'MISSION',
    title: `${mission.project.code} · ${mission.project.name}`,
    startDate: cycle.startDate,
    endDate: cycle.endDate,
    jobRoleIds: mission.demands.map(item => item.jobRoleId),
    entityPath: `/efetivo?section=missoes&missao=${mission.id}`,
    project: mission.project,
    demand: mission.demands.reduce((sum, item) => sum + item.requiredCount, 0),
    allocated: mission.allocations.filter(item => allocationPeriods(item, mission)
      .some(period => periodsOverlap(period, cycle))).length,
    people: mission.allocations.filter(item => allocationPeriods(item, mission)
      .some(period => periodsOverlap(period, cycle))).map(item => item.collaborator)
  })));
  const absenceEvents = absences.map(absence => ({
    id: absence.id,
    type: absence.type,
    title: `${absence.type === 'FERIAS' ? 'Férias' : absence.type === 'FOLGA' ? 'Folga' : 'Afastamento'} · ${absence.collaborator.name}`,
    startDate: parseDateKey(absence.startDate),
    endDate: parseDateKey(absence.endDate),
    jobRoleIds: [absence.collaborator.jobRoleId].filter(Boolean),
    entityPath: `/efetivo?section=colaboradores&colaborador=${absence.collaborator.id}&ausencia=${absence.id}`,
    collaborator: absence.collaborator
  }));
  return {
    events: [...missionEvents, ...absenceEvents].sort((left, right) => left.startDate.localeCompare(right.startDate)),
    conflicts: collectCalendarConflicts(missions, absences)
  };
}

function overlapWindow(left, right) {
  const startDate = left.startDate > right.startDate ? left.startDate : right.startDate;
  const endDate = left.endDate < right.endDate ? left.endDate : right.endDate;
  return { startDate, endDate };
}

// Conflitos remanescentes na base: alocação sobreposta a ausência ou a outra missão confirmada.
// A criação valida tudo isso, mas uma ausência lançada depois pelo módulo antigo pode sobrepor
// uma missão já montada — o calendário precisa mostrar essa inconsistência (FR-010).
export function collectCalendarConflicts(missions = [], absences = []) {
  const assignments = [];
  for (const mission of missions) {
    for (const allocation of mission.allocations || []) {
      if (allocation.deletedAt || !allocation.collaborator) continue;
      assignments.push(...allocationPeriods(allocation, mission).map(period => ({
        mission,
        period,
        collaborator: allocation.collaborator,
        allowMissionOverlap: allocation.allowMissionOverlap
      })));
    }
  }
  const conflicts = [];
  for (const absence of absences) {
    const absencePeriod = { startDate: parseDateKey(absence.startDate), endDate: parseDateKey(absence.endDate) };
    for (const assignment of assignments) {
      if (assignment.collaborator.id !== absence.collaborator.id || !periodsOverlap(assignment.period, absencePeriod)) continue;
      conflicts.push(conflictDescriptor({
        collaborator: assignment.collaborator,
        ...overlapWindow(assignment.period, absencePeriod),
        sourceType: 'ABSENCE',
        sourceId: absence.id,
        entityPath: `/efetivo?section=missoes&missao=${assignment.mission.id}`,
        code: `ABSENCE_${absence.type}`
      }));
    }
  }
  for (let index = 0; index < assignments.length; index += 1) {
    for (let other = index + 1; other < assignments.length; other += 1) {
      const left = assignments[index];
      const right = assignments[other];
      if (left.collaborator.id !== right.collaborator.id || left.mission.id === right.mission.id) continue;
      if (left.allowMissionOverlap || right.allowMissionOverlap) continue;
      if (!periodsOverlap(left.period, right.period)) continue;
      conflicts.push(conflictDescriptor({
        collaborator: left.collaborator,
        ...overlapWindow(left.period, right.period),
        sourceType: 'MISSION',
        sourceId: right.mission.id,
        entityPath: `/efetivo?section=missoes&missao=${right.mission.id}`,
        code: 'DOUBLE_BOOKING'
      }));
    }
  }
  return conflicts.sort((left, right) => left.startDate.localeCompare(right.startDate));
}
