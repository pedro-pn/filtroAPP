import type { PlanningMission } from '../api/efetivoPlanning';

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

export function toggleMissionCollaborator(selectedIds: string[], collaboratorId: string, selected: boolean): string[] {
  if (selected) return selectedIds.includes(collaboratorId) ? selectedIds : [...selectedIds, collaboratorId];
  return selectedIds.filter(id => id !== collaboratorId);
}
