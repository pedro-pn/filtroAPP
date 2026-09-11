import { planningError } from '../planning/errors.js';
import {
  projectWorkflowMobilizationAuthorization,
  projectWorkflowMobilizationGate
} from './rules.js';

export const PROJECT_MOBILIZATION_NOT_AUTHORIZED = 'PROJECT_MOBILIZATION_NOT_AUTHORIZED';

export const PROJECT_OPERATIONAL_GATE_INCLUDE = {
  checklists: { select: { key: true, status: true } },
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

function authorizationInstruction(status) {
  if (status === 'SUSPENDED') return 'Autorização suspensa: revalidar a mobilização na Gestão de Projetos';
  return 'Autorização não emitida: autorizar a mobilização na Gestão de Projetos';
}

export function projectOperationalMobilizationDecisionFromWorkflow(workflow, projectId = workflow?.projectId) {
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

  const gate = projectWorkflowMobilizationGate(workflow);
  const authorization = projectWorkflowMobilizationAuthorization(workflow, gate);
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
  return projectOperationalMobilizationDecisionFromWorkflow(workflow, projectId);
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
