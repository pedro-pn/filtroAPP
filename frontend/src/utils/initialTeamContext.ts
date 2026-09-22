import type { ProjectWorkflow } from '../api/projectWorkflow';
import { projectExecutionSchedule } from './projectExecutionSchedule';
import type { InitialTeamContext, PlannedTeamRole } from './missionTeam';

/**
 * Reúne o que a definição da equipe apenas reflete do fluxo de gestão: o Líder de Projetos, as datas da obra
 * (Handover e análise inicial) e os cargos previstos no planejamento D-30.
 */
export function buildInitialTeamContext(workflow: Pick<ProjectWorkflow,
  'leaderUserId' | 'leader' | 'plannedMobilizationDate' | 'commercialExpectedMobilizationDate' | 'commercialExpectedStartDate'
  | 'commercialExpectedDurationDays' | 'plannedExecutionStartDate' | 'plannedExecutionEndDate' | 'resourcePlanning'>): InitialTeamContext {
  const schedule = projectExecutionSchedule(workflow);
  const team = workflow.resourcePlanning?.team;
  const plannedRoles: PlannedTeamRole[] = (team?.demands || []).map(demand => {
    const catalogRole = (team?.catalog || []).find(role => role.id === demand.jobRoleId);
    return {
      id: demand.jobRoleId,
      name: demand.jobRoleName,
      requiredCount: demand.requiredCount,
      roleIds: catalogRole?.roleIds?.length ? catalogRole.roleIds : [demand.jobRoleId]
    };
  });
  return {
    leaderUserId: workflow.leaderUserId,
    leaderName: workflow.leader?.name || '',
    mobilizationDate: schedule.mobilizationDate,
    executionStartDate: schedule.executionStartDate,
    executionEndDate: schedule.executionEndDate,
    plannedRoles
  };
}
