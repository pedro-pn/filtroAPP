import { hasEditableDefaultMissionCycle } from '../../../shared/modules/mission-default-cycle.js';
import type { MissionAllocation, MissionScheduleStatus, PlanningMission } from '../api/efetivoPlanning';
import { missionAllocationPeriod, missionAllocationPeriods } from './missionAllocationPeriod';

export type CollaboratorActivityFilter = 'ACTIVE' | 'INACTIVE' | 'ALL';

export type MissionAllocationPeriodDraft = {
  collaboratorId: string;
  mobilizationDate: string;
  demobilizationDate: string;
};

/** An inherited planning period follows the schedule; individual history keeps its own dates. */
export function missionTeamAllocationPeriod(allocation: MissionAllocation, mission: PlanningMission) {
  const inheritsMission = !allocation.mobilizationDate && !allocation.demobilizationDate && !allocation.cycles?.length;
  return missionAllocationPeriod(allocation, inheritsMission && hasEditableDefaultMissionCycle(mission)
    ? { ...mission, cycles: [] } : mission);
}

/** Usa os mesmos períodos da inclusão individual ou da edição da equipe na API. */
export function missionTeamCollaboratorPeriods({ mission, collaboratorId, startDate, endDate, allocationPeriods = [], singleSelection = false }: {
  mission: PlanningMission | null;
  collaboratorId: string;
  startDate: string;
  endDate: string;
  allocationPeriods?: MissionAllocationPeriodDraft[];
  singleSelection?: boolean;
}) {
  const requested = allocationPeriods.find(period => period.collaboratorId === collaboratorId);
  if (!mission) return [{
    startDate: requested?.mobilizationDate || startDate,
    endDate: requested?.demobilizationDate || endDate
  }];

  const sourceMission = singleSelection ? mission : {
    ...mission, mobilizationDate: startDate, executionEndDate: endDate, returnDate: endDate,
    cycles: hasEditableDefaultMissionCycle(mission) ? [] : mission.cycles
  };
  const defaultCycle = sourceMission.cycles?.find(cycle => cycle.isDefault);
  const missionStart = (defaultCycle?.mobilizationDate || sourceMission.mobilizationDate).slice(0, 10);
  const forecastEnd = (sourceMission.returnDate || sourceMission.executionEndDate).slice(0, 10);
  const missionEnd = defaultCycle ? (sourceMission.cycles || []).reduce((latest, cycle) => {
    const date = (cycle.demobilizationDate || cycle.mobilizationDate).slice(0, 10);
    return date > latest ? date : latest;
  }, forecastEnd) : forecastEnd;
  const proposedMission = { ...sourceMission, mobilizationDate: missionStart, returnDate: missionEnd };
  const boundsStart = singleSelection ? missionStart : startDate;
  const boundsEnd = singleSelection ? missionEnd : endDate;
  const existing = singleSelection ? undefined : mission.allocations.find(allocation => allocation.collaboratorId === collaboratorId);
  const period = singleSelection ? { mobilizationDate: startDate, demobilizationDate: endDate } : requested;
  return missionAllocationPeriods({
    cycles: existing?.cycles,
    mobilizationDate: period
      ? period.mobilizationDate === boundsStart ? null : period.mobilizationDate
      : existing?.mobilizationDate || null,
    demobilizationDate: period
      ? period.demobilizationDate === boundsEnd ? null : period.demobilizationDate
      : existing?.demobilizationDate || null
  }, proposedMission);
}

export function filterCollaboratorsByActivity<T extends { isActive?: boolean }>(people: T[], filter: CollaboratorActivityFilter): T[] {
  return people.filter(person => filter === 'ALL' || (filter === 'INACTIVE' ? person.isActive === false : person.isActive !== false));
}

type MissionTeamCollaborator = {
  id: string;
  name: string;
  role: string;
};

function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}

export function filterMissionTeamCollaborators<T extends MissionTeamCollaborator>(collaborators: T[], search: string): T[] {
  const query = normalizeSearch(search);
  if (!query) return collaborators;
  return collaborators.filter(collaborator => normalizeSearch(`${collaborator.name} ${collaborator.role}`).includes(query));
}

export function selectedMissionCollaboratorIds(mission: Pick<PlanningMission, 'allocations'> | null): string[] {
  if (!mission) return [];
  return [...new Set(mission.allocations.map(allocation => allocation.collaboratorId))];
}

export function missionTeamScheduleStatus(status: MissionScheduleStatus | null | undefined, initialTeamMode: boolean): 'CONFIRMED' | 'CANCELLED' {
  if (initialTeamMode) return 'CONFIRMED';
  return status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED';
}

/** Cargo previsto no planejamento D-30 da obra; `roleIds` reúne os cargos da mesma família. */
export interface PlannedTeamRole {
  id: string;
  name: string;
  requiredCount: number;
  roleIds: string[];
}

/** Dados já definidos no fluxo de gestão (Handover, análise inicial e planejamento D-30) que a equipe apenas reflete. */
export interface InitialTeamContext {
  leaderUserId: string;
  leaderName: string;
  mobilizationDate: string;
  executionStartDate: string;
  executionEndDate: string;
  plannedRoles: PlannedTeamRole[];
}

export type MissionTeamScheduleDates = Pick<InitialTeamContext,
  'mobilizationDate' | 'executionStartDate' | 'executionEndDate'> & { returnDate: string };

type MissionTeamContextDates = Pick<InitialTeamContext,
  'mobilizationDate' | 'executionStartDate' | 'executionEndDate'>;

/**
 * Ao editar uma missão existente, suas datas oficiais são a fonte de verdade. O fluxo de gestão e as datas
 * sugeridas pelo projeto servem somente para preencher uma missão que ainda não foi criada.
 */
export function resolveMissionTeamScheduleDates(
  mission: Pick<PlanningMission, 'mobilizationDate' | 'executionStartDate' | 'executionEndDate' | 'returnDate'> | null,
  context?: MissionTeamContextDates,
  suggested?: Partial<MissionTeamScheduleDates> | null
): MissionTeamScheduleDates {
  return {
    mobilizationDate: mission?.mobilizationDate?.slice(0, 10) || context?.mobilizationDate || suggested?.mobilizationDate || '',
    executionStartDate: mission?.executionStartDate?.slice(0, 10) || context?.executionStartDate || suggested?.executionStartDate || '',
    executionEndDate: mission?.executionEndDate?.slice(0, 10) || context?.executionEndDate || suggested?.executionEndDate || '',
    returnDate: mission ? mission.returnDate?.slice(0, 10) || '' : suggested?.returnDate || ''
  };
}

export function plannedRoleIdSet(plannedRoles: PlannedTeamRole[] | undefined) {
  return new Set((plannedRoles || []).flatMap(role => role.roleIds.length ? role.roleIds : [role.id]));
}

export function isPlannedRole(jobRoleId: string | null | undefined, plannedRoles: PlannedTeamRole[] | undefined) {
  return Boolean(jobRoleId && plannedRoleIdSet(plannedRoles).has(jobRoleId));
}

/** Quantos colaboradores selecionados cobrem cada cargo previsto (e quantos foram escolhidos fora do plano). */
export function plannedRoleCoverage(plannedRoles: PlannedTeamRole[] | undefined, selected: Array<{ jobRoleId?: string | null }>) {
  const roles = plannedRoles || [];
  const rows = roles.map(role => {
    const ids = new Set(role.roleIds.length ? role.roleIds : [role.id]);
    return { role, selected: selected.filter(person => person.jobRoleId && ids.has(person.jobRoleId)).length };
  });
  const planned = plannedRoleIdSet(roles);
  const outsidePlan = selected.filter(person => !person.jobRoleId || !planned.has(person.jobRoleId)).length;
  return { rows, outsidePlan };
}

export function toggleMissionCollaborator(selectedIds: string[], collaboratorId: string, selected: boolean): string[] {
  if (selected) return selectedIds.includes(collaboratorId) ? selectedIds : [...selectedIds, collaboratorId];
  return selectedIds.filter(id => id !== collaboratorId);
}

export function synchronizeMissionAllocationPeriods(
  selectedIds: string[],
  periods: MissionAllocationPeriodDraft[],
  missionStartDate: string,
  missionEndDate: string
): MissionAllocationPeriodDraft[] {
  const periodByCollaboratorId = new Map(periods.map(period => [period.collaboratorId, period]));
  return [...new Set(selectedIds)].map(collaboratorId => periodByCollaboratorId.get(collaboratorId) || {
    collaboratorId,
    mobilizationDate: missionStartDate,
    demobilizationDate: missionEndDate
  });
}

export function shiftDefaultMissionAllocationPeriods(
  periods: MissionAllocationPeriodDraft[],
  previous: { startDate: string; endDate: string },
  next: { startDate: string; endDate: string }
): MissionAllocationPeriodDraft[] {
  return periods.map(period => ({
    ...period,
    mobilizationDate: period.mobilizationDate === previous.startDate ? next.startDate : period.mobilizationDate,
    demobilizationDate: period.demobilizationDate === previous.endDate ? next.endDate : period.demobilizationDate
  }));
}
