import {
  PROJECT_EXECUTION_DEVIATION_CATEGORIES,
  PROJECT_EXECUTION_REPORT_TYPES
} from '../../../../../shared/schemas/project-execution.js';
import { getProjectDetail } from '../../acompanhamento/project-detail.js';
import { createRecord, listProjectDeviations } from '../../qualidade/service.js';
import { efetivoProjectWhere } from '../project-visibility.js';
import { notFound, planningError } from '../planning/errors.js';
import { resolvePlanningDatabase, runPlanningTransaction } from '../planning/plan-context.js';
import { canEditWorkflow } from './service.js';

const INTEGRATED_REPORT_TYPES = new Set(PROJECT_EXECUTION_REPORT_TYPES.filter(item => item.source === 'SYSTEM').map(item => item.key));
const SAO_PAULO_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});

function dateKey(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function todayKey(now = new Date()) {
  return SAO_PAULO_DATE_FORMATTER.format(now);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function targetValue(targetData, reportType, field) {
  const value = targetData && typeof targetData === 'object' ? targetData[reportType]?.[field] : null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function buildTechnicalReports(reports, targetData) {
  return PROJECT_EXECUTION_REPORT_TYPES.map(definition => {
    const matching = definition.source === 'SYSTEM'
      ? reports.filter(report => report.reportType === definition.key)
      : [];
    const expectedCount = targetValue(targetData, definition.key, 'expected');
    const issuedCount = definition.source === 'MANUAL'
      ? targetValue(targetData, definition.key, 'completed')
      : matching.length;
    return {
      reportType: definition.key,
      label: definition.label,
      source: definition.source,
      issuedCount,
      expectedCount,
      approvedCount: definition.source === 'SYSTEM' ? matching.filter(report => ['APPROVED', 'SIGNED'].includes(report.status)).length : issuedCount,
      signedCount: definition.source === 'SYSTEM' ? matching.filter(report => report.status === 'SIGNED').length : 0,
      returnedCount: definition.source === 'SYSTEM' ? matching.filter(report => report.status === 'RETURNED').length : 0,
      missingCount: expectedCount > 0 ? Math.max(0, expectedCount - issuedCount) : 0
    };
  });
}

export function buildProjectExecutionDashboard({ tracking = null, reports = [], targetData = {}, deviations = [], canEdit = false } = {}) {
  const validReports = Array.isArray(reports) ? reports : [];
  const rdos = validReports.filter(report => report.reportType === 'RDO');
  const lastReportDate = rdos.map(report => dateKey(report.reportDate)).filter(Boolean).sort().at(-1) || null;
  return {
    schedule: {
      plannedProgressPct: finiteNumber(tracking?.diasCorridos?.pct),
      actualProgressPct: finiteNumber(tracking?.avancoPct),
      progressMethod: tracking?.avancoMethod || null,
      elapsedDays: finiteNumber(tracking?.diasCorridos?.elapsed),
      plannedDays: finiteNumber(tracking?.diasCorridos?.planned),
      startDate: dateKey(tracking?.footer?.startDate),
      expectedEndDate: dateKey(tracking?.footer?.expectedEndDate),
      projectedEndDate: dateKey(tracking?.footer?.projectedEndByPace)
    },
    rdo: {
      receivedCount: rdos.length,
      pendingOrReturnedCount: rdos.filter(report => ['PENDING', 'RETURNED'].includes(report.status)).length,
      releasedToClientCount: rdos.filter(report => ['APPROVED', 'SIGNED'].includes(report.status)).length,
      signedCount: rdos.filter(report => report.status === 'SIGNED').length,
      withQuantitiesCount: rdos.filter(report => Array.isArray(report.services) && report.services.length > 0).length,
      withEvidenceCount: rdos.filter(report => Array.isArray(report.attachments) && report.attachments.length > 0).length,
      evidenceCount: rdos.reduce((sum, report) => sum + (Array.isArray(report.attachments) ? report.attachments.length : 0), 0),
      lastReportDate
    },
    technicalReports: buildTechnicalReports(validReports, targetData),
    deviations: Array.isArray(deviations) ? deviations : [],
    permissions: { canEdit: Boolean(canEdit) }
  };
}

async function requireProjectWorkflow(database, projectId) {
  const project = await database.project.findFirst({
    where: { id: projectId, isActive: true, deletedAt: null, ...efetivoProjectWhere() },
    select: {
      id: true,
      workflow: { select: { projectId: true, stage: true, leaderUserId: true, executionReportTargets: true } }
    }
  });
  if (!project) throw notFound('Projeto não encontrado ou indisponível no Efetivo.');
  if (!project.workflow) throw notFound('A gestão deste projeto ainda não foi iniciada.');
  return project.workflow;
}

function assertExecutionEditable(workflow, context, { requireExecution = false } = {}) {
  if (!canEditWorkflow(workflow, context)) {
    throw planningError('A alteração é restrita ao gestor do Efetivo ou ao Líder de Projetos designado.', {
      statusCode: 403,
      code: 'PROJECT_WORKFLOW_EDIT_FORBIDDEN'
    });
  }
  if (requireExecution && workflow.stage !== 'EXECUTION') {
    throw planningError('Os desvios operacionais são registrados na etapa Em execução.', {
      statusCode: 409,
      code: 'PROJECT_WORKFLOW_EXECUTION_REQUIRED'
    });
  }
}

async function loadTracking(projectId, dependency) {
  try {
    return await dependency(projectId, { includeCollaboratorCosts: false, includeAdminOnlyCategories: false });
  } catch {
    return null;
  }
}

export async function getProjectExecutionDashboard(projectId, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const workflow = await requireProjectWorkflow(database, projectId);
  const [tracking, reports, deviations] = await Promise.all([
    loadTracking(projectId, dependencies.getProjectDetail || getProjectDetail),
    database.report.findMany({
      where: {
        projectId,
        deletedAt: null,
        reportType: { in: ['RDO', ...INTEGRATED_REPORT_TYPES] }
      },
      select: {
        id: true,
        reportType: true,
        status: true,
        reportDate: true,
        services: { select: { id: true } },
        attachments: { select: { id: true } }
      }
    }),
    (dependencies.listProjectDeviations || listProjectDeviations)(database, projectId)
  ]);
  return buildProjectExecutionDashboard({
    tracking,
    reports,
    targetData: workflow.executionReportTargets,
    deviations,
    canEdit: canEditWorkflow(workflow, context)
  });
}

function targetMap(targets) {
  return Object.fromEntries(targets
    .filter(target => target.expectedCount > 0 || (target.reportType === 'RLR' && (target.completedCount || 0) > 0))
    .map(target => [target.reportType, {
      expected: target.expectedCount,
      ...(target.reportType === 'RLR' ? { completed: target.completedCount || 0 } : {})
    }]));
}

export async function updateProjectExecutionReportTargets(projectId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const workflow = await requireProjectWorkflow(database, projectId);
  assertExecutionEditable(workflow, context);
  const targets = targetMap(payload.targets);
  await runPlanningTransaction(database, async tx => {
    await tx.projectWorkflow.update({ where: { projectId }, data: { executionReportTargets: targets } });
    await tx.projectWorkflowEvent.create({
      data: { projectId, actorUserId: context.actorUserId || null, action: 'WORKFLOW_EXECUTION_REPORT_TARGETS', data: targets }
    });
  });
  return getProjectExecutionDashboard(projectId, context, { ...dependencies, database });
}

async function ensureDeviationNature(database, category) {
  const definition = PROJECT_EXECUTION_DEVIATION_CATEGORIES.find(item => item.key === category);
  let nature = await database.qualityNature.findFirst({ where: { name: { equals: definition.label, mode: 'insensitive' } } });
  if (nature) {
    if (!nature.isActive) nature = await database.qualityNature.update({ where: { id: nature.id }, data: { isActive: true } });
    return nature;
  }
  try {
    return await database.qualityNature.create({ data: { name: definition.label } });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const concurrentNature = await database.qualityNature.findFirst({ where: { name: { equals: definition.label, mode: 'insensitive' } } });
    if (!concurrentNature) throw error;
    return concurrentNature;
  }
}

export async function createProjectExecutionDeviation(projectId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const workflow = await requireProjectWorkflow(database, projectId);
  assertExecutionEditable(workflow, context, { requireExecution: true });
  const category = PROJECT_EXECUTION_DEVIATION_CATEGORIES.find(item => item.key === payload.category);
  const nature = await ensureDeviationNature(database, payload.category);
  const now = dependencies.now || new Date();
  const record = await (dependencies.createQualityRecord || createRecord)(database, {
    data: {
      type: 'DESVIO',
      registeredAt: todayKey(now),
      eventDate: todayKey(now),
      origin: category.label,
      projectId,
      natureId: nature.id,
      description: payload.description,
      impact: payload.impact,
      disposition: 'TRATAR',
      definedAction: payload.action,
      actionOwner: payload.ownerName,
      actionDeadline: payload.dueDate,
      status: payload.status,
      linkedRnc: null,
      evidence: null,
      evidences: [],
      resultVerification: null
    },
    userId: context.actorUserId || null
  });
  await database.projectWorkflowEvent.create({
    data: { projectId, actorUserId: context.actorUserId || null, action: 'WORKFLOW_EXECUTION_DEVIATION_CREATED', data: { deviationId: record.id, category: payload.category } }
  });
  return record;
}

export async function updateProjectExecutionDeviation(projectId, deviationId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const workflow = await requireProjectWorkflow(database, projectId);
  assertExecutionEditable(workflow, context, { requireExecution: true });
  const current = await database.qualityRecord.findFirst({
    where: { id: deviationId, projectId, type: 'DESVIO', deletedAt: null },
    select: { id: true }
  });
  if (!current) throw notFound('Desvio não encontrado neste projeto.');
  await database.qualityRecord.update({
    where: { id: current.id },
    data: { status: payload.status, updatedById: context.actorUserId || null }
  });
  await database.projectWorkflowEvent.create({
    data: { projectId, actorUserId: context.actorUserId || null, action: 'WORKFLOW_EXECUTION_DEVIATION_STATUS', data: { deviationId, status: payload.status } }
  });
  const deviations = await (dependencies.listProjectDeviations || listProjectDeviations)(database, projectId);
  const updated = deviations.find(item => item.id === deviationId);
  if (!updated) throw notFound('Desvio atualizado, mas indisponível para consulta.');
  return updated;
}
