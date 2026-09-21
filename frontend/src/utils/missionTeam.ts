import type { MissionScheduleStatus, PlanningMission } from '../api/efetivoPlanning';

export type CollaboratorActivityFilter = 'ACTIVE' | 'INACTIVE' | 'ALL';

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
