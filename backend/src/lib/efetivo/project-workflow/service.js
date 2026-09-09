import {
  PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_CRITICAL_QUESTIONS,
  projectWorkflowMilestones
} from '../../../../../shared/schemas/project-workflow.js';
import { hasModuleRole } from '../../module-roles.js';
import { efetivoProjectWhere } from '../project-visibility.js';
import { conflictError, notFound, planningError } from '../planning/errors.js';
import { resolvePlanningDatabase, runPlanningTransaction } from '../planning/plan-context.js';
import {
  handoverGateIssues,
  projectWorkflowTransitionIssues
} from './rules.js';

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
  location: true
};
const WORKFLOW_INCLUDE = {
  leader: { select: { id: true, name: true, isActive: true } },
  checklists: { include: { updatedBy: { select: { id: true, name: true } } }, orderBy: { key: 'asc' } },
  criticalAnswers: { include: { updatedBy: { select: { id: true, name: true } } }, orderBy: { key: 'asc' } },
  issues: { orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }] },
  events: {
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50
  }
};

function utcDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10) || null;
}

function todayKey(now = new Date()) {
  return SAO_PAULO_DATE_FORMATTER.format(now);
}

function eligibleProjectWhere(extra = {}) {
  return { isActive: true, deletedAt: null, ...efetivoProjectWhere(), ...extra };
}

function contextIsManager(context) {
  return context.isManager === true || context.user?.accountType === 'ADMIN' || hasModuleRole(context.user, 'efetivo:manager');
}

function canEditWorkflow(workflow, context) {
  return contextIsManager(context) || Boolean(context.actorUserId && workflow?.leaderUserId === context.actorUserId);
}

function publicPermissions(workflow, context) {
  const manager = contextIsManager(context);
  const isLeader = Boolean(context.actorUserId && workflow?.leaderUserId === context.actorUserId);
  return {
    canInitialize: manager && !workflow,
    canEdit: Boolean(workflow && (manager || isLeader)),
    canAccept: Boolean(workflow && isLeader && !workflow.acceptedAt && workflow.stage === 'HANDOVER'),
    canChangeLeader: Boolean(workflow && manager)
  };
}

function decorateWorkflow(workflow, context, now) {
  if (!workflow) return null;
  const checklistByKey = new Map((workflow.checklists || []).map(item => [item.key, item]));
  const answerByKey = new Map((workflow.criticalAnswers || []).map(item => [item.key, item]));
  const checklists = PROJECT_WORKFLOW_CHECKLISTS.map(definition => ({
    ...definition,
    status: 'PENDING',
    note: null,
    updatedAt: null,
    updatedBy: null,
    ...checklistByKey.get(definition.key)
  }));
  const criticalAnswers = PROJECT_WORKFLOW_CRITICAL_QUESTIONS.map(definition => ({
    ...definition,
    answer: null,
    updatedAt: null,
    updatedBy: null,
    ...answerByKey.get(definition.key)
  }));
  const issues = (workflow.issues || []).map(issue => ({
    ...issue,
    dueDate: dateKey(issue.dueDate),
    overdue: issue.status !== 'RESOLVED' && Boolean(issue.dueDate) && dateKey(issue.dueDate) < todayKey(now)
  }));
  return {
    ...workflow,
    plannedMobilizationDate: dateKey(workflow.plannedMobilizationDate),
    checklists,
    criticalAnswers,
    issues,
    milestones: projectWorkflowMilestones(dateKey(workflow.plannedMobilizationDate), todayKey(now)),
    permissions: publicPermissions(workflow, context)
  };
}

async function findEligibleProject(database, projectId, { workflow = false } = {}) {
  return database.project.findFirst({
    where: eligibleProjectWhere({ id: projectId }),
    select: {
      ...PROJECT_FIELDS,
      ...(workflow ? { workflow: { include: WORKFLOW_INCLUDE } } : {})
    }
  });
}

async function requireEligibleLeader(database, leaderUserId) {
  const leader = await database.user.findFirst({
    where: {
      id: leaderUserId,
      isActive: true,
      OR: [
        { accountType: 'ADMIN' },
        { moduleRoles: { some: { module: 'EFETIVO' } } }
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
        workflow: {
          include: {
            leader: { select: { id: true, name: true, isActive: true } },
            issues: { select: { status: true, dueDate: true } }
          }
        }
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
      const issues = workflow?.issues || [];
      return {
        ...project,
        workflow: workflow ? {
          projectId: workflow.projectId,
          stage: workflow.stage,
          leader: workflow.leader,
          acceptedAt: workflow.acceptedAt,
          plannedMobilizationDate: dateKey(workflow.plannedMobilizationDate),
          version: workflow.version,
          milestones: projectWorkflowMilestones(dateKey(workflow.plannedMobilizationDate), todayKey(now)),
          issueCount: issues.filter(item => item.status !== 'RESOLVED').length,
          overdueIssueCount: issues.filter(item => item.status !== 'RESOLVED' && item.dueDate && dateKey(item.dueDate) < todayKey(now)).length
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
      OR: [{ accountType: 'ADMIN' }, { moduleRoles: { some: { module: 'EFETIVO' } } }]
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  });
}

export async function getProjectWorkflow(projectId, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const project = await findEligibleProject(database, projectId, { workflow: true });
  if (!project) throw notFound('Projeto não encontrado ou indisponível no Efetivo.');
  return {
    project: { id: project.id, code: project.code, name: project.name, clientName: project.clientName, location: project.location },
    workflow: decorateWorkflow(project.workflow, context, dependencies.now || new Date()),
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
          plannedMobilizationDate: utcDate(payload.plannedMobilizationDate),
          checklists: {
            create: ['HANDOVER_PROJECT_CREATED', 'HANDOVER_LEADER_DEFINED'].map(key => ({
              key,
              status: 'DONE',
              updatedByUserId: context.actorUserId || null
            }))
          }
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
  if (!payload.answer) return;
  const question = PROJECT_WORKFLOW_CRITICAL_QUESTIONS.find(item => item.key === payload.key);
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
    update: {}
  });
}

async function applyIssue(tx, workflow, payload) {
  const issue = await tx.projectWorkflowIssue.findFirst({ where: { id: payload.issueId, projectId: workflow.projectId } });
  if (!issue) throw notFound('Pendência não encontrada neste projeto.');
  await tx.projectWorkflowIssue.update({
    where: { id: issue.id },
    data: {
      description: payload.description,
      area: payload.area,
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

async function applyStage(tx, workflow, payload) {
  const issues = projectWorkflowTransitionIssues(workflow, payload.stage);
  if (issues.length) {
    throw planningError('Não é possível avançar para esta etapa.', {
      code: 'PROJECT_WORKFLOW_STAGE_BLOCKED',
      issues: issues.map(message => ({ message }))
    });
  }
  await tx.projectWorkflow.update({ where: { projectId: workflow.projectId }, data: { stage: payload.stage } });
}

export async function updateProjectWorkflow(projectId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const now = dependencies.now || new Date();
  await runPlanningTransaction(database, async tx => {
    const workflow = await loadWorkflowForMutation(tx, projectId);
    assertEditable(workflow, context);
    if (workflow.version !== payload.version) {
      throw conflictError('A gestão foi atualizada por outra pessoa. Recarregue os dados.', [], 'PROJECT_WORKFLOW_VERSION_CONFLICT');
    }
    await reserveVersion(tx, workflow, payload.version);
    if (payload.action === 'settings') await applySettings(tx, workflow, payload, context);
    else if (payload.action === 'checklist') await applyChecklist(tx, workflow, payload, context);
    else if (payload.action === 'critical') await applyCriticalAnswer(tx, workflow, payload, context);
    else if (payload.action === 'issue') await applyIssue(tx, workflow, payload);
    else if (payload.action === 'accept') await applyAccept(tx, workflow, context, now);
    else if (payload.action === 'stage') await applyStage(tx, workflow, payload);
    const eventData = { ...payload };
    delete eventData.version;
    await recordEvent(tx, projectId, context.actorUserId, `WORKFLOW_${payload.action.toUpperCase()}`, eventData);
  });
  return getProjectWorkflow(projectId, context, { ...dependencies, database, now });
}
