import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_WORKFLOW_COMMERCIAL_FACTS,
  PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_CRITICAL_QUESTIONS
} from '../../shared/schemas/project-workflow.js';
import {
  getProjectWorkflow,
  listProjectWorkflows,
  listProjectWorkflowLeaders,
  startProjectWorkflow,
  updateProjectWorkflow
} from '../src/lib/efetivo/project-workflow/service.js';

function fakeDatabase() {
  const state = {
    project: { id: 'project-1', code: 'P-001', name: 'Flushing', clientName: 'Cliente', location: 'Santos', demobilizationDate: null },
    workflow: null,
    checklists: [],
    answers: [],
    issues: [],
    commercialFacts: [],
    events: [],
    postJob: null,
    measurement: null,
    relatedPostJobs: [],
    operationalMission: null,
    lastProjectFindManyInput: null,
    lastUserFindManyInput: null
  };
  const users = {
    'manager-1': { id: 'manager-1', name: 'Gestora', isActive: true, accountType: 'ADMIN' },
    'leader-1': { id: 'leader-1', name: 'Líder A', isActive: true, accountType: 'INTERNAL' },
    'leader-2': { id: 'leader-2', name: 'Líder B', isActive: true, accountType: 'INTERNAL' },
    'viewer-1': { id: 'viewer-1', name: 'Leitor', isActive: true, accountType: 'INTERNAL' },
    'commercial-1': { id: 'commercial-1', name: 'Comercial', isActive: true, accountType: 'INTERNAL' }
  };
  const withRelations = () => state.workflow ? {
    ...state.workflow,
    leader: users[state.workflow.leaderUserId],
    checklists: state.checklists.map(item => ({ ...item, updatedBy: users[item.updatedByUserId] || null })),
    criticalAnswers: state.answers.map(item => ({ ...item, updatedBy: users[item.updatedByUserId] || null })),
    commercialFacts: state.commercialFacts.map(item => ({ ...item, updatedBy: users[item.updatedByUserId] || null })),
    issues: state.issues.map(item => ({ ...item })),
    events: state.events.map(item => ({ ...item, actor: users[item.actorUserId] || null })).reverse(),
    postJob: state.postJob ? {
      ...state.postJob,
      qualityRecord: state.postJob.qualityRecordId ? { id: state.postJob.qualityRecordId, number: 'L-001/26', deletedAt: null } : null,
      createdBy: users[state.postJob.createdByUserId] || null,
      updatedBy: users[state.postJob.updatedByUserId] || null
    } : null,
    measurement: state.measurement ? {
      ...state.measurement,
      createdBy: users[state.measurement.createdByUserId] || null,
      updatedBy: users[state.measurement.updatedByUserId] || null
    } : null
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
      findFirst: async input => input.where.id === state.project.id ? { ...state.project, plannedServices: [{ serviceType: 'FLUSHING' }], efetivoMissionPlans: state.operationalMission ? [state.operationalMission] : [], ...(input.select?.workflow ? { workflow: withRelations() } : {}) } : null,
      findUnique: async input => input.where.id === state.project.id ? { ...state.project, plannedServices: [{ serviceType: 'FLUSHING' }] } : null,
      update: async input => {
        state.project = { ...state.project, ...input.data };
        return state.project;
      },
      count: async () => 1,
      findMany: async input => {
        state.lastProjectFindManyInput = input;
        return [{ ...state.project, efetivoMissionPlans: state.operationalMission ? [state.operationalMission] : [], workflow: withRelations() }];
      }
    },
    efetivoMissionPlan: { findFirst: async () => state.operationalMission },
    user: {
      findFirst: async input => users[input.where.id] && !['viewer-1', 'commercial-1'].includes(input.where.id) ? users[input.where.id] : null,
      findMany: async input => {
        state.lastUserFindManyInput = input;
        return Object.values(users).filter(item => !['viewer-1', 'commercial-1'].includes(item.id)).map(({ id, name }) => ({ id, name }));
      }
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
          fieldCompletionDate: null,
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
    projectWorkflowCommercialFact: {
      findUnique: async input => state.commercialFacts.find(item => item.projectId === input.where.projectId_key.projectId && item.key === input.where.projectId_key.key) || null,
      upsert: async input => {
        const key = input.where.projectId_key.key;
        const existing = state.commercialFacts.find(item => item.key === key);
        if (existing) Object.assign(existing, input.update, { updatedAt: new Date() });
        else state.commercialFacts.push({ id: `commercial-${state.commercialFacts.length + 1}`, createdAt: new Date(), updatedAt: new Date(), externalId: null, externalUrl: null, sourceVersion: null, sourceUpdatedAt: null, lastSyncedAt: null, ...input.create });
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
    },
    projectWorkflowPostJob: {
      upsert: async input => {
        const now = new Date();
        if (state.postJob) Object.assign(state.postJob, input.update, { updatedAt: now });
        else state.postJob = { createdAt: now, updatedAt: now, ...input.create };
        return state.postJob;
      },
      findMany: async () => state.relatedPostJobs
    },
    projectWorkflowMeasurement: {
      upsert: async input => {
        const now = new Date();
        if (state.measurement) Object.assign(state.measurement, input.update, { updatedAt: now });
        else state.measurement = { createdAt: now, updatedAt: now, ...input.create };
        return state.measurement;
      }
    }
  };
  return { database, state, users };
}

const manager = { actorUserId: 'manager-1', isManager: true, user: { id: 'manager-1', accountType: 'ADMIN' } };
const leader = { actorUserId: 'leader-1', user: { id: 'leader-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:viewer'] } };
const viewer = { actorUserId: 'viewer-1', user: { id: 'viewer-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:viewer'] } };
const commercial = { actorUserId: 'commercial-1', user: { id: 'commercial-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:commercial'] } };
const operations = { actorUserId: 'operations-1', user: { id: 'operations-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:operations'] } };
const assets = { actorUserId: 'assets-1', user: { id: 'assets-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:assets'] } };
const administrative = { actorUserId: 'administrative-1', user: { id: 'administrative-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:administrative'] } };
const qsms = { actorUserId: 'qsms-1', user: { id: 'qsms-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:qsms'] } };

test('gestor inicia handover sem programação de equipe e sem presumir aceite', async () => {
  const { database, state } = fakeDatabase();
  const result = await startProjectWorkflow('project-1', {
    leaderUserId: 'leader-1',
    plannedMobilizationDate: '2027-02-15'
  }, manager, { database, now: new Date('2026-09-09T12:00:00Z') });
  assert.equal(result.workflow.stage, 'HANDOVER');
  assert.equal(result.workflow.acceptedAt, null);
  assert.equal(result.workflow.handoverGate.ready, false);
  assert.ok(result.workflow.handoverGate.issues.length > 0);
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
  assert.equal(updated.workflow.transitionOptions.find(item => item.stage === 'WAITING_PLANNING').allowed, true);
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
  assert.equal(result.items[0].workflow.commercialReadiness.status, 'NOT_RELEASED');
});

test('listagem preserva líder e equipe da programação operacional no card do projeto', async () => {
  const { database, state } = fakeDatabase();
  state.operationalMission = {
    id: 'mission-1',
    stage: 'MOBILIZATION',
    scheduleStatus: 'CONFIRMED',
    version: 3,
    kanbanOrder: 2,
    mobilizationDate: new Date('2026-09-15T00:00:00Z'),
    executionStartDate: new Date('2026-09-16T00:00:00Z'),
    executionEndDate: new Date('2026-09-20T00:00:00Z'),
    returnDate: null,
    headquartersResponsibleName: 'Líder de Campo',
    headquartersResponsibleRole: 'Supervisor',
    headquartersResponsibleCollaboratorId: 'collaborator-1',
    allocations: [{
      id: 'allocation-1',
      collaboratorId: 'collaborator-1',
      jobRoleId: 'role-1',
      collaborator: {
        id: 'collaborator-1',
        name: 'Líder de Campo',
        isActive: true,
        jobRole: { id: 'role-1', name: 'Supervisor' }
      },
      jobRole: { id: 'role-1', name: 'Supervisor' }
    }]
  };
  const result = await listProjectWorkflows({}, manager, { database });
  const mission = result.items[0].operationalMission;
  assert.equal(mission.headquartersResponsibleName, 'Líder de Campo');
  assert.equal(mission.headquartersResponsibleRole, 'Supervisor');
  assert.equal(mission.participantCount, 1);
  assert.equal(mission.allocations[0].collaborator.name, 'Líder de Campo');
  assert.equal(mission.allocations[0].collaborator.role, 'Supervisor');
  assert.equal(state.lastProjectFindManyInput.select.efetivoMissionPlans.select.allocations.select.collaborator.select.jobRole.select.name, true);
});

test('Comercial altera fatos manuais sem receber permissão operacional', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  const result = await updateProjectWorkflow('project-1', {
    action: 'commercial_fact', version: 1, key: 'PURCHASE_ORDER_RECEIVED', status: 'CONFIRMED', reference: 'PO-123', occurredOn: '2026-09-09'
  }, commercial, { database });
  assert.equal(result.workflow.permissions.canEditCommercial, true);
  assert.equal(result.workflow.permissions.canEdit, false);
  assert.equal(result.workflow.commercialFacts.find(item => item.key === 'PURCHASE_ORDER_RECEIVED').reference, 'PO-123');
  assert.equal(state.events.at(-1).action, 'WORKFLOW_COMMERCIAL_FACT');
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'checklist', version: 2, key: 'HANDOVER_WHATSAPP_GROUP', status: 'DONE' }, commercial, { database }),
    error => error.code === 'PROJECT_WORKFLOW_EDIT_FORBIDDEN'
  );
  await assert.rejects(
    startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, commercial, { database }),
    error => error.code === 'PROJECT_WORKFLOW_MANAGER_REQUIRED'
  );
});

test('Líder sem papel Comercial não altera a frente comercial e antigo líder comercial perde poderes operacionais', async () => {
  const { database } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'commercial_fact', version: 1, key: 'CONTRACT_SIGNED', status: 'NOT_APPLICABLE', note: 'Dispensado' }, leader, { database }),
    error => error.code === 'PROJECT_WORKFLOW_COMMERCIAL_EDIT_FORBIDDEN'
  );
  const formerLeader = { actorUserId: 'leader-1', user: { id: 'leader-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:commercial'] } };
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'checklist', version: 1, key: 'HANDOVER_WHATSAPP_GROUP', status: 'DONE' }, formerLeader, { database }),
    error => error.code === 'PROJECT_WORKFLOW_EDIT_FORBIDDEN'
  );
});

test('fato CRM é somente leitura e conflito reverte versão e histórico', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  state.commercialFacts.push({
    id: 'crm-fact', projectId: 'project-1', key: 'CONTRACT_SIGNED', status: 'CONFIRMED', source: 'CRM',
    reference: 'CTR-1', note: null, occurredOn: new Date('2026-09-01T00:00:00Z'), sourceVersion: 'v2', updatedAt: new Date()
  });
  const detail = await getProjectWorkflow('project-1', commercial, { database });
  const crmFact = detail.workflow.commercialFacts.find(item => item.key === 'CONTRACT_SIGNED');
  assert.equal(crmFact.readOnly, true);
  assert.equal(crmFact.sourceVersion, 'v2');
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'commercial_fact', version: 1, key: 'CONTRACT_SIGNED', status: 'PENDING' }, commercial, { database }),
    error => error.code === 'PROJECT_WORKFLOW_CRM_FACT_READ_ONLY' && error.statusCode === 409
  );
  assert.equal(state.workflow.version, 1);
  assert.equal(state.commercialFacts[0].status, 'CONFIRMED');
  assert.equal(state.events.length, 1);
});

test('papel Comercial não pode ser designado Líder nem aparece nos candidatos', async () => {
  const { database, state } = fakeDatabase();
  await assert.rejects(
    startProjectWorkflow('project-1', { leaderUserId: 'commercial-1', plannedMobilizationDate: '2027-02-15' }, manager, { database }),
    error => error.code === 'INVALID_PROJECT_WORKFLOW_LEADER'
  );
  const leaders = await listProjectWorkflowLeaders({ database });
  assert.equal(leaders.some(item => item.id === 'commercial-1'), false);
  assert.deepEqual(state.lastUserFindManyInput.where.OR[1].moduleRoles.some.role.in, ['EFETIVO_MANAGER', 'EFETIVO_VIEWER']);
});

test('oito fatos válidos liberam comercial sem mover a etapa', async () => {
  const { database } = fakeDatabase();
  let result = await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  for (const definition of PROJECT_WORKFLOW_COMMERCIAL_FACTS) {
    result = await updateProjectWorkflow('project-1', {
      action: 'commercial_fact',
      version: result.workflow.version,
      key: definition.key,
      status: 'CONFIRMED',
      occurredOn: '2026-09-09',
      reference: definition.evidence === 'reference' ? 'REF-1' : null,
      note: definition.evidence === 'note' ? 'Condição definida' : null
    }, manager, { database });
  }
  assert.equal(result.workflow.commercialReadiness.status, 'RELEASED');
  assert.equal(result.workflow.stage, 'HANDOVER');
  const list = await listProjectWorkflows({}, manager, { database });
  assert.equal(list.items[0].workflow.commercialReadiness.status, result.workflow.commercialReadiness.status);
});

test('áreas editam somente seus checklists e não obtêm poderes do Líder', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  let detail = await getProjectWorkflow('project-1', administrative, { database, now: new Date('2026-09-09T12:00:00Z') });
  const documentItem = detail.workflow.checklists.find(item => item.key === 'DOCUMENT_CLIENT_REQUIREMENTS');
  const handoverItem = detail.workflow.checklists.find(item => item.key === 'HANDOVER_WHATSAPP_GROUP');
  assert.equal(documentItem.canEdit, true);
  assert.equal(handoverItem.canEdit, false);
  detail = await updateProjectWorkflow('project-1', { action: 'checklist', version: 1, key: documentItem.key, status: 'DONE' }, administrative, { database });
  assert.equal(detail.workflow.documentationReadiness.completed, 1);
  state.workflow.stage = 'MOBILIZATION_PLANNING';
  detail = await updateProjectWorkflow('project-1', { action: 'checklist', version: 2, key: 'D30_TEAM_QUANTITY_CONFIRMED', status: 'DONE' }, operations, { database });
  assert.equal(detail.workflow.planningReadiness.completed, 1);
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'checklist', version: 3, key: 'D30_EQUIPMENT_LIST_DEFINED', status: 'DONE' }, operations, { database }),
    error => error.code === 'PROJECT_WORKFLOW_CHECKLIST_EDIT_FORBIDDEN'
  );
  const assetsDetail = await updateProjectWorkflow('project-1', { action: 'checklist', version: 3, key: 'D30_EQUIPMENT_LIST_DEFINED', status: 'DONE' }, assets, { database });
  assert.equal(assetsDetail.workflow.planningReadiness.completed, 2);
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'stage', version: 4, stage: 'WAITING_PLANNING' }, operations, { database }),
    error => error.code === 'PROJECT_WORKFLOW_EDIT_FORBIDDEN'
  );
});

test('checklist de outra etapa não pode ser antecipado por chamada direta', async () => {
  const { database } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'checklist', version: 1, key: 'D30_TEAM_QUANTITY_CONFIRMED', status: 'DONE' }, manager, { database }),
    error => error.code === 'PROJECT_WORKFLOW_CHECKLIST_STAGE_FORBIDDEN'
  );
});

function makeStateReadyForMobilization(state) {
  state.workflow.stage = 'PREPARATION';
  state.workflow.acceptedAt = new Date('2026-09-01T12:00:00Z');
  state.checklists.push(...PROJECT_WORKFLOW_CHECKLISTS
    .filter(item => item.section === 'ADVANCE_DOCUMENTATION' || item.section.startsWith('D15_'))
    .filter(item => !state.checklists.some(existing => existing.key === item.key))
    .map(item => ({ id: `check-${item.key}`, projectId: 'project-1', key: item.key, status: 'DONE' })));
  state.commercialFacts.push(...PROJECT_WORKFLOW_COMMERCIAL_FACTS.map(item => ({
    id: `fact-${item.key}`,
    projectId: 'project-1',
    key: item.key,
    status: 'CONFIRMED',
    source: 'MANUAL',
    occurredOn: new Date('2026-09-09T00:00:00Z'),
    reference: item.evidence === 'reference' ? 'REF-1' : null,
    note: item.evidence === 'note' ? 'Condição definida' : null
  })));
}

test('D-30 completo permite entrar em Preparação', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  state.workflow.stage = 'MOBILIZATION_PLANNING';
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'stage', version: 1, stage: 'PREPARATION' }, leader, { database }),
    error => error.code === 'PROJECT_WORKFLOW_STAGE_BLOCKED'
  );
  state.checklists.push(...PROJECT_WORKFLOW_CHECKLISTS
    .filter(item => item.section.startsWith('D30_'))
    .map(item => ({ id: `check-${item.key}`, projectId: 'project-1', key: item.key, status: 'DONE' })));
  const result = await updateProjectWorkflow('project-1', { action: 'stage', version: 1, stage: 'PREPARATION' }, leader, { database });
  assert.equal(result.workflow.stage, 'PREPARATION');
  assert.equal(result.workflow.preparationReadiness.total, 39);
});

test('QSMS edita sua frente sem avançar a etapa', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  state.workflow.stage = 'PREPARATION';
  const result = await updateProjectWorkflow('project-1', { action: 'checklist', version: 1, key: 'D15_QSMS_REQUIREMENTS_CHECKED', status: 'DONE' }, qsms, { database });
  assert.equal(result.workflow.preparationReadiness.completed, 1);
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'checklist', version: 2, key: 'D15_EQUIPMENT_TESTED', status: 'DONE' }, qsms, { database }),
    error => error.code === 'PROJECT_WORKFLOW_CHECKLIST_EDIT_FORBIDDEN'
  );
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'stage', version: 2, stage: 'MOBILIZATION_PLANNING' }, qsms, { database }),
    error => error.code === 'PROJECT_WORKFLOW_EDIT_FORBIDDEN'
  );
});

test('gate verde emite autorização versionada e alteração posterior a suspende', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  makeStateReadyForMobilization(state);
  let result = await updateProjectWorkflow('project-1', { action: 'stage', version: 1, stage: 'READY_TO_MOBILIZE' }, leader, {
    database,
    now: new Date('2026-09-09T18:00:00Z')
  });
  assert.equal(result.workflow.stage, 'READY_TO_MOBILIZE');
  assert.equal(result.workflow.mobilizationAuthorization.status, 'AUTHORIZED');
  assert.equal(result.workflow.mobilizationAuthorization.authorizedVersion, 2);
  result = await updateProjectWorkflow('project-1', { action: 'checklist', version: 2, key: 'D15_EQUIPMENT_TESTED', status: 'PENDING' }, assets, { database });
  assert.equal(result.workflow.mobilizationAuthorization.status, 'SUSPENDED');
  assert.equal(result.workflow.mobilizationGate.ready, false);
  result = await updateProjectWorkflow('project-1', { action: 'checklist', version: 3, key: 'D15_EQUIPMENT_TESTED', status: 'DONE' }, assets, { database });
  assert.equal(result.workflow.mobilizationGate.ready, true);
  assert.equal(result.workflow.mobilizationAuthorization.status, 'SUSPENDED');
  result = await updateProjectWorkflow('project-1', { action: 'authorize_mobilization', version: 4 }, leader, {
    database,
    now: new Date('2026-09-10T09:00:00Z')
  });
  assert.equal(result.workflow.mobilizationAuthorization.status, 'AUTHORIZED');
  assert.equal(result.workflow.mobilizationAuthorization.authorizedVersion, 5);
  assert.equal(state.events.at(-1).action, 'WORKFLOW_AUTHORIZE_MOBILIZATION');
});

test('avanço para execução transporta a autorização para a nova versão', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  makeStateReadyForMobilization(state);
  const synchronizedStages = [];
  let result = await updateProjectWorkflow('project-1', { action: 'stage', version: 1, stage: 'READY_TO_MOBILIZE' }, leader, {
    database,
    now: new Date('2026-09-09T18:00:00Z'),
    synchronizeOfficialMissionStage: async (_tx, _projectId, stage) => synchronizedStages.push(stage)
  });
  result = await updateProjectWorkflow('project-1', { action: 'stage', version: 2, stage: 'MOBILIZATION' }, leader, {
    database,
    now: new Date('2026-09-10T09:00:00Z'),
    synchronizeOfficialMissionStage: async (_tx, _projectId, stage) => synchronizedStages.push(stage)
  });
  result = await updateProjectWorkflow('project-1', { action: 'stage', version: 3, stage: 'EXECUTION' }, leader, {
    database,
    now: new Date('2026-09-10T10:00:00Z'),
    synchronizeOfficialMissionStage: async (_tx, _projectId, stage) => synchronizedStages.push(stage)
  });
  assert.equal(result.workflow.stage, 'EXECUTION');
  assert.equal(result.workflow.version, 4);
  assert.equal(result.workflow.mobilizationAuthorization.status, 'AUTHORIZED');
  assert.equal(result.workflow.mobilizationAuthorization.authorizedVersion, 4);
  assert.deepEqual(synchronizedStages, ['MOBILIZATION', 'EXECUTION']);
});

test('desmobilização sincroniza etapa e datas sem perder os dados operacionais', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  makeStateReadyForMobilization(state);
  const synchronizedStages = [];
  const stageDependencies = {
    database,
    synchronizeOfficialMissionStage: async (_tx, _projectId, stage) => synchronizedStages.push(stage)
  };
  let result = await updateProjectWorkflow('project-1', { action: 'stage', version: 1, stage: 'READY_TO_MOBILIZE' }, leader, stageDependencies);
  result = await updateProjectWorkflow('project-1', { action: 'stage', version: 2, stage: 'MOBILIZATION' }, leader, stageDependencies);
  result = await updateProjectWorkflow('project-1', { action: 'stage', version: 3, stage: 'EXECUTION' }, leader, stageDependencies);
  result = await updateProjectWorkflow('project-1', { action: 'stage', version: 4, stage: 'DEMOBILIZATION' }, leader, stageDependencies);
  assert.equal(result.workflow.stage, 'DEMOBILIZATION');
  assert.equal(result.workflow.demobilizationReadiness.total, 15);
  assert.deepEqual(synchronizedStages, ['MOBILIZATION', 'EXECUTION', 'DEMOBILIZATION']);
  assert.equal(result.workflow.mobilizationAuthorization.authorized, false);

  result = await updateProjectWorkflow('project-1', {
    action: 'demobilization', version: 5, fieldCompletionDate: '2026-09-20', returnDate: '2026-09-22'
  }, leader, {
    database,
    synchronizeOfficialMissionDemobilization: async (_tx, _projectId, returnDate) => {
      state.project.demobilizationDate = new Date(`${returnDate}T00:00:00Z`);
    }
  });
  assert.equal(result.workflow.fieldCompletionDate, '2026-09-20');
  assert.equal(result.workflow.demobilizationDate, '2026-09-22');
  assert.equal(state.events.at(-1).action, 'WORKFLOW_DEMOBILIZATION');

  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'demobilization', version: 6, returnDate: '2026-09-19' }, leader, { database }),
    error => error.code === 'INVALID_PROJECT_WORKFLOW_DEMOBILIZATION'
  );
  assert.equal(state.workflow.version, 6);

  result = await updateProjectWorkflow('project-1', {
    action: 'checklist', version: 6, key: 'DEMOB_FIELD_SCOPE_COMPLETED', status: 'DONE'
  }, operations, { database });
  assert.equal(result.workflow.demobilizationReadiness.completed, 1);
});

test('datas efetivas não podem ser antecipadas fora da desmobilização', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'demobilization', version: 1, fieldCompletionDate: '2026-09-20' }, leader, { database }),
    error => error.code === 'PROJECT_WORKFLOW_DEMOBILIZATION_STAGE_REQUIRED'
  );
  assert.equal(state.workflow.version, 1);
  assert.equal(state.workflow.fieldCompletionDate, null);
});

test('Pós-job persiste fechamento, sincroniza Qualidade e expõe histórico relacionado', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  state.workflow.stage = 'DEMOBILIZATION';
  state.workflow.fieldCompletionDate = new Date('2026-09-20T00:00:00Z');
  state.project.demobilizationDate = new Date('2026-09-22T00:00:00Z');
  state.checklists.push(...PROJECT_WORKFLOW_CHECKLISTS
    .filter(item => item.stage === 'DEMOBILIZATION')
    .map(item => ({ id: `check-${item.key}`, projectId: 'project-1', key: item.key, status: 'DONE' })));
  const synchronizedStages = [];
  let detail = await updateProjectWorkflow('project-1', { action: 'stage', version: 1, stage: 'POST_JOB' }, leader, {
    database,
    synchronizeOfficialMissionStage: async (_tx, _projectId, stage) => synchronizedStages.push(stage)
  });
  assert.equal(detail.workflow.stage, 'POST_JOB');
  assert.deepEqual(synchronizedStages, ['POST_JOB']);
  assert.equal(detail.workflow.postJobReadiness.total, 9);

  let synchronizedInput = null;
  detail = await updateProjectWorkflow('project-1', {
    action: 'post_job',
    version: 2,
    meetingDate: '2026-09-25',
    fieldLeaderFeedback: 'Execução segura.',
    lessonsLearned: 'Identificar kits por sistema.'
  }, leader, {
    database,
    synchronizePostJobQualityRecord: async (_tx, input) => {
      synchronizedInput = input;
      return 'quality-1';
    }
  });
  assert.equal(detail.workflow.postJob.meetingDate, '2026-09-25');
  assert.equal(detail.workflow.postJob.qualityRecord.number, 'L-001/26');
  assert.deepEqual(detail.workflow.postJob.serviceTypes, ['FLUSHING']);
  assert.equal(Object.hasOwn(detail.workflow.postJob, 'qualityRecordId'), false);
  assert.equal(Object.hasOwn(detail.workflow.postJob, 'createdByUserId'), false);
  assert.equal(synchronizedInput.postJob.lessonsLearned, 'Identificar kits por sistema.');
  assert.equal(state.events.at(-1).action, 'WORKFLOW_POST_JOB');

  detail = await updateProjectWorkflow('project-1', {
    action: 'checklist', version: 3, key: 'POST_JOB_MEETING_COMPLETED', status: 'DONE'
  }, leader, { database });
  assert.equal(detail.workflow.postJobReadiness.completed, 1);

  state.relatedPostJobs.push({
    projectId: 'project-2',
    meetingDate: new Date('2026-08-10T00:00:00Z'),
    serviceTypes: ['FLUSHING'],
    problemsFound: 'Kit sem etiqueta.',
    solutionsAdopted: 'Etiquetagem em campo.',
    improvementOpportunities: 'Etiquetar na sede.',
    lessonsLearned: 'Separar antes da viagem.',
    equipmentFeedback: null,
    planningFeedback: null,
    qualityRecord: { id: 'quality-2', number: 'L-002/26', deletedAt: null },
    workflow: { project: { code: 'P-002', name: 'Flushing anterior', clientName: 'Cliente' } }
  });
  detail = await getProjectWorkflow('project-1', leader, { database });
  assert.equal(detail.workflow.relatedPostJobs.length, 1);
  assert.equal(detail.workflow.relatedPostJobs[0].matches.sameClient, true);
  assert.deepEqual(detail.workflow.relatedPostJobs[0].matches.services, ['FLUSHING']);
});

test('Documentação e medição avança pelo gate e persiste valores auditáveis', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  state.workflow.stage = 'POST_JOB';
  state.postJob = { projectId: 'project-1', meetingDate: new Date('2026-09-25T00:00:00Z'), serviceTypes: ['FLUSHING'], createdAt: new Date(), updatedAt: new Date() };
  state.checklists.push(...PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.stage === 'POST_JOB').map(item => ({ id: `check-${item.key}`, projectId: 'project-1', key: item.key, status: 'DONE' })));
  const synchronizedStages = [];
  let detail = await updateProjectWorkflow('project-1', { action: 'stage', version: 1, stage: 'FINAL_MEASUREMENT' }, leader, {
    database,
    synchronizeOfficialMissionStage: async (_tx, _projectId, stage) => synchronizedStages.push(stage)
  });
  assert.equal(detail.workflow.stage, 'FINAL_MEASUREMENT');
  assert.deepEqual(synchronizedStages, ['FINAL_MEASUREMENT']);
  assert.equal(detail.workflow.closeoutReadiness.total, 14);

  detail = await updateProjectWorkflow('project-1', {
    action: 'measurement',
    version: 2,
    quantitiesSummary: 'Quantitativos consolidados.',
    executedAmount: 835000,
    measuredAmount: 835000,
    approvedAmount: 820000,
    preparedAt: '2026-09-26',
    sentAt: '2026-09-27',
    approvedAt: '2026-09-30'
  }, leader, { database });
  assert.equal(detail.workflow.measurement.approvedAmount, 820000);
  assert.equal(detail.workflow.measurement.approvedAt, '2026-09-30');
  assert.equal(detail.workflow.measurement.updatedBy.name, 'Líder A');
  assert.equal(state.events.at(-1).action, 'WORKFLOW_MEASUREMENT');

  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'measurement', version: 3, measuredAmount: 840000 }, leader, { database }),
    error => error.code === 'PROJECT_WORKFLOW_MEASUREMENT_INVALID'
  );
  assert.equal(state.workflow.version, 3);
});

test('gate bloqueado impede autorização e papel de área não pode revalidar', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-10' }, manager, { database });
  makeStateReadyForMobilization(state);
  state.checklists = state.checklists.filter(item => item.key !== 'D15_MATERIALS_FILTERS_SEPARATED');
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'stage', version: 1, stage: 'READY_TO_MOBILIZE' }, leader, { database }),
    error => error.code === 'PROJECT_WORKFLOW_STAGE_BLOCKED'
  );
  state.workflow.stage = 'READY_TO_MOBILIZE';
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'authorize_mobilization', version: 1 }, operations, { database }),
    error => error.code === 'PROJECT_WORKFLOW_EDIT_FORBIDDEN'
  );
});
