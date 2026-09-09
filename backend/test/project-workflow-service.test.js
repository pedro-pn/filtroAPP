import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_CRITICAL_QUESTIONS
} from '../../shared/schemas/project-workflow.js';
import {
  listProjectWorkflows,
  startProjectWorkflow,
  updateProjectWorkflow
} from '../src/lib/efetivo/project-workflow/service.js';

function fakeDatabase() {
  const state = {
    project: { id: 'project-1', code: 'P-001', name: 'Flushing', clientName: 'Cliente', location: 'Santos' },
    workflow: null,
    checklists: [],
    answers: [],
    issues: [],
    events: [],
    lastProjectFindManyInput: null
  };
  const users = {
    'manager-1': { id: 'manager-1', name: 'Gestora', isActive: true, accountType: 'ADMIN' },
    'leader-1': { id: 'leader-1', name: 'Líder A', isActive: true, accountType: 'INTERNAL' },
    'leader-2': { id: 'leader-2', name: 'Líder B', isActive: true, accountType: 'INTERNAL' },
    'viewer-1': { id: 'viewer-1', name: 'Leitor', isActive: true, accountType: 'INTERNAL' }
  };
  const withRelations = () => state.workflow ? {
    ...state.workflow,
    leader: users[state.workflow.leaderUserId],
    checklists: state.checklists.map(item => ({ ...item, updatedBy: users[item.updatedByUserId] || null })),
    criticalAnswers: state.answers.map(item => ({ ...item, updatedBy: users[item.updatedByUserId] || null })),
    issues: state.issues.map(item => ({ ...item })),
    events: state.events.map(item => ({ ...item, actor: users[item.actorUserId] || null })).reverse()
  } : null;
  const database = {
    $transaction: async callback => {
      const snapshot = structuredClone(state);
      try {
        return await callback(database);
      } catch (error) {
        Object.assign(state, snapshot);
        throw error;
      }
    },
    project: {
      findFirst: async input => input.where.id === state.project.id ? { ...state.project, ...(input.select?.workflow ? { workflow: withRelations() } : {}) } : null,
      count: async () => 1,
      findMany: async input => {
        state.lastProjectFindManyInput = input;
        return [{ ...state.project, workflow: withRelations() }];
      }
    },
    user: {
      findFirst: async input => users[input.where.id] && input.where.id !== 'viewer-1' ? users[input.where.id] : null,
      findMany: async () => Object.values(users).filter(item => item.id !== 'viewer-1').map(({ id, name }) => ({ id, name }))
    },
    projectWorkflow: {
      create: async input => {
        if (state.workflow) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        state.workflow = {
          projectId: input.data.projectId,
          stage: 'HANDOVER',
          leaderUserId: input.data.leaderUserId,
          acceptedAt: null,
          plannedMobilizationDate: input.data.plannedMobilizationDate,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        state.checklists.push(...input.data.checklists.create.map((item, index) => ({ id: `check-${index}`, projectId: state.project.id, ...item })));
        return withRelations();
      },
      findUnique: async () => withRelations(),
      updateMany: async input => {
        if (!state.workflow || state.workflow.version !== input.where.version) return { count: 0 };
        state.workflow.version += 1;
        return { count: 1 };
      },
      update: async input => {
        state.workflow = { ...state.workflow, ...input.data, updatedAt: new Date() };
        return withRelations();
      }
    },
    projectWorkflowChecklist: {
      upsert: async input => {
        const key = input.where.projectId_key.key;
        const existing = state.checklists.find(item => item.key === key);
        if (existing) Object.assign(existing, input.update);
        else state.checklists.push({ id: `check-${state.checklists.length}`, ...input.create });
      }
    },
    projectWorkflowCriticalAnswer: {
      upsert: async input => {
        const key = input.where.projectId_key.key;
        const existing = state.answers.find(item => item.key === key);
        if (existing) Object.assign(existing, input.update);
        else state.answers.push({ id: `answer-${state.answers.length}`, ...input.create });
      }
    },
    projectWorkflowIssue: {
      upsert: async input => {
        const sourceQuestion = input.where.projectId_sourceQuestion.sourceQuestion;
        const existing = state.issues.find(item => item.sourceQuestion === sourceQuestion);
        if (existing) Object.assign(existing, input.update);
        else state.issues.push({ id: `issue-${state.issues.length + 1}`, ownerName: null, requiredLeadTimeDays: null, dueDate: null, createdAt: new Date(), updatedAt: new Date(), ...input.create });
      },
      findFirst: async input => state.issues.find(item => item.id === input.where.id && item.projectId === input.where.projectId) || null,
      update: async input => {
        const issue = state.issues.find(item => item.id === input.where.id);
        Object.assign(issue, input.data, { updatedAt: new Date() });
        return issue;
      }
    },
    projectWorkflowEvent: {
      create: async input => {
        const event = { id: `event-${state.events.length + 1}`, createdAt: new Date(), ...input.data };
        state.events.push(event);
        return event;
      }
    }
  };
  return { database, state, users };
}

const manager = { actorUserId: 'manager-1', isManager: true, user: { id: 'manager-1', accountType: 'ADMIN' } };
const leader = { actorUserId: 'leader-1', user: { id: 'leader-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:viewer'] } };
const viewer = { actorUserId: 'viewer-1', user: { id: 'viewer-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:viewer'] } };

test('gestor inicia handover sem programação de equipe e sem presumir aceite', async () => {
  const { database, state } = fakeDatabase();
  const result = await startProjectWorkflow('project-1', {
    leaderUserId: 'leader-1',
    plannedMobilizationDate: '2027-02-15'
  }, manager, { database, now: new Date('2026-09-09T12:00:00Z') });
  assert.equal(result.workflow.stage, 'HANDOVER');
  assert.equal(result.workflow.acceptedAt, null);
  assert.equal(result.workflow.checklists.filter(item => item.status === 'DONE').length, 2);
  assert.equal(state.events[0].action, 'WORKFLOW_STARTED');
});

test('somente o líder designado aceita o handover completo', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  for (const item of PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.stage === 'HANDOVER')) {
    if (!state.checklists.some(answer => answer.key === item.key)) state.checklists.push({ id: `check-${item.key}`, projectId: 'project-1', key: item.key, status: 'DONE' });
  }
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'accept', version: 1 }, viewer, { database }),
    error => error.code === 'PROJECT_WORKFLOW_EDIT_FORBIDDEN'
  );
  const result = await updateProjectWorkflow('project-1', { action: 'accept', version: 1 }, leader, { database, now: new Date('2026-09-10T10:00:00Z') });
  assert.equal(result.workflow.stage, 'INITIAL_ANALYSIS');
  assert.equal(result.workflow.acceptedAt.toISOString(), '2026-09-10T10:00:00.000Z');
});

test('resposta crítica positiva garante uma única pendência', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  await updateProjectWorkflow('project-1', { action: 'critical', version: 1, key: 'SPECIAL_EQUIPMENT', answer: true }, leader, { database });
  await updateProjectWorkflow('project-1', { action: 'critical', version: 2, key: 'SPECIAL_EQUIPMENT', answer: true }, leader, { database });
  assert.equal(state.issues.length, 1);
  assert.equal(state.issues[0].area, 'Ativos');
});

test('análise bloqueia pendência sem responsável/prazo e libera após encaminhamento', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  state.workflow.stage = 'INITIAL_ANALYSIS';
  state.workflow.acceptedAt = new Date();
  state.checklists.push(...PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.stage === 'INITIAL_ANALYSIS').map(item => ({ id: item.key, projectId: 'project-1', key: item.key, status: 'DONE' })));
  state.answers.push(...PROJECT_WORKFLOW_CRITICAL_QUESTIONS.map(item => ({ id: item.key, projectId: 'project-1', key: item.key, answer: item.key === 'SPECIAL_EQUIPMENT' })));
  state.issues.push({ id: 'issue-1', projectId: 'project-1', sourceQuestion: 'SPECIAL_EQUIPMENT', description: 'Equipamento', area: 'Ativos', ownerName: null, requiredLeadTimeDays: null, dueDate: null, criticality: 'HIGH', status: 'OPEN' });
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'stage', version: 1, stage: 'WAITING_PLANNING' }, leader, { database }),
    error => error.code === 'PROJECT_WORKFLOW_STAGE_BLOCKED'
  );
  const updated = await updateProjectWorkflow('project-1', {
    action: 'issue', version: 1, issueId: 'issue-1', description: 'Providenciar equipamento', area: 'Ativos',
    ownerName: 'Leandro', requiredLeadTimeDays: 45, dueDate: '2026-09-20', criticality: 'HIGH', status: 'IN_PROGRESS'
  }, leader, { database });
  const result = await updateProjectWorkflow('project-1', { action: 'stage', version: updated.workflow.version, stage: 'WAITING_PLANNING' }, leader, { database });
  assert.equal(result.workflow.stage, 'WAITING_PLANNING');
});

test('versão desatualizada falha e troca de líder invalida aceite', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  state.workflow.acceptedAt = new Date();
  state.workflow.stage = 'INITIAL_ANALYSIS';
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'settings', version: 99, plannedMobilizationDate: '2027-02-20' }, leader, { database }),
    error => error.code === 'PROJECT_WORKFLOW_VERSION_CONFLICT'
  );
  const result = await updateProjectWorkflow('project-1', { action: 'settings', version: 1, leaderUserId: 'leader-2' }, manager, { database });
  assert.equal(result.workflow.leaderUserId, 'leader-2');
  assert.equal(result.workflow.stage, 'HANDOVER');
  assert.equal(result.workflow.acceptedAt, null);
});

test('listagem usa ordenação aceita pelo Prisma, o dia civil de São Paulo e mantém projeto sem gestão no Handover', async () => {
  const { database, state } = fakeDatabase();
  let result = await listProjectWorkflows({}, viewer, { database, now: new Date('2026-09-10T01:00:00.000Z') });
  assert.deepEqual(state.lastProjectFindManyInput.orderBy, [
    { workflow: { plannedMobilizationDate: 'asc' } },
    { code: 'asc' }
  ]);
  assert.equal(result.items[0].workflow, null);
  assert.equal(result.items[0].permissions.canInitialize, false);
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-10' }, manager, { database });
  result = await listProjectWorkflows({}, leader, { database, now: new Date('2026-09-10T01:00:00.000Z') });
  assert.equal(result.items[0].workflow.milestones.daysUntilMobilization, 1);
  assert.equal(result.items[0].permissions.canEdit, true);
});
