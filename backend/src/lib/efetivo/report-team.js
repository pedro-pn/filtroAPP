import { hasModuleRole } from '../module-roles.js';
import { planningError } from './planning/errors.js';

export const reportOperatorUserSelect = { id: true, isActive: true, accountType: true, role: true, moduleRoles: true };

export function canOperateReports(collaborator) {
  const user = collaborator?.user;
  return Boolean(collaborator?.isActive && user?.isActive
    && ['INTERNAL', 'ADMIN'].includes(user.accountType)
    && hasModuleRole(user, ['rdo:manager', 'rdo:coordinator', 'rdo:collaborator']));
}

export function validateMissionReportOperator(mission, operatorId) {
  if (!operatorId) {
    throw planningError('Selecione o operador responsável pelo relatório.', {
      code: 'PROJECT_WORKFLOW_REPORT_OPERATOR_REQUIRED'
    });
  }
  const team = (mission?.allocations || []).filter(allocation => !allocation.deletedAt && canOperateReports(allocation.collaborator));
  if (!team.some(allocation => allocation.collaboratorId === operatorId)) {
    throw planningError('Selecione um colaborador da missão com conta interna ativa e acesso ao módulo Relatório.', {
      code: 'INVALID_PROJECT_WORKFLOW_REPORT_OPERATOR'
    });
  }
  return team;
}

export async function assignMissionReportTeam(tx, projectId, operatorId, team, startDate) {
  await tx.project.update({
    where: { id: projectId },
    data: { startDate: new Date(`${startDate}T00:00:00.000Z`), operatorId }
  });
  // Managers and coordinators already see every project. Explicit project
  // authorizations use the existing collaborator RDO account contract.
  const userIds = [...new Set(team
    .map(allocation => allocation.collaborator.user)
    .filter(user => user.role === 'COLLABORATOR' && hasModuleRole(user, 'rdo:collaborator'))
    .map(user => user.id))];
  if (userIds.length) {
    await tx.projectAuthorizedUser.createMany({
      data: userIds.map(userId => ({ projectId, userId })),
      skipDuplicates: true
    });
  }
}
