import {
  PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_STAGES,
  PROJECT_WORKFLOW_CRITICAL_QUESTIONS,
  projectWorkflowMilestones
} from '../../../../../shared/schemas/project-workflow.js';
import { canEditEfetivoChecklistArea } from '../access.js';
import { hasModuleRole } from '../../module-roles.js';
import { efetivoProjectWhere } from '../project-visibility.js';
import { conflictError, notFound, planningError } from '../planning/errors.js';
import { resolvePlanningDatabase, runPlanningTransaction } from '../planning/plan-context.js';
import {
  synchronizeOfficialMissionDemobilization,
  synchronizeOfficialMissionStage
} from '../planning/mission-stage-sync.js';
import {
  activeProjectWorkflowIssues,
  allowedProjectWorkflowTransition,
  handoverGateIssues,
  normalizeProjectWorkflowCommercialFacts,
  normalizeProjectWorkflowDocumentation,
  projectWorkflowCommercialReadiness,
  projectWorkflowCloseoutReadiness,
  projectWorkflowClosureGate,
  projectWorkflowClosureReadiness,
  projectWorkflowDemobilizationReadiness,
  projectWorkflowDocumentationReadiness,
  projectWorkflowMobilizationAuthorization,
  projectWorkflowMobilizationGate,
  projectWorkflowPlanningReadiness,
  projectWorkflowPostJobReadiness,
  projectWorkflowPreparationReadiness,
  projectWorkflowTransitionIssues
} from './rules.js';
import { synchronizePostJobQualityRecord } from './post-job-quality.js';
import { projectDocumentReadiness, projectDocumentRequirements } from './documents.js';
import {
  emptyProjectWorkflowResourcePlanning,
  loadProjectWorkflowResourcePlanning
} from './resource-planning.js';

const PAGE_SIZE = 100;
const SAO_PAULO_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const PROJECT_FIELDS = {
  id: true,
  code: true,
  name: true,
  clientName: true,
  clientEmailPrimary: true,
  location: true,
  mobilizationDate: true,
  demobilizationDate: true
};
const POST_JOB_INCLUDE = {
  qualityRecord: { select: { id: true, number: true, deletedAt: true } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } }
};
const MEASUREMENT_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } }
};
const PROJECT_GATE_DOCUMENT_SELECT = {
  id: true,
  projectId: true,
  type: true,
  title: true,
  requirementStage: true,
  acceptanceMode: true,
  archivedAt: true,
  currentVersion: {
    select: {
      id: true,
      documentId: true,
      contentKind: true,
      storagePath: true,
      externalUrl: true,
      acceptanceStatus: true,
      signatureDocument: {
        select: { status: true, finalStoragePath: true, deletedAt: true }
      }
    }
  }
};
const OPERATIONAL_MISSION_QUERY = {
  where: { deletedAt: null, scheduleStatus: { not: 'CANCELLED' }, plan: { kind: 'OFFICIAL', status: 'ACTIVE' } },
  orderBy: { updatedAt: 'desc' },
  take: 1,
  select: {
    id: true,
    stage: true,
    scheduleStatus: true,
    version: true,
    kanbanOrder: true,
    mobilizationDate: true,
    executionStartDate: true,
    executionEndDate: true,
    returnDate: true,
    headquartersResponsibleName: true,
    headquartersResponsibleRole: true,
    headquartersResponsibleCollaboratorId: true,
    allocations: {
      where: { deletedAt: null },
      select: {
        id: true,
        collaboratorId: true,
        jobRoleId: true,
        collaborator: {
          select: {
            id: true,
            name: true,
            isActive: true,
            jobRole: { select: { id: true, name: true } }
          }
        },
        jobRole: { select: { id: true, name: true } }
      }
    }
  }
};
const WORKFLOW_INCLUDE = {
  leader: { select: { id: true, name: true, isActive: true } },
  closedBy: { select: { id: true, name: true } },
  checklists: { include: { updatedBy: { select: { id: true, name: true } } }, orderBy: { key: 'asc' } },
  criticalAnswers: { include: { updatedBy: { select: { id: true, name: true } } }, orderBy: { key: 'asc' } },
  commercialFacts: { include: { updatedBy: { select: { id: true, name: true } } }, orderBy: { key: 'asc' } },
  documentationCategories: {
    include: {
      updatedBy: { select: { id: true, name: true } },
      requirements: {
        include: {
          createdBy: { select: { id: true, name: true } },
          updatedBy: { select: { id: true, name: true } },
          history: { include: { actor: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } }
        },
        orderBy: { createdAt: 'asc' }
      }
    },
    orderBy: { type: 'asc' }
  },
  teamDemands: {
    include: { jobRole: { select: { id: true, name: true, calendarColor: true } } },
    orderBy: { jobRole: { order: 'asc' } }
  },
  equipmentCategoryPlans: {
    include: { category: { select: { id: true, name: true, order: true } } },
    orderBy: { category: { order: 'asc' } }
  },
  issues: { orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }] },
  events: {
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50
  },
  postJob: { include: POST_JOB_INCLUDE },
  measurement: { include: MEASUREMENT_INCLUDE }
};

const POST_JOB_FIELDS = [
  'fieldLeaderFeedback',
  'teamFeedback',
  'problemsFound',
  'solutionsAdopted',
  'improvementOpportunities',
  'lessonsLearned',
  'equipmentFeedback',
  'planningFeedback'
];
const MEASUREMENT_TEXT_FIELDS = ['quantitiesSummary', 'additionalServicesNote', 'evidenceNote'];
const MEASUREMENT_AMOUNT_FIELDS = ['executedAmount', 'measuredAmount', 'approvedAmount'];
const MEASUREMENT_DATE_FIELDS = ['preparedAt', 'sentAt', 'approvedAt'];

function utcDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10) || null;
}

function todayKey(now = new Date()) {
  return SAO_PAULO_DATE_FORMATTER.format(now);
}

function projectServiceTypes(project) {
  const values = (project?.plannedServices || []).map(item => String(item.serviceType || '').trim()).filter(Boolean);
  if (!values.length && project?.name) values.push(String(project.name).trim());
  return [...new Set(values)];
}

function publicPostJob(postJob, serviceTypes = []) {
  return {
    meetingDate: dateKey(postJob?.meetingDate),
    fieldLeaderFeedback: postJob?.fieldLeaderFeedback || null,
    teamFeedback: postJob?.teamFeedback || null,
    problemsFound: postJob?.problemsFound || null,
    solutionsAdopted: postJob?.solutionsAdopted || null,
    improvementOpportunities: postJob?.improvementOpportunities || null,
    lessonsLearned: postJob?.lessonsLearned || null,
    equipmentFeedback: postJob?.equipmentFeedback || null,
    planningFeedback: postJob?.planningFeedback || null,
    serviceTypes: postJob?.serviceTypes?.length ? postJob.serviceTypes : serviceTypes,
    qualityRecord: postJob?.qualityRecord && !postJob.qualityRecord.deletedAt
      ? { id: postJob.qualityRecord.id, number: postJob.qualityRecord.number }
      : null,
    createdAt: postJob?.createdAt || null,
    updatedAt: postJob?.updatedAt || null,
    createdBy: postJob?.createdBy || null,
    updatedBy: postJob?.updatedBy || null
  };
}

function decimalNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function publicMeasurement(measurement) {
  return {
    quantitiesSummary: measurement?.quantitiesSummary || null,
    additionalServicesNote: measurement?.additionalServicesNote || null,
    evidenceNote: measurement?.evidenceNote || null,
    executedAmount: decimalNumber(measurement?.executedAmount),
    measuredAmount: decimalNumber(measurement?.measuredAmount),
    approvedAmount: decimalNumber(measurement?.approvedAmount),
    preparedAt: dateKey(measurement?.preparedAt),
    sentAt: dateKey(measurement?.sentAt),
    approvedAt: dateKey(measurement?.approvedAt),
    createdAt: measurement?.createdAt || null,
    updatedAt: measurement?.updatedAt || null,
    createdBy: measurement?.createdBy || null,
    updatedBy: measurement?.updatedBy || null
  };
}

function operationalMissionSummary(project) {
  const mission = project?.efetivoMissionPlans?.[0];
  if (!mission) return null;
  return {
    id: mission.id,
    stage: mission.stage,
    scheduleStatus: mission.scheduleStatus,
    version: mission.version,
    kanbanOrder: mission.kanbanOrder,
    mobilizationDate: dateKey(mission.mobilizationDate),
    executionStartDate: dateKey(mission.executionStartDate),
    executionEndDate: dateKey(mission.executionEndDate),
    returnDate: dateKey(mission.returnDate),
    headquartersResponsibleName: mission.headquartersResponsibleName,
    headquartersResponsibleRole: mission.headquartersResponsibleRole,
    headquartersResponsibleCollaboratorId: mission.headquartersResponsibleCollaboratorId,
    participantCount: mission.allocations?.length || 0,
    allocations: (mission.allocations || []).map(allocation => ({
      id: allocation.id,
      collaboratorId: allocation.collaboratorId,
      jobRoleId: allocation.jobRoleId,
      collaborator: allocation.collaborator ? {
        id: allocation.collaborator.id,
        name: allocation.collaborator.name,
        isActive: allocation.collaborator.isActive,
        role: allocation.collaborator.jobRole?.name || allocation.jobRole?.name || ''
      } : null,
      jobRole: allocation.jobRole
    }))
  };
}

function eligibleProjectWhere(extra = {}) {
  return { isActive: true, deletedAt: null, ...efetivoProjectWhere(), ...extra };
}

function contextIsManager(context) {
  return context.isManager === true || context.user?.accountType === 'ADMIN' || hasModuleRole(context.user, 'efetivo:manager');
}

function contextIsOperational(context) {
  return contextIsManager(context)
    || hasModuleRole(context.user, ['efetivo:manager', 'efetivo:viewer']);
}

export function canEditWorkflow(workflow, context) {
  return contextIsManager(context) || Boolean(
    contextIsOperational(context)
    && context.actorUserId
    && workflow?.leaderUserId === context.actorUserId
  );
}

function checklistIsAvailable(workflow, definition) {
  if (definition?.stage == null || definition.stage === workflow?.stage) return true;
  return definition?.stage === 'PREPARATION' && workflow?.stage === 'READY_TO_MOBILIZE';
}

function canEditChecklist(workflow, definition, context) {
  if (!workflow || !definition || !checklistIsAvailable(workflow, definition)) return false;
  return canEditWorkflow(workflow, context)
    || canEditEfetivoChecklistArea(context.user, definition.areaRoles);
}

function publicPermissions(workflow, context) {
  const manager = contextIsManager(context);
  const isLeader = Boolean(contextIsOperational(context) && context.actorUserId && workflow?.leaderUserId === context.actorUserId);
  const canManage = Boolean(workflow && (manager || isLeader));
  const finished = workflow?.stage === 'FINISHED';
  return {
    canInitialize: manager && !workflow,
    canEdit: canManage && !finished,
    canReopen: canManage && finished,
    canAccept: Boolean(workflow && isLeader && !workflow.acceptedAt && workflow.stage === 'HANDOVER'),
    canChangeLeader: Boolean(workflow && manager && !finished),
    canEditCommercial: false,
    canAuthorizeMobilization: Boolean(workflow && (manager || isLeader) && ['READY_TO_MOBILIZE', 'MOBILIZATION', 'EXECUTION', 'DEMOBILIZATION'].includes(workflow.stage))
  };
}

function projectDocumentGateState(documents = []) {
  const activeDocuments = documents.filter(document => !document.archivedAt);
  return {
    documentRequirements: projectDocumentRequirements(activeDocuments)
  };
}

function publicDocumentationCategories(workflow) {
  return normalizeProjectWorkflowDocumentation(workflow).map(category => ({
    ...category,
    requirements: category.requirements.map(requirement => ({
      ...requirement,
      requestedAt: dateKey(requirement.requestedAt),
      confirmedAt: dateKey(requirement.confirmedAt),
      history: (requirement.history || []).map(entry => ({
        ...entry,
        changes: entry.changes || {},
        actor: entry.actor || null
      }))
    }))
  }));
}

async function loadProjectDocumentGateState(database, projectId) {
  if (!database.projectDocument?.findMany) return projectDocumentGateState();
  const documents = await database.projectDocument.findMany({
    where: { projectId, archivedAt: null },
    select: PROJECT_GATE_DOCUMENT_SELECT
  });
  return projectDocumentGateState(documents);
}

function decorateWorkflow(workflow, context, now, demobilizationDate = null, serviceTypes = [], relatedPostJobs = [], documents = [], resourcePlanning = null) {
  if (!workflow) return null;
  const documentState = projectDocumentGateState(documents);
  const workflowWithDocuments = { ...workflow, ...documentState };
  const today = todayKey(now);
  const milestones = projectWorkflowMilestones(dateKey(workflow.plannedMobilizationDate), today);
  const checklistByKey = new Map((workflow.checklists || []).map(item => [item.key, item]));
  const answerByKey = new Map((workflow.criticalAnswers || []).map(item => [item.key, item]));
  const checklists = PROJECT_WORKFLOW_CHECKLISTS.map(definition => ({
    ...definition,
    status: 'PENDING',
    note: null,
    updatedAt: null,
    updatedBy: null,
    ...checklistByKey.get(definition.key),
    canEdit: canEditChecklist(workflow, definition, context)
  }));
  const criticalAnswers = PROJECT_WORKFLOW_CRITICAL_QUESTIONS.map(definition => ({
    ...definition,
    answer: null,
    updatedAt: null,
    updatedBy: null,
    ...answerByKey.get(definition.key)
  }));
  const commercialFacts = normalizeProjectWorkflowCommercialFacts(workflow).map(fact => ({
    ...fact,
    occurredOn: dateKey(fact.occurredOn)
  }));
  const commercialReadiness = projectWorkflowCommercialReadiness({ commercialFacts });
  const documentationCategories = publicDocumentationCategories(workflow);
  const issues = activeProjectWorkflowIssues(workflow).map(issue => ({
    ...issue,
    dueDate: dateKey(issue.dueDate),
    overdue: issue.status !== 'RESOLVED' && Boolean(issue.dueDate) && dateKey(issue.dueDate) < today
  }));
  const documentationReadiness = projectWorkflowDocumentationReadiness({ documentationCategories }, milestones, today);
  const planningReadiness = projectWorkflowPlanningReadiness({ ...workflow, checklists });
  const preparationReadiness = projectWorkflowPreparationReadiness({ checklists });
  const demobilizationReadiness = projectWorkflowDemobilizationReadiness({ checklists });
  const postJobReadiness = projectWorkflowPostJobReadiness({ checklists });
  const closeoutReadiness = projectWorkflowCloseoutReadiness({ checklists });
  const closureReadiness = projectWorkflowClosureReadiness({ checklists });
  const closureGate = projectWorkflowClosureGate({ ...workflowWithDocuments, checklists, issues });
  const mobilizationGate = projectWorkflowMobilizationGate({ ...workflowWithDocuments, checklists, commercialFacts, documentationCategories, issues }, milestones, today);
  const mobilizationAuthorization = projectWorkflowMobilizationAuthorization(workflow, mobilizationGate);
  const permissions = publicPermissions(workflow, context);
  const transitionOptions = PROJECT_WORKFLOW_STAGES
    .filter(stage => allowedProjectWorkflowTransition(workflow.stage, stage))
    .map(stage => {
      const gateIssues = projectWorkflowTransitionIssues({ ...workflowWithDocuments, checklists, commercialFacts, documentationCategories, issues, demobilizationDate }, stage);
      const hasPermission = workflow.stage === 'FINISHED' && stage === 'FINAL_MEASUREMENT'
        ? permissions.canReopen
        : permissions.canEdit;
      const permissionIssues = hasPermission ? [] : ['Somente o gestor ou o Líder de Projetos pode alterar a etapa'];
      const transitionIssues = [...permissionIssues, ...gateIssues];
      return { stage, allowed: transitionIssues.length === 0, issues: transitionIssues };
    });
  const handoverIssues = handoverGateIssues({ ...workflowWithDocuments, checklists, commercialFacts });
  return {
    ...workflow,
    plannedMobilizationDate: dateKey(workflow.plannedMobilizationDate),
    commercialExpectedMobilizationDate: dateKey(workflow.commercialExpectedMobilizationDate),
    commercialExpectedStartDate: dateKey(workflow.commercialExpectedStartDate),
    analysisClientContactDate: dateKey(workflow.analysisClientContactDate),
    fieldCompletionDate: dateKey(workflow.fieldCompletionDate),
    demobilizationDate: dateKey(demobilizationDate),
    checklists,
    criticalAnswers,
    commercialFacts,
    commercialReadiness,
    documentationCategories,
    documentRequirements: documentState.documentRequirements,
    documentationReadiness,
    resourcePlanning: resourcePlanning || emptyProjectWorkflowResourcePlanning(workflow),
    planningReadiness,
    preparationReadiness,
    demobilizationReadiness,
    postJobReadiness,
    postJob: publicPostJob(workflow.postJob, serviceTypes),
    closeoutReadiness,
    closureReadiness,
    closureGate,
    measurement: publicMeasurement(workflow.measurement),
    relatedPostJobs,
    mobilizationGate,
    mobilizationAuthorization,
    issues,
    milestones,
    permissions,
    handoverGate: { ready: handoverIssues.length === 0, issues: handoverIssues },
    transitionOptions
  };
}

async function findEligibleProject(database, projectId, { workflow = false } = {}) {
  return database.project.findFirst({
    where: eligibleProjectWhere({ id: projectId }),
    select: {
      ...PROJECT_FIELDS,
      plannedServices: { select: { serviceType: true }, orderBy: { order: 'asc' } },
      efetivoMissionPlans: OPERATIONAL_MISSION_QUERY,
      ...(workflow ? {
        workflow: { include: WORKFLOW_INCLUDE },
        documents: { where: { archivedAt: null }, select: PROJECT_GATE_DOCUMENT_SELECT }
      } : {})
    }
  });
}

async function relatedPostJobs(database, project) {
  if (!database.projectWorkflowPostJob?.findMany) return [];
  const services = projectServiceTypes(project);
  const clientName = String(project.clientName || '').trim();
  const matches = [
    ...(clientName ? [{ workflow: { project: { clientName: { equals: clientName, mode: 'insensitive' } } } }] : []),
    ...(services.length ? [{ serviceTypes: { hasSome: services } }] : [])
  ];
  if (!matches.length) return [];
  const rows = await database.projectWorkflowPostJob.findMany({
    where: {
      projectId: { not: project.id },
      OR: matches
    },
    select: {
      projectId: true,
      meetingDate: true,
      serviceTypes: true,
      problemsFound: true,
      solutionsAdopted: true,
      improvementOpportunities: true,
      lessonsLearned: true,
      equipmentFeedback: true,
      planningFeedback: true,
      qualityRecord: { select: { id: true, number: true, deletedAt: true } },
      workflow: { select: { project: { select: { code: true, name: true, clientName: true } } } }
    },
    orderBy: [{ meetingDate: 'desc' }, { updatedAt: 'desc' }],
    take: 10
  });
  const clientKey = clientName.toLocaleLowerCase('pt-BR');
  const serviceSet = new Set(services);
  return rows.map(row => {
    const relatedProject = row.workflow.project;
    const matchedServices = row.serviceTypes.filter(service => serviceSet.has(service));
    return {
      projectId: row.projectId,
      project: relatedProject,
      meetingDate: dateKey(row.meetingDate),
      serviceTypes: row.serviceTypes,
      matches: {
        sameClient: Boolean(clientKey && String(relatedProject.clientName || '').trim().toLocaleLowerCase('pt-BR') === clientKey),
        services: matchedServices
      },
      problemsFound: row.problemsFound,
      solutionsAdopted: row.solutionsAdopted,
      improvementOpportunities: row.improvementOpportunities,
      lessonsLearned: row.lessonsLearned,
      equipmentFeedback: row.equipmentFeedback,
      planningFeedback: row.planningFeedback,
      qualityRecord: row.qualityRecord && !row.qualityRecord.deletedAt
        ? { id: row.qualityRecord.id, number: row.qualityRecord.number }
        : null
    };
  });
}

async function requireEligibleLeader(database, leaderUserId) {
  const leader = await database.user.findFirst({
    where: {
      id: leaderUserId,
      isActive: true,
      OR: [
        { accountType: 'ADMIN' },
        { moduleRoles: { some: { module: 'EFETIVO', role: { in: ['EFETIVO_MANAGER', 'EFETIVO_VIEWER'] } } } }
      ]
    },
    select: { id: true, name: true, isActive: true }
  });
  if (!leader) throw planningError('Selecione uma conta ativa com acesso ao Efetivo.', { code: 'INVALID_PROJECT_WORKFLOW_LEADER' });
  return leader;
}

async function recordEvent(tx, projectId, actorUserId, action, data = null) {
  return tx.projectWorkflowEvent.create({
    data: { projectId, actorUserId: actorUserId || null, action, data }
  });
}

export async function listProjectWorkflows(filters = {}, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const page = filters.page || 1;
  const search = String(filters.search || '').trim();
  const where = eligibleProjectWhere({
    ...(search ? {
      OR: [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { clientName: { contains: search, mode: 'insensitive' } }
      ]
    } : {})
  });
  const [total, projects] = await Promise.all([
    database.project.count({ where }),
    database.project.findMany({
      where,
      select: {
        ...PROJECT_FIELDS,
        efetivoMissionPlans: OPERATIONAL_MISSION_QUERY,
        workflow: {
          include: {
            leader: { select: { id: true, name: true, isActive: true } },
            closedBy: { select: { id: true, name: true } },
            checklists: { select: { key: true, status: true } },
            criticalAnswers: { select: { key: true, answer: true } },
            issues: { select: { id: true, sourceQuestion: true, status: true, dueDate: true, criticality: true, area: true, description: true } },
            commercialFacts: { select: { key: true, status: true, source: true, evidenceDocumentId: true, reference: true, note: true, occurredOn: true } },
            documentationCategories: {
              select: {
                id: true,
                type: true,
                required: true,
                requirements: { select: { id: true, name: true, status: true, requestedAt: true, confirmedAt: true, archivedAt: true } }
              }
            },
            teamDemands: {
              select: {
                id: true,
                jobRoleId: true,
                requiredCount: true,
                jobRole: { select: { id: true, name: true, calendarColor: true } }
              }
            },
            equipmentCategoryPlans: {
              select: {
                id: true,
                categoryId: true,
                equipmentIds: true,
                category: { select: { id: true, name: true, order: true } }
              }
            },
            postJob: { select: { meetingDate: true, serviceTypes: true, qualityRecord: { select: { id: true, number: true, deletedAt: true } } } },
            measurement: { select: { executedAmount: true, measuredAmount: true, approvedAmount: true, preparedAt: true, sentAt: true, approvedAt: true } }
          }
        },
        documents: { where: { archivedAt: null }, select: PROJECT_GATE_DOCUMENT_SELECT }
      },
      orderBy: [{ workflow: { plannedMobilizationDate: 'asc' } }, { code: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE
    })
  ]);
  const now = dependencies.now || new Date();
  return {
    items: projects.map(project => {
      const workflow = project.workflow;
      const documentState = projectDocumentGateState(project.documents || []);
      const workflowWithDocuments = workflow ? { ...workflow, ...documentState } : null;
      const issues = workflow ? activeProjectWorkflowIssues(workflow) : [];
      const commercialReadiness = workflow ? projectWorkflowCommercialReadiness(workflowWithDocuments) : null;
      const milestones = workflow ? projectWorkflowMilestones(dateKey(workflow.plannedMobilizationDate), todayKey(now)) : null;
      const documentationReadiness = workflow ? projectWorkflowDocumentationReadiness(workflow, milestones, todayKey(now)) : null;
      const planningReadiness = workflow ? projectWorkflowPlanningReadiness(workflow) : null;
      const preparationReadiness = workflow ? projectWorkflowPreparationReadiness(workflow) : null;
      const demobilizationReadiness = workflow ? projectWorkflowDemobilizationReadiness(workflow) : null;
      const postJobReadiness = workflow ? projectWorkflowPostJobReadiness(workflow) : null;
      const closeoutReadiness = workflow ? projectWorkflowCloseoutReadiness(workflow) : null;
      const closureReadiness = workflow ? projectWorkflowClosureReadiness(workflow) : null;
      const closureGate = workflow ? projectWorkflowClosureGate(workflowWithDocuments) : null;
      const mobilizationGate = workflow ? projectWorkflowMobilizationGate(workflowWithDocuments, milestones, todayKey(now)) : null;
      const mobilizationAuthorization = workflow ? projectWorkflowMobilizationAuthorization(workflow, mobilizationGate) : null;
      return {
        id: project.id,
        code: project.code,
        name: project.name,
        clientName: project.clientName,
        location: project.location,
        operationalMission: operationalMissionSummary(project),
        workflow: workflow ? {
          projectId: workflow.projectId,
          stage: workflow.stage,
          leader: workflow.leader,
          acceptedAt: workflow.acceptedAt,
          closedAt: workflow.closedAt,
          closedBy: workflow.closedBy,
          plannedMobilizationDate: dateKey(workflow.plannedMobilizationDate),
          fieldCompletionDate: dateKey(workflow.fieldCompletionDate),
          demobilizationDate: dateKey(project.demobilizationDate),
          version: workflow.version,
          milestones,
          issueCount: issues.filter(item => item.status !== 'RESOLVED').length,
          overdueIssueCount: issues.filter(item => item.status !== 'RESOLVED' && item.dueDate && dateKey(item.dueDate) < todayKey(now)).length,
          commercialReadiness: commercialReadiness ? {
            status: commercialReadiness.status,
            resolvedCount: commercialReadiness.resolvedCount,
            totalCount: commercialReadiness.totalCount,
            blockedOperations: commercialReadiness.blockedOperations
          } : null,
          documentRequirements: documentState.documentRequirements,
          documentationReadiness,
          planningReadiness,
          preparationReadiness,
          demobilizationReadiness,
          postJobReadiness,
          postJob: publicPostJob(workflow.postJob),
          closeoutReadiness,
          closureReadiness,
          closureGate,
          measurement: publicMeasurement(workflow.measurement),
          mobilizationGate,
          mobilizationAuthorization
        } : null,
        permissions: publicPermissions(workflow, context)
      };
    }),
    total,
    page,
    pageSize: PAGE_SIZE
  };
}

export async function listProjectWorkflowLeaders(dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return database.user.findMany({
    where: {
      isActive: true,
      OR: [{ accountType: 'ADMIN' }, { moduleRoles: { some: { module: 'EFETIVO', role: { in: ['EFETIVO_MANAGER', 'EFETIVO_VIEWER'] } } } }]
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  });
}

export async function getProjectWorkflow(projectId, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const project = await findEligibleProject(database, projectId, { workflow: true });
  if (!project) throw notFound('Projeto não encontrado ou indisponível no Efetivo.');
  const services = projectServiceTypes(project);
  const history = project.workflow ? await relatedPostJobs(database, project) : [];
  const resourcePlanning = project.workflow?.stage === 'MOBILIZATION_PLANNING'
    ? await loadProjectWorkflowResourcePlanning(database, project.workflow)
    : emptyProjectWorkflowResourcePlanning(project.workflow || {});
  return {
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      clientName: project.clientName,
      clientEmailPrimary: project.clientEmailPrimary,
      location: project.location,
      mobilizationDate: dateKey(project.mobilizationDate),
      demobilizationDate: dateKey(project.demobilizationDate),
      operationalMission: operationalMissionSummary(project)
    },
    workflow: decorateWorkflow(
      project.workflow,
      context,
      dependencies.now || new Date(),
      project.demobilizationDate,
      services,
      history,
      project.documents || [],
      resourcePlanning
    ),
    permissions: publicPermissions(project.workflow, context)
  };
}

export async function startProjectWorkflow(projectId, payload, context = {}, dependencies = {}) {
  if (!contextIsManager(context)) {
    throw planningError('Somente o gestor do Efetivo pode iniciar a gestão do projeto.', { statusCode: 403, code: 'PROJECT_WORKFLOW_MANAGER_REQUIRED' });
  }
  const database = await resolvePlanningDatabase(dependencies.database);
  await runPlanningTransaction(database, async tx => {
    const project = await findEligibleProject(tx, projectId);
    if (!project) throw notFound('Projeto não encontrado ou indisponível no Efetivo.');
    await requireEligibleLeader(tx, payload.leaderUserId);
    try {
      await tx.projectWorkflow.create({
        data: {
          projectId,
          leaderUserId: payload.leaderUserId,
          plannedMobilizationDate: utcDate(payload.plannedMobilizationDate)
        }
      });
    } catch (error) {
      if (error?.code === 'P2002') throw conflictError('Este projeto já possui gestão iniciada.', [], 'PROJECT_WORKFLOW_ALREADY_EXISTS');
      throw error;
    }
    await recordEvent(tx, projectId, context.actorUserId, 'WORKFLOW_STARTED', {
      leaderUserId: payload.leaderUserId,
      plannedMobilizationDate: payload.plannedMobilizationDate
    });
  });
  return getProjectWorkflow(projectId, context, { ...dependencies, database });
}

async function loadWorkflowForMutation(tx, projectId) {
  const workflow = await tx.projectWorkflow.findUnique({
    where: { projectId },
    include: WORKFLOW_INCLUDE
  });
  if (!workflow) throw notFound('A gestão deste projeto ainda não foi iniciada.');
  Object.assign(workflow, await loadProjectDocumentGateState(tx, projectId));
  return workflow;
}

function assertEditable(workflow, context) {
  if (!canEditWorkflow(workflow, context)) {
    throw planningError('A alteração é restrita ao gestor do Efetivo ou ao Líder de Projetos designado.', {
      statusCode: 403,
      code: 'PROJECT_WORKFLOW_EDIT_FORBIDDEN'
    });
  }
}

function assertChecklistEditable(workflow, key, context) {
  const definition = PROJECT_WORKFLOW_CHECKLISTS.find(item => item.key === key);
  if (!definition) {
    throw planningError('Item de checklist inválido.', { statusCode: 400, code: 'PROJECT_WORKFLOW_CHECKLIST_INVALID' });
  }
  if (!checklistIsAvailable(workflow, definition)) {
    throw planningError('Este item não pertence à etapa atual do projeto.', {
      statusCode: 409,
      code: 'PROJECT_WORKFLOW_CHECKLIST_STAGE_FORBIDDEN'
    });
  }
  if (definition.areaRoles.length === 0) {
    assertEditable(workflow, context);
    return;
  }
  if (!canEditChecklist(workflow, definition, context)) {
    throw planningError('A alteração deste item é restrita ao Líder, gestor ou área responsável.', {
      statusCode: 403,
      code: 'PROJECT_WORKFLOW_CHECKLIST_EDIT_FORBIDDEN'
    });
  }
}

async function reserveVersion(tx, workflow, version) {
  const result = await tx.projectWorkflow.updateMany({
    where: { projectId: workflow.projectId, version },
    data: { version: { increment: 1 } }
  });
  if (result.count !== 1) {
    throw conflictError('A gestão foi atualizada por outra pessoa. Recarregue os dados.', [], 'PROJECT_WORKFLOW_VERSION_CONFLICT');
  }
}

async function applySettings(tx, workflow, payload, context) {
  const data = {};
  if (payload.plannedMobilizationDate) data.plannedMobilizationDate = utcDate(payload.plannedMobilizationDate);
  if (payload.leaderUserId && payload.leaderUserId !== workflow.leaderUserId) {
    if (!contextIsManager(context)) {
      throw planningError('Somente o gestor do Efetivo pode trocar o Líder de Projetos.', { statusCode: 403, code: 'PROJECT_WORKFLOW_MANAGER_REQUIRED' });
    }
    await requireEligibleLeader(tx, payload.leaderUserId);
    data.leaderUserId = payload.leaderUserId;
    data.acceptedAt = null;
    data.stage = 'HANDOVER';
  }
  if (Object.keys(data).length) await tx.projectWorkflow.update({ where: { projectId: workflow.projectId }, data });
}

async function applyChecklist(tx, workflow, payload, context) {
  await tx.projectWorkflowChecklist.upsert({
    where: { projectId_key: { projectId: workflow.projectId, key: payload.key } },
    create: {
      projectId: workflow.projectId,
      key: payload.key,
      status: payload.status,
      note: payload.note || null,
      updatedByUserId: context.actorUserId || null
    },
    update: {
      status: payload.status,
      note: payload.note || null,
      updatedByUserId: context.actorUserId || null
    }
  });
}

async function applyCriticalAnswer(tx, workflow, payload, context) {
  await tx.projectWorkflowCriticalAnswer.upsert({
    where: { projectId_key: { projectId: workflow.projectId, key: payload.key } },
    create: { projectId: workflow.projectId, key: payload.key, answer: payload.answer, updatedByUserId: context.actorUserId || null },
    update: { answer: payload.answer, updatedByUserId: context.actorUserId || null }
  });
  const question = PROJECT_WORKFLOW_CRITICAL_QUESTIONS.find(item => item.key === payload.key);
  if (question.createsIssue === false) return;
  if (!payload.answer) {
    await tx.projectWorkflowIssue.updateMany({
      where: { projectId: workflow.projectId, sourceQuestion: payload.key },
      data: { status: 'RESOLVED' }
    });
    return;
  }
  await tx.projectWorkflowIssue.upsert({
    where: { projectId_sourceQuestion: { projectId: workflow.projectId, sourceQuestion: payload.key } },
    create: {
      projectId: workflow.projectId,
      sourceQuestion: payload.key,
      description: question.issueDescription,
      area: question.area,
      criticality: 'HIGH',
      status: 'OPEN'
    },
    update: { status: 'OPEN' }
  });
}

async function applyAnalysisContact(tx, workflow, payload) {
  await tx.projectWorkflow.update({
    where: { projectId: workflow.projectId },
    data: {
      analysisClientContactMade: payload.made,
      analysisClientContactName: payload.made ? payload.contactName : null,
      analysisClientContactDate: payload.made && payload.contactDate ? utcDate(payload.contactDate) : null
    }
  });
}

function assertPlanningStage(workflow) {
  if (workflow.stage !== 'MOBILIZATION_PLANNING') {
    throw planningError('A definição estruturada de recursos pertence ao Planejamento da mobilização.', {
      statusCode: 409,
      code: 'PROJECT_WORKFLOW_RESOURCE_PLANNING_STAGE_REQUIRED'
    });
  }
}

async function applyTeamPlan(tx, workflow, payload) {
  assertPlanningStage(workflow);
  await tx.projectWorkflowTeamDemand.deleteMany({ where: { projectId: workflow.projectId } });
  if (payload.defined) {
    const roleIds = payload.demands.map(item => item.jobRoleId);
    const roles = await tx.jobRole.findMany({
      where: { id: { in: roleIds }, isActive: true, isOperational: true },
      select: { id: true }
    });
    if (roles.length !== roleIds.length) {
      throw planningError('A equipe contém cargo inexistente, inativo ou não operacional.', {
        code: 'PROJECT_WORKFLOW_TEAM_ROLE_INVALID'
      });
    }
    await tx.projectWorkflowTeamDemand.createMany({
      data: payload.demands.map(item => ({ projectId: workflow.projectId, ...item }))
    });
  }
  await tx.projectWorkflow.update({
    where: { projectId: workflow.projectId },
    data: { teamPlanDefined: payload.defined }
  });
}

async function applyEquipmentPlan(tx, workflow, payload) {
  assertPlanningStage(workflow);
  await tx.projectWorkflowEquipmentCategoryPlan.deleteMany({ where: { projectId: workflow.projectId } });
  if (payload.defined) {
    const categoryIds = payload.selections.map(item => item.categoryId);
    const categories = await tx.equipmentCategory.findMany({
      where: { id: { in: categoryIds }, isActive: true },
      select: {
        id: true,
        equipment: {
          where: { isActive: true },
          select: { id: true }
        }
      }
    });
    if (categories.length !== categoryIds.length) {
      throw planningError('A seleção contém categoria de equipamento inexistente ou inativa.', {
        code: 'PROJECT_WORKFLOW_EQUIPMENT_CATEGORY_INVALID'
      });
    }
    const categoryById = new Map(categories.map(category => [category.id, new Set(category.equipment.map(item => item.id))]));
    const hasInvalidEquipment = payload.selections.some(selection => (
      selection.equipmentIds.some(equipmentId => !categoryById.get(selection.categoryId)?.has(equipmentId))
    ));
    if (hasInvalidEquipment) {
      throw planningError('A seleção contém equipamento inexistente, inativo ou pertencente a outra categoria.', {
        code: 'PROJECT_WORKFLOW_EQUIPMENT_INVALID'
      });
    }
    await tx.projectWorkflowEquipmentCategoryPlan.createMany({
      data: payload.selections.map(selection => ({ projectId: workflow.projectId, ...selection }))
    });
  }
  await tx.projectWorkflow.update({
    where: { projectId: workflow.projectId },
    data: { equipmentPlanDefined: payload.defined }
  });
}

async function documentationRequirementForProject(tx, projectId, requirementId) {
  const requirement = await tx.projectWorkflowDocumentationRequirement.findFirst({
    where: { id: requirementId, category: { projectId } }
  });
  if (!requirement) throw notFound('Requisito documental não encontrado neste projeto.');
  return requirement;
}

function documentationSnapshot(requirement) {
  return {
    name: requirement.name,
    status: requirement.status,
    requestedAt: dateKey(requirement.requestedAt),
    confirmedAt: dateKey(requirement.confirmedAt),
    archivedAt: requirement.archivedAt instanceof Date ? requirement.archivedAt.toISOString() : requirement.archivedAt || null
  };
}

async function recordDocumentationHistory(tx, requirementId, actorUserId, before, after) {
  await tx.projectWorkflowDocumentationHistory.create({
    data: { requirementId, actorUserId: actorUserId || null, changes: { before, after } }
  });
}

async function applyDocumentationCategory(tx, workflow, payload, context) {
  await tx.projectWorkflowDocumentationCategory.upsert({
    where: { projectId_type: { projectId: workflow.projectId, type: payload.type } },
    create: { projectId: workflow.projectId, type: payload.type, required: payload.required, updatedByUserId: context.actorUserId || null },
    update: { required: payload.required, updatedByUserId: context.actorUserId || null }
  });
}

async function applyDocumentationRequirementCreate(tx, workflow, payload, context) {
  const category = await tx.projectWorkflowDocumentationCategory.upsert({
    where: { projectId_type: { projectId: workflow.projectId, type: payload.type } },
    create: { projectId: workflow.projectId, type: payload.type, required: true, updatedByUserId: context.actorUserId || null },
    update: { required: true, updatedByUserId: context.actorUserId || null }
  });
  const requirement = await tx.projectWorkflowDocumentationRequirement.create({
    data: {
      categoryId: category.id,
      name: payload.name,
      createdByUserId: context.actorUserId || null,
      updatedByUserId: context.actorUserId || null
    }
  });
  await recordDocumentationHistory(tx, requirement.id, context.actorUserId, null, documentationSnapshot(requirement));
}

async function applyDocumentationRequirementUpdate(tx, workflow, payload, context) {
  const requirement = await documentationRequirementForProject(tx, workflow.projectId, payload.requirementId);
  const before = documentationSnapshot(requirement);
  const status = payload.status || requirement.status;
  let requestedAt = Object.hasOwn(payload, 'requestedAt') ? payload.requestedAt : dateKey(requirement.requestedAt);
  let confirmedAt = Object.hasOwn(payload, 'confirmedAt') ? payload.confirmedAt : dateKey(requirement.confirmedAt);
  if (status === 'PENDING') {
    requestedAt = null;
    confirmedAt = null;
  } else if (status === 'REQUESTED') {
    confirmedAt = null;
  }
  if (status !== 'PENDING' && !requestedAt) {
    throw planningError('Informe a data em que a solicitação foi feita.', { code: 'PROJECT_WORKFLOW_DOCUMENTATION_REQUEST_DATE_REQUIRED' });
  }
  if (status === 'CONFIRMED' && !confirmedAt) {
    throw planningError('Informe a data da confirmação.', { code: 'PROJECT_WORKFLOW_DOCUMENTATION_CONFIRMATION_DATE_REQUIRED' });
  }
  if (requestedAt && confirmedAt && requestedAt > confirmedAt) {
    throw planningError('A confirmação não pode ser anterior à solicitação.', { code: 'PROJECT_WORKFLOW_DOCUMENTATION_DATE_ORDER_INVALID' });
  }
  const updated = await tx.projectWorkflowDocumentationRequirement.update({
    where: { id: requirement.id },
    data: {
      ...(payload.name ? { name: payload.name } : {}),
      status,
      requestedAt: requestedAt ? utcDate(requestedAt) : null,
      confirmedAt: confirmedAt ? utcDate(confirmedAt) : null,
      updatedByUserId: context.actorUserId || null
    }
  });
  await recordDocumentationHistory(tx, requirement.id, context.actorUserId, before, documentationSnapshot(updated));
}

async function applyDocumentationRequirementArchive(tx, workflow, payload, context, now) {
  const requirement = await documentationRequirementForProject(tx, workflow.projectId, payload.requirementId);
  const before = documentationSnapshot(requirement);
  const updated = await tx.projectWorkflowDocumentationRequirement.update({
    where: { id: requirement.id },
    data: { archivedAt: payload.archived ? now : null, updatedByUserId: context.actorUserId || null }
  });
  await recordDocumentationHistory(tx, requirement.id, context.actorUserId, before, documentationSnapshot(updated));
}

async function applyIssue(tx, workflow, payload) {
  const issue = await tx.projectWorkflowIssue.findFirst({ where: { id: payload.issueId, projectId: workflow.projectId } });
  if (!issue) throw notFound('Pendência não encontrada neste projeto.');
  await tx.projectWorkflowIssue.update({
    where: { id: issue.id },
    data: {
      description: payload.description,
      ownerName: payload.ownerName || null,
      requiredLeadTimeDays: payload.requiredLeadTimeDays,
      dueDate: payload.dueDate ? utcDate(payload.dueDate) : null,
      criticality: payload.criticality,
      status: payload.status
    }
  });
}

async function applyAccept(tx, workflow, context, now) {
  if (workflow.leaderUserId !== context.actorUserId) {
    throw planningError('Somente o Líder de Projetos designado pode confirmar o recebimento.', { statusCode: 403, code: 'PROJECT_WORKFLOW_LEADER_REQUIRED' });
  }
  const issues = handoverGateIssues(workflow);
  if (issues.length) {
    throw planningError('Conclua o handover antes de assumir o projeto.', {
      code: 'PROJECT_WORKFLOW_HANDOVER_INCOMPLETE',
      issues: issues.map(message => ({ message }))
    });
  }
  await tx.projectWorkflow.update({
    where: { projectId: workflow.projectId },
    data: { acceptedAt: now, stage: 'INITIAL_ANALYSIS' }
  });
}

async function applyStage(tx, workflow, payload, now, context, dependencies) {
  if (workflow.stage === 'FINISHED' && payload.stage === 'FINAL_MEASUREMENT' && !payload.reason?.trim()) {
    throw planningError('Informe uma justificativa para reabrir o projeto.', {
      code: 'PROJECT_WORKFLOW_REOPEN_REASON_REQUIRED'
    });
  }
  const projectDates = payload.stage === 'POST_JOB'
    ? await tx.project.findUnique({ where: { id: workflow.projectId }, select: { demobilizationDate: true } })
    : null;
  const issues = projectWorkflowTransitionIssues({
    ...workflow,
    demobilizationDate: projectDates?.demobilizationDate || null
  }, payload.stage);
  if (issues.length) {
    throw planningError('Não é possível avançar para esta etapa.', {
      code: 'PROJECT_WORKFLOW_STAGE_BLOCKED',
      issues: issues.map(message => ({ message }))
    });
  }
  const synchronizesOperationalStage = ['MOBILIZATION', 'EXECUTION', 'DEMOBILIZATION', 'POST_JOB', 'FINAL_MEASUREMENT', 'FINISHED'].includes(payload.stage)
    || (payload.stage === 'READY_TO_MOBILIZE' && ['MOBILIZATION', 'EXECUTION'].includes(workflow.stage));
  if (synchronizesOperationalStage) {
    await (dependencies.synchronizeOfficialMissionStage || synchronizeOfficialMissionStage)(
      tx,
      workflow.projectId,
      payload.stage,
      context
    );
  }
  const data = { stage: payload.stage };
  if (payload.stage === 'FINISHED') {
    data.closedAt = now;
    data.closedByUserId = context.actorUserId || null;
  } else if (workflow.stage === 'FINISHED') {
    data.closedAt = null;
    data.closedByUserId = null;
  }
  if (payload.stage === 'READY_TO_MOBILIZE') {
    data.mobilizationAuthorizedAt = now;
    data.mobilizationAuthorizationVersion = workflow.version + 1;
  } else if (['MOBILIZATION', 'EXECUTION', 'DEMOBILIZATION'].includes(payload.stage)) {
    data.mobilizationAuthorizedAt = workflow.mobilizationAuthorizedAt;
    data.mobilizationAuthorizationVersion = workflow.version + 1;
  } else if (['POST_JOB', 'FINAL_MEASUREMENT'].includes(payload.stage) || ['READY_TO_MOBILIZE', 'MOBILIZATION', 'EXECUTION'].includes(workflow.stage)) {
    data.mobilizationAuthorizedAt = null;
    data.mobilizationAuthorizationVersion = null;
  }
  await tx.projectWorkflow.update({ where: { projectId: workflow.projectId }, data });
}

async function applyPostJob(tx, workflow, payload, context, dependencies, now) {
  if (workflow.stage !== 'POST_JOB') {
    throw planningError('O fechamento técnico só pode ser registrado durante o Pós-job.', {
      statusCode: 409,
      code: 'PROJECT_WORKFLOW_POST_JOB_STAGE_REQUIRED'
    });
  }
  const project = await tx.project.findUnique({
    where: { id: workflow.projectId },
    select: {
      id: true,
      name: true,
      plannedServices: { select: { serviceType: true }, orderBy: { order: 'asc' } }
    }
  });
  if (!project) throw notFound('Projeto não encontrado.');
  const current = workflow.postJob || null;
  const data = {};
  if (Object.hasOwn(payload, 'meetingDate')) data.meetingDate = payload.meetingDate ? utcDate(payload.meetingDate) : null;
  for (const field of POST_JOB_FIELDS) {
    if (Object.hasOwn(payload, field)) data[field] = payload[field] || null;
  }
  const serviceTypes = projectServiceTypes(project);
  const merged = {
    ...current,
    ...data,
    meetingDate: Object.hasOwn(data, 'meetingDate') ? data.meetingDate : current?.meetingDate || null
  };
  const qualityRecordId = await (dependencies.synchronizePostJobQualityRecord || synchronizePostJobQualityRecord)(tx, {
    projectId: workflow.projectId,
    qualityRecordId: current?.qualityRecordId || null,
    postJob: merged,
    serviceTypes,
    actorUserId: context.actorUserId || null,
    now
  });
  await tx.projectWorkflowPostJob.upsert({
    where: { projectId: workflow.projectId },
    create: {
      projectId: workflow.projectId,
      ...data,
      serviceTypes,
      qualityRecordId,
      createdByUserId: context.actorUserId || null,
      updatedByUserId: context.actorUserId || null
    },
    update: {
      ...data,
      serviceTypes,
      qualityRecordId,
      updatedByUserId: context.actorUserId || null
    }
  });
}

function validateMergedMeasurement(measurement) {
  const executed = decimalNumber(measurement.executedAmount);
  const measured = decimalNumber(measurement.measuredAmount);
  const approved = decimalNumber(measurement.approvedAmount);
  const issues = [];
  if (executed != null && measured != null && measured > executed) issues.push('O valor medido não pode ser maior que o executado');
  if (measured != null && approved != null && approved > measured) issues.push('O valor aprovado não pode ser maior que o medido');
  const preparedAt = dateKey(measurement.preparedAt);
  const sentAt = dateKey(measurement.sentAt);
  const approvedAt = dateKey(measurement.approvedAt);
  if (preparedAt && sentAt && preparedAt > sentAt) issues.push('A data de envio não pode ser anterior à preparação');
  if (sentAt && approvedAt && sentAt > approvedAt) issues.push('A data de aprovação não pode ser anterior ao envio');
  if (preparedAt && approvedAt && preparedAt > approvedAt) issues.push('A data de aprovação não pode ser anterior à preparação');
  if (issues.length) {
    throw planningError('Revise os dados da medição.', {
      code: 'PROJECT_WORKFLOW_MEASUREMENT_INVALID',
      issues: issues.map(message => ({ message }))
    });
  }
}

async function applyMeasurement(tx, workflow, payload, context) {
  if (workflow.stage !== 'FINAL_MEASUREMENT') {
    throw planningError('A medição só pode ser registrada durante Documentação / medição.', {
      statusCode: 409,
      code: 'PROJECT_WORKFLOW_MEASUREMENT_STAGE_REQUIRED'
    });
  }
  const data = {};
  for (const field of MEASUREMENT_TEXT_FIELDS) {
    if (Object.hasOwn(payload, field)) data[field] = payload[field] || null;
  }
  for (const field of MEASUREMENT_AMOUNT_FIELDS) {
    if (Object.hasOwn(payload, field)) data[field] = payload[field];
  }
  for (const field of MEASUREMENT_DATE_FIELDS) {
    if (Object.hasOwn(payload, field)) data[field] = payload[field] ? utcDate(payload[field]) : null;
  }
  validateMergedMeasurement({ ...(workflow.measurement || {}), ...data });
  await tx.projectWorkflowMeasurement.upsert({
    where: { projectId: workflow.projectId },
    create: {
      projectId: workflow.projectId,
      ...data,
      createdByUserId: context.actorUserId || null,
      updatedByUserId: context.actorUserId || null
    },
    update: { ...data, updatedByUserId: context.actorUserId || null }
  });
}

async function applyMobilizationAuthorization(tx, workflow, now) {
  if (!['READY_TO_MOBILIZE', 'MOBILIZATION', 'EXECUTION', 'DEMOBILIZATION'].includes(workflow.stage)) {
    throw planningError('A mobilização só pode ser autorizada nas etapas Pronto para mobilizar, Mobilização, Em execução ou Desmobilização.', {
      code: 'PROJECT_WORKFLOW_READY_STAGE_REQUIRED'
    });
  }
  const gate = projectWorkflowMobilizationGate(workflow);
  if (!gate.ready) {
    throw planningError('Existem bloqueios no gate de mobilização.', {
      code: 'PROJECT_WORKFLOW_MOBILIZATION_BLOCKED',
      issues: gate.blockers.map(item => ({ message: `${item.label}: ${item.reason}` }))
    });
  }
  await tx.projectWorkflow.update({
    where: { projectId: workflow.projectId },
    data: {
      mobilizationAuthorizedAt: now,
      mobilizationAuthorizationVersion: workflow.version + 1
    }
  });
}

async function applyDemobilization(tx, workflow, payload, context, dependencies) {
  if (workflow.stage !== 'DEMOBILIZATION') {
    throw planningError('As datas efetivas só podem ser registradas durante a desmobilização.', {
      statusCode: 409,
      code: 'PROJECT_WORKFLOW_DEMOBILIZATION_STAGE_REQUIRED'
    });
  }
  const project = await tx.project.findUnique({
    where: { id: workflow.projectId },
    select: { id: true, mobilizationDate: true, demobilizationDate: true }
  });
  if (!project) throw notFound('Projeto não encontrado.');
  const fieldCompletionDate = Object.hasOwn(payload, 'fieldCompletionDate')
    ? payload.fieldCompletionDate
    : dateKey(workflow.fieldCompletionDate);
  const returnDate = Object.hasOwn(payload, 'returnDate')
    ? payload.returnDate
    : dateKey(project.demobilizationDate);
  const mobilizationDate = Object.hasOwn(payload, 'mobilizationDate')
    ? payload.mobilizationDate
    : dateKey(project.mobilizationDate);
  if (returnDate && payload.mobilizationDate === null) {
    throw planningError('Informe a mobilização no cronograma antes da desmobilização.', {
      code: 'PROJECT_MOBILIZATION_REQUIRED'
    });
  }
  if (mobilizationDate && returnDate && returnDate < mobilizationDate) {
    throw planningError('A desmobilização não pode ser anterior à mobilização.', {
      code: 'INVALID_PROJECT_WORKFLOW_DEMOBILIZATION'
    });
  }
  if (fieldCompletionDate && returnDate && returnDate < fieldCompletionDate) {
    throw planningError('A desmobilização não pode ser anterior à conclusão de campo.', {
      code: 'INVALID_PROJECT_WORKFLOW_DEMOBILIZATION'
    });
  }
  if (Object.hasOwn(payload, 'mobilizationDate')) {
    await tx.project.update({
      where: { id: workflow.projectId },
      data: { mobilizationDate: payload.mobilizationDate ? utcDate(payload.mobilizationDate) : null }
    });
  }
  if (Object.hasOwn(payload, 'returnDate')) {
    await (dependencies.synchronizeOfficialMissionDemobilization || synchronizeOfficialMissionDemobilization)(
      tx,
      workflow.projectId,
      payload.returnDate,
      context
    );
  }
  if (Object.hasOwn(payload, 'fieldCompletionDate')) {
    await tx.projectWorkflow.update({
      where: { projectId: workflow.projectId },
      data: { fieldCompletionDate: payload.fieldCompletionDate ? utcDate(payload.fieldCompletionDate) : null }
    });
  }
}

export async function updateProjectWorkflow(projectId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const now = dependencies.now || new Date();
  await runPlanningTransaction(database, async tx => {
    const workflow = await loadWorkflowForMutation(tx, projectId);
    const reopening = workflow.stage === 'FINISHED' && payload.action === 'stage' && payload.stage === 'FINAL_MEASUREMENT';
    if (workflow.stage === 'FINISHED' && !reopening) {
      throw planningError('O projeto está encerrado. Reabra-o para alterar os dados.', {
        statusCode: 409,
        code: 'PROJECT_WORKFLOW_FINISHED_READ_ONLY'
      });
    }
    if (payload.action === 'checklist') assertChecklistEditable(workflow, payload.key, context);
    else assertEditable(workflow, context);
    if (workflow.version !== payload.version) {
      throw conflictError('A gestão foi atualizada por outra pessoa. Recarregue os dados.', [], 'PROJECT_WORKFLOW_VERSION_CONFLICT');
    }
    await reserveVersion(tx, workflow, payload.version);
    if (payload.action === 'settings') await applySettings(tx, workflow, payload, context);
    else if (payload.action === 'checklist') await applyChecklist(tx, workflow, payload, context);
    else if (payload.action === 'critical') await applyCriticalAnswer(tx, workflow, payload, context);
    else if (payload.action === 'analysis_contact') await applyAnalysisContact(tx, workflow, payload);
    else if (payload.action === 'team_plan') await applyTeamPlan(tx, workflow, payload);
    else if (payload.action === 'equipment_plan') await applyEquipmentPlan(tx, workflow, payload);
    else if (payload.action === 'documentation_category') await applyDocumentationCategory(tx, workflow, payload, context);
    else if (payload.action === 'documentation_requirement_create') await applyDocumentationRequirementCreate(tx, workflow, payload, context);
    else if (payload.action === 'documentation_requirement_update') await applyDocumentationRequirementUpdate(tx, workflow, payload, context);
    else if (payload.action === 'documentation_requirement_archive') await applyDocumentationRequirementArchive(tx, workflow, payload, context, now);
    else if (payload.action === 'issue') await applyIssue(tx, workflow, payload);
    else if (payload.action === 'accept') await applyAccept(tx, workflow, context, now);
    else if (payload.action === 'stage') await applyStage(tx, workflow, payload, now, context, dependencies);
    else if (payload.action === 'demobilization') await applyDemobilization(tx, workflow, payload, context, dependencies);
    else if (payload.action === 'post_job') await applyPostJob(tx, workflow, payload, context, dependencies, now);
    else if (payload.action === 'measurement') await applyMeasurement(tx, workflow, payload, context);
    else if (payload.action === 'authorize_mobilization') await applyMobilizationAuthorization(tx, workflow, now);
    const eventData = { ...payload };
    delete eventData.version;
    await recordEvent(tx, projectId, context.actorUserId, `WORKFLOW_${payload.action.toUpperCase()}`, eventData);
  });
  return getProjectWorkflow(projectId, context, { ...dependencies, database, now });
}
