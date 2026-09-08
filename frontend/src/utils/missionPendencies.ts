import type { PendingMissionProject, PlanningMission } from '../api/efetivoPlanning';
import { missionCoveredDemand } from './missionAllocationPeriod';

// O que ainda falta o gestor preencher numa programação já criada. Enquanto houver
// pendência o card fica destacado em amarelo na aba Missões.
export function missionPendencies(mission: PlanningMission): string[] {
  if (mission.scheduleStatus === 'CANCELLED') return [];
  const pendencies: string[] = [];
  const required = mission.demands.reduce((sum, demand) => sum + demand.requiredCount, 0);
  const coveredDemand = missionCoveredDemand(mission);
  if (!mission.headquartersResponsibleUserId || !mission.headquartersResponsibleCollaboratorId) pendencies.push('Vincular o líder');
  if (!required) pendencies.push('Selecionar a equipe');
  else if (coveredDemand < required) pendencies.push(`Completar a equipe (${coveredDemand}/${required})`);
  if (mission.scheduleStatus === 'DRAFT') pendencies.push('Confirmar a programação');
  return pendencies;
}

// Projeto cadastrado que ainda não virou programação: todas as informações operacionais faltam.
export const PENDING_PROJECT_PENDENCIES = [
  'Informar mobilização e execução',
  'Vincular o líder',
  'Selecionar os colaboradores da equipe'
];

export function countMissionPendencies(missions: PlanningMission[], pendingProjects: PendingMissionProject[]) {
  return pendingProjects.length + missions.filter(mission => missionPendencies(mission).length > 0).length;
}

// Datas do projeto canônico servem de sugestão inicial para a programação.
export function prefillDatesFromProject(project: Pick<PendingMissionProject, 'mobilizationDate' | 'startDate'>) {
  const mobilization = project.mobilizationDate?.slice(0, 10) || '';
  const execution = project.startDate?.slice(0, 10) || mobilization;
  return {
    mobilizationDate: mobilization || execution,
    executionStartDate: execution,
    executionEndDate: '',
    returnDate: ''
  };
}
