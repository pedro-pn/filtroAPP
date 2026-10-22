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
  const team = (mission?.allocations || []).filter(allocation => !allocation.deletedAt && canOperateReports(allocation.collaborator));
  if (!operatorId && !team.length) return team;
  if (!operatorId) {
    throw planningError('Selecione o operador responsável pelo relatório.', {
      code: 'PROJECT_WORKFLOW_REPORT_OPERATOR_REQUIRED'
    });
  }
  if (!team.some(allocation => allocation.collaboratorId === operatorId)) {
    throw planningError('Selecione um colaborador da missão com conta interna ativa e acesso ao módulo Relatório.', {
      code: 'INVALID_PROJECT_WORKFLOW_REPORT_OPERATOR'
    });
  }
  return team;
}

export async function assignMissionReportTeam(tx, projectId, operatorId, team, startDate, contractManagerUserId) {
  // O Gestor de Contrato é uma conta, que pode não ter cadastro como colaborador.
  // Mantemos o operador de campo separado para que a pendência continue visível.
  const defaultResponsible = !operatorId && contractManagerUserId ? await tx.user.findFirst({
    where: { id: contractManagerUserId, isActive: true, accountType: { in: ['INTERNAL', 'ADMIN'] } },
    select: { id: true }
  }) : null;
  await tx.project.update({
    where: { id: projectId },
    data: {
      startDate: new Date(`${startDate}T00:00:00.000Z`), operatorId: operatorId || null,
      defaultReportResponsibleUserId: defaultResponsible?.id || null
    }
  });
  if (!operatorId) {
    const dedupeKey = `execution-without-report-operator:${projectId}:${startDate}`;
    await tx.notificationEvent.upsert({
      where: { dedupeKey },
      create: { kind: 'EXECUTION_WITHOUT_REPORT_OPERATOR', dedupeKey, projectId, data: { startDate, defaultResponsibleUserId: defaultResponsible?.id || null } },
      update: {}
    });
  }
  // Managers and coordinators already see every project. Explicit project
  // authorizations use the existing collaborator RDO account contract.
  const userIds = [...new Set([...team
    .map(allocation => allocation.collaborator.user)
    .filter(user => user.role === 'COLLABORATOR' && hasModuleRole(user, 'rdo:collaborator'))
    .map(user => user.id), ...(defaultResponsible ? [defaultResponsible.id] : [])])];
  if (userIds.length) {
    await tx.projectAuthorizedUser.createMany({
      data: userIds.map(userId => ({ projectId, userId })),
      skipDuplicates: true
    });
  }
}
