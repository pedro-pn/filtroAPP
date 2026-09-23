import { planningError } from '../planning/errors.js';
import {
  PROJECT_WORKFLOW_CLIENT_RELEASES,
  PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS,
  PROJECT_WORKFLOW_TEAM_MEMBER_CHECKS
} from '../../../../../shared/schemas/project-workflow.js';
import {
  projectWorkflowMobilizationAuthorization,
  projectWorkflowMobilizationGate
} from './rules.js';

export const PROJECT_MOBILIZATION_NOT_AUTHORIZED = 'PROJECT_MOBILIZATION_NOT_AUTHORIZED';

export const PROJECT_OPERATIONAL_GATE_INCLUDE = {
  checklists: { select: { key: true, status: true } },
  teamMemberChecks: { select: { collaboratorId: true, key: true, status: true } },
  preparationItemChecks: { select: { itemType: true, itemId: true, key: true, status: true } },
  equipmentCategoryPlans: {
    select: {
      equipmentIds: true,
      category: { select: { equipment: { where: { isActive: true }, select: { id: true } } } }
    }
  },
  clientReleases: { select: { key: true, attendanceDate: true, attendanceConfirmedAt: true, requested: true, requestedAt: true, requestedTo: true, completed: true, completedAt: true } },
  criticalAnswers: { select: { key: true, answer: true } },
  issues: { select: { id: true, sourceQuestion: true, status: true, dueDate: true, criticality: true, area: true, description: true } },
  commercialFacts: { select: { key: true, status: true, source: true, reference: true, note: true, occurredOn: true } },
  documentationCategories: {
    select: {
      type: true,
      required: true,
      requirements: { select: { id: true, name: true, status: true, requestedAt: true, confirmedAt: true, archivedAt: true } }
    }
  }
};

export const PROJECT_OPERATIONAL_GATE_MISSION_QUERY = {
  where: { deletedAt: null, scheduleStatus: { not: 'CANCELLED' }, plan: { kind: 'OFFICIAL', status: 'ACTIVE' } },
  orderBy: { updatedAt: 'desc' },
  take: 1,
  select: {
    allocations: {
      where: { deletedAt: null },
      select: { collaboratorId: true, collaborator: { select: { name: true } } }
    }
  }
};

function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10) || null;
}

function workflowWithPreparationData(workflow, mission = null) {
  if (!workflow) return workflow;
  const teamPreparation = workflow.teamPreparation?.members
    ? workflow.teamPreparation
    : (() => {
        const records = new Map((workflow.teamMemberChecks || []).map(item => [`${item.collaboratorId}:${item.key}`, item]));
        const members = (mission?.allocations || []).map(allocation => ({
          collaboratorId: allocation.collaboratorId,
          name: allocation.collaborator?.name || 'Colaborador',
          checks: PROJECT_WORKFLOW_TEAM_MEMBER_CHECKS.map(definition => ({
            key: definition.key,
            label: definition.label,
            status: records.get(`${allocation.collaboratorId}:${definition.key}`)?.status || 'PENDING'
          }))
        }));
        return { defined: members.length > 0, members };
      })();
  const clientReleases = workflow.clientReleases?.attendance
    ? workflow.clientReleases
    : (() => {
        const records = new Map((Array.isArray(workflow.clientReleases) ? workflow.clientReleases : []).map(item => [item.key, item]));
        const attendance = records.get('ATTENDANCE_CONFIRMATION');
        return {
          attendance: {
            date: dateKey(attendance?.attendanceDate) || dateKey(workflow.commercialExpectedStartDate) || dateKey(workflow.plannedMobilizationDate),
            confirmed: Boolean(attendance?.attendanceConfirmedAt)
          },
          items: PROJECT_WORKFLOW_CLIENT_RELEASES.map(definition => {
            const record = records.get(definition.key);
            return {
              ...definition,
              requested: record?.requested === true,
              requestedAt: dateKey(record?.requestedAt),
              requestedTo: record?.requestedTo || null,
              completed: record?.completed === true,
              completedAt: dateKey(record?.completedAt)
            };
          })
        };
      })();
  const preparationResources = workflow.preparationResources?.equipment
    ? workflow.preparationResources
    : (() => {
        const records = new Map((workflow.preparationItemChecks || []).map(item => [
          `${item.itemType}:${item.itemId}:${item.key}`,
          item
        ]));
        const checksFor = (itemType, itemId) => PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS[itemType].map(definition => ({
          key: definition.key,
          label: definition.label,
          status: records.get(`${itemType}:${itemId}:${definition.key}`)?.status || 'PENDING'
        }));
        const equipmentIds = [...new Set((workflow.equipmentCategoryPlans || []).flatMap(plan => {
          const storedIds = Array.isArray(plan.equipmentIds) ? plan.equipmentIds : [];
          return storedIds.length ? storedIds : (plan.category?.equipment || []).map(item => item.id);
        }))];
        const materialIds = Array.isArray(workflow.supplyPlan) ? workflow.supplyPlan.map(item => item.id) : [];
        return {
          equipment: {
            defined: equipmentIds.length > 0,
            items: equipmentIds.map(id => ({ id, name: 'Equipamento reservado', checks: checksFor('EQUIPMENT', id) }))
          },
          materials: {
            defined: materialIds.length > 0,
            items: materialIds.map(id => ({
              id,
              name: workflow.supplyPlan.find(item => item.id === id)?.name || 'Material programado',
              checks: checksFor('MATERIAL', id)
            }))
          }
        };
      })();
  return { ...workflow, teamPreparation, clientReleases, preparationResources };
}

function authorizationInstruction() {
  return 'Projeto não autorizado: resolva os bloqueios do gate de mobilização na Gestão de Projetos';
}

export function projectOperationalMobilizationDecisionFromWorkflow(workflow, projectId = workflow?.projectId, mission = null) {
  if (!workflow) {
    return {
      projectId,
      enforced: false,
      allowed: true,
      status: 'LEGACY_NOT_ENFORCED',
      authorizationStatus: null,
      blockers: []
    };
  }

  const preparedWorkflow = workflowWithPreparationData(workflow, mission);
  const gate = projectWorkflowMobilizationGate(preparedWorkflow);
  const authorization = projectWorkflowMobilizationAuthorization(preparedWorkflow, gate);
  return {
    projectId,
    enforced: true,
    allowed: authorization.authorized,
    status: authorization.authorized ? 'AUTHORIZED' : 'BLOCKED',
    authorizationStatus: authorization.status,
    authorizedAt: authorization.authorizedAt,
    authorizedVersion: authorization.authorizedVersion,
    currentVersion: authorization.currentVersion,
    blockers: gate.blockers
  };
}

export async function projectOperationalMobilizationDecision(database, projectId) {
  const workflow = await database.projectWorkflow.findUnique({
    where: { projectId },
    include: PROJECT_OPERATIONAL_GATE_INCLUDE
  });
  const mission = workflow && database.efetivoMissionPlan?.findFirst
    ? await database.efetivoMissionPlan.findFirst({
        where: { ...PROJECT_OPERATIONAL_GATE_MISSION_QUERY.where, projectId },
        orderBy: PROJECT_OPERATIONAL_GATE_MISSION_QUERY.orderBy,
        select: PROJECT_OPERATIONAL_GATE_MISSION_QUERY.select
      })
    : null;
  return projectOperationalMobilizationDecisionFromWorkflow(workflowWithPreparationData(workflow, mission), projectId);
}

export async function assertProjectMobilizationAuthorized(database, projectId) {
  const decision = await projectOperationalMobilizationDecision(database, projectId);
  if (decision.allowed) return decision;

  const issues = [
    { message: authorizationInstruction(decision.authorizationStatus) },
    ...decision.blockers.map(item => ({ message: `${item.label}: ${item.reason}` }))
  ];
  const error = planningError(
    'A mobilização deste projeto não está autorizada. Resolva os bloqueios na Gestão de Projetos.',
    { statusCode: 409, code: PROJECT_MOBILIZATION_NOT_AUTHORIZED, issues }
  );
  error.mobilizationControl = decision;
  throw error;
}
