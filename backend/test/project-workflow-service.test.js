import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_WORKFLOW_COMMERCIAL_FACTS,
  PROJECT_WORKFLOW_CHECKLISTS,
  PROJECT_WORKFLOW_CLIENT_RELEASES,
  PROJECT_WORKFLOW_CRITICAL_QUESTIONS,
  PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS,
  PROJECT_WORKFLOW_TEAM_MEMBER_CHECKS
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
    project: { id: 'project-1', code: 'P-001', name: 'Flushing', clientName: 'Cliente', location: 'Santos', mobilizationDate: null, startDate: null, demobilizationDate: null },
    workflow: null,
    checklists: [],
    teamMemberChecks: [],
    preparationItemChecks: [],
    clientReleases: [],
    answers: [],
    issues: [],
    commercialFacts: [],
    documentationCategories: [],
    documentationRequirements: [],
    documentationHistory: [],
    teamDemands: [],
    equipmentCategoryPlans: [],
    jobRoles: [{ id: 'role-1', name: 'Mecânico', calendarColor: '#2563EB', order: 1, isActive: true, isOperational: true }],
    equipmentCategories: [{
      id: 'category-1', name: 'Bombas', order: 1, isActive: true, supportsCalibration: false, maintenanceIntervalDays: null,
      equipment: [{ id: 'equipment-1', code: 'B-01', name: 'Bomba 1', isActive: true, hasCalibration: false, expiresAt: null, maintenanceRecords: [] }]
    }],
    stockItems: [
      { id: 'stock-filter-1', type: 'FILTRO', code: 'F-001', name: 'Filtro 10 µm', unitLabel: 'un', isActive: true, category: { name: 'Filtros cartucho' } },
      { id: 'stock-chemical-1', type: 'PRODUTO_QUIMICO', code: 'Q-001', name: 'Desengraxante', unitLabel: 'L', isActive: true, category: { name: 'Produtos químicos' } }
    ],
    stockMovements: [
      { itemId: 'stock-filter-1', type: 'ENTRADA', quantity: 4 },
      { itemId: 'stock-chemical-1', type: 'ENTRADA', quantity: 20 }
    ],
    events: [],
    postJob: null,
    measurement: null,
    relatedPostJobs: [],
    operationalMission: null,
    lastProjectFindManyInput: null,
    lastUserFindManyInput: null
  };
  const users = {
    'manager-1': { id: 'manager-1', name: 'Gestora', email: 'gestora@example.com', isActive: true, accountType: 'ADMIN' },
    'leader-1': { id: 'leader-1', name: 'Líder A', email: 'lider.a@example.com', isActive: true, accountType: 'INTERNAL' },
    'leader-2': { id: 'leader-2', name: 'Líder B', email: 'lider.b@example.com', isActive: true, accountType: 'INTERNAL' },
    'viewer-1': { id: 'viewer-1', name: 'Leitor', isActive: true, accountType: 'INTERNAL' },
    'commercial-1': { id: 'commercial-1', name: 'Comercial', isActive: true, accountType: 'INTERNAL' }
  };
  const withRelations = () => state.workflow ? {
    ...state.workflow,
    leader: users[state.workflow.leaderUserId],
    planner: users[state.workflow.plannerUserId] || null,
    closedBy: users[state.workflow.closedByUserId] || null,
    checklists: state.checklists.map(item => ({ ...item, updatedBy: users[item.updatedByUserId] || null })),
    teamMemberChecks: state.teamMemberChecks.map(item => ({ ...item, updatedBy: users[item.updatedByUserId] || null })),
    preparationItemChecks: state.preparationItemChecks.map(item => ({ ...item, updatedBy: users[item.updatedByUserId] || null })),
    clientReleases: state.clientReleases.map(item => ({ ...item, updatedBy: users[item.updatedByUserId] || null })),
    criticalAnswers: state.answers.map(item => ({ ...item, updatedBy: users[item.updatedByUserId] || null })),
    commercialFacts: state.commercialFacts.map(item => ({ ...item, updatedBy: users[item.updatedByUserId] || null })),
    documentationCategories: state.documentationCategories.map(category => ({
      ...category,
      updatedBy: users[category.updatedByUserId] || null,
      requirements: state.documentationRequirements.filter(item => item.categoryId === category.id).map(requirement => ({
        ...requirement,
        createdBy: users[requirement.createdByUserId] || null,
        updatedBy: users[requirement.updatedByUserId] || null,
        history: state.documentationHistory.filter(item => item.requirementId === requirement.id).map(item => ({ ...item, actor: users[item.actorUserId] || null })).reverse()
      }))
    })),
    teamDemands: state.teamDemands.map(item => ({ ...item, jobRole: state.jobRoles.find(role => role.id === item.jobRoleId) })),
    equipmentCategoryPlans: state.equipmentCategoryPlans.map(item => ({ ...item, category: state.equipmentCategories.find(category => category.id === item.categoryId) })),
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
        return Object.values(users).filter(item => !['viewer-1', 'commercial-1'].includes(item.id)).map(({ id, name, email }) => ({ id, name, email }));
      }
    },
    projectWorkflow: {
      create: async input => {
        if (state.workflow) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        state.workflow = {
          projectId: input.data.projectId,
          stage: 'HANDOVER',
          leaderUserId: input.data.leaderUserId,
          plannerUserId: input.data.plannerUserId,
          acceptedAt: null,
          plannedMobilizationDate: input.data.plannedMobilizationDate,
          commercialExpectedMobilizationDate: null,
          commercialExpectedStartDate: null,
          analysisClientContactMade: null,
          analysisClientContactName: null,
          analysisClientContactPhone: null,
          analysisClientContactDate: null,
          isCritical: null,
          preparationLeadTimeDays: 15,
          teamPlanDefined: null,
          equipmentPlanDefined: null,
          supplyPlanDefined: null,
          supplyPlan: [],
          logisticsPlan: {},
          travelPlan: {},
          preJobScheduledDate: null,
          preJobCompletedDate: null,
          qsmsVerified: null,
          qsmsVerificationNote: null,
          fieldCompletionDate: null,
          closedAt: null,
          closedByUserId: null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        state.checklists.push(...(input.data.checklists?.create || []).map((item, index) => ({ id: `check-${index}`, projectId: state.project.id, ...item })));
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
    projectWorkflowTeamMemberCheck: {
      upsert: async input => {
        const key = input.where.projectId_collaboratorId_key;
        const existing = state.teamMemberChecks.find(item => item.projectId === key.projectId && item.collaboratorId === key.collaboratorId && item.key === key.key);
        if (existing) Object.assign(existing, input.update, { updatedAt: new Date() });
        else state.teamMemberChecks.push({ id: `team-check-${state.teamMemberChecks.length + 1}`, createdAt: new Date(), updatedAt: new Date(), sourceRecordId: null, sourceUpdatedAt: null, ...input.create });
      }
    },
    projectWorkflowPreparationItemCheck: {
      deleteMany: async input => {
        const previousLength = state.preparationItemChecks.length;
        state.preparationItemChecks = state.preparationItemChecks.filter(item => (
          item.projectId !== input.where.projectId || item.itemType !== input.where.itemType
        ));
        return { count: previousLength - state.preparationItemChecks.length };
      },
      upsert: async input => {
        const key = input.where.projectId_itemType_itemId_key;
        const existing = state.preparationItemChecks.find(item => item.projectId === key.projectId && item.itemType === key.itemType && item.itemId === key.itemId && item.key === key.key);
        if (existing) Object.assign(existing, input.update, { updatedAt: new Date() });
        else state.preparationItemChecks.push({ id: `preparation-item-check-${state.preparationItemChecks.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...input.create });
      }
    },
    projectWorkflowClientRelease: {
      upsert: async input => {
        const key = input.where.projectId_key.key;
        const existing = state.clientReleases.find(item => item.key === key);
        if (existing) Object.assign(existing, input.update, { updatedAt: new Date() });
        else state.clientReleases.push({ id: `client-release-${state.clientReleases.length + 1}`, attendanceDate: null, attendanceConfirmedAt: null, requested: false, requestedAt: null, requestedTo: null, completed: false, completedAt: null, sourceRecordId: null, sourceUpdatedAt: null, createdAt: new Date(), updatedAt: new Date(), ...input.create });
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
    projectWorkflowTeamDemand: {
      deleteMany: async input => {
        state.teamDemands = state.teamDemands.filter(item => item.projectId !== input.where.projectId);
        return { count: 0 };
      },
      createMany: async input => {
        state.teamDemands.push(...input.data.map((item, index) => ({ id: `team-demand-${index + 1}`, ...item })));
        return { count: input.data.length };
      }
    },
    projectWorkflowEquipmentCategoryPlan: {
      deleteMany: async input => {
        state.equipmentCategoryPlans = state.equipmentCategoryPlans.filter(item => item.projectId !== input.where.projectId);
        return { count: 0 };
      },
      createMany: async input => {
        state.equipmentCategoryPlans.push(...input.data.map((item, index) => ({ id: `equipment-plan-${index + 1}`, ...item })));
        return { count: input.data.length };
      }
    },
    jobRole: {
      findMany: async input => state.jobRoles.filter(role => (!input.where?.id?.in || input.where.id.in.includes(role.id)) && role.isActive && role.isOperational)
    },
    equipmentCategory: {
      findMany: async input => state.equipmentCategories.filter(category => (!input.where?.id?.in || input.where.id.in.includes(category.id)) && category.isActive)
    },
    stockItem: {
      findMany: async input => state.stockItems.filter(item => (
        (!input.where?.id?.in || input.where.id.in.includes(item.id))
        && item.isActive
        && (!input.where?.type?.in || input.where.type.in.includes(item.type))
      ))
    },
    stockMovement: {
      groupBy: async input => {
        const allowed = input.where?.itemId?.in || state.stockItems.map(item => item.id);
        return state.stockMovements.filter(item => allowed.includes(item.itemId)).map(item => ({
          itemId: item.itemId,
          type: item.type,
          _sum: { quantity: item.quantity }
        }));
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
    projectWorkflowDocumentationCategory: {
      upsert: async input => {
        const { projectId, type } = input.where.projectId_type;
        let category = state.documentationCategories.find(item => item.projectId === projectId && item.type === type);
        if (category) Object.assign(category, input.update, { updatedAt: new Date() });
        else {
          category = { id: `documentation-category-${state.documentationCategories.length + 1}`, projectId, type, required: null, createdAt: new Date(), updatedAt: new Date(), ...input.create };
          state.documentationCategories.push(category);
        }
        return category;
      }
    },
    projectWorkflowDocumentationRequirement: {
      create: async input => {
        const requirement = { id: `documentation-requirement-${state.documentationRequirements.length + 1}`, status: 'PENDING', requestedAt: null, confirmedAt: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(), ...input.data };
        state.documentationRequirements.push(requirement);
        return requirement;
      },
      findFirst: async input => state.documentationRequirements.find(item => item.id === input.where.id && state.documentationCategories.some(category => category.id === item.categoryId && category.projectId === input.where.category.projectId)) || null,
      update: async input => {
        const requirement = state.documentationRequirements.find(item => item.id === input.where.id);
        Object.assign(requirement, input.data, { updatedAt: new Date() });
        return requirement;
      }
    },
    projectWorkflowDocumentationHistory: {
      create: async input => {
        const entry = { id: `documentation-history-${state.documentationHistory.length + 1}`, createdAt: new Date(), ...input.data };
        state.documentationHistory.push(entry);
        return entry;
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
      updateMany: async input => {
        const matches = state.issues.filter(item => item.projectId === input.where.projectId && item.sourceQuestion === input.where.sourceQuestion);
        matches.forEach(item => Object.assign(item, input.data, { updatedAt: new Date() }));
        return { count: matches.length };
      },
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
      },
      findMany: async input => state.events
        .filter(event => event.projectId === input.where.projectId && input.where.action.in.includes(event.action))
        .sort((left, right) => left.createdAt - right.createdAt)
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
const planner = { actorUserId: 'leader-2', user: { id: 'leader-2', accountType: 'INTERNAL', moduleRoles: ['efetivo:viewer'] } };
const viewer = { actorUserId: 'viewer-1', user: { id: 'viewer-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:viewer'] } };
const commercial = { actorUserId: 'commercial-1', user: { id: 'commercial-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:commercial'] } };
const operations = { actorUserId: 'operations-1', user: { id: 'operations-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:operations'] } };
const assets = { actorUserId: 'assets-1', user: { id: 'assets-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:assets'] } };
const supplies = { actorUserId: 'supplies-1', user: { id: 'supplies-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:supplies'] } };
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
  assert.equal(result.workflow.planner.id, 'leader-1');
  assert.equal(result.workflow.handoverGate.ready, true);
  assert.equal(result.workflow.handoverGate.issues.length, 0);
  assert.equal(result.workflow.checklists.filter(item => item.stage === 'HANDOVER').length, 0);
  assert.equal(state.events[0].action, 'WORKFLOW_STARTED');
});

test('gestor inicia handover sem mobilização prevista e configura antecedência de obra crítica', async () => {
  const { database, state } = fakeDatabase();
  let result = await startProjectWorkflow('project-1', {
    leaderUserId: 'leader-1',
    plannerUserId: 'leader-2'
  }, manager, { database, now: new Date('2026-09-09T12:00:00Z') });
  assert.equal(result.workflow.plannedMobilizationDate, null);
  assert.deepEqual(result.workflow.milestones.items, []);

  state.workflow.stage = 'INITIAL_ANALYSIS';
  result = await updateProjectWorkflow('project-1', {
    action: 'analysis_criticality', version: 1, isCritical: true, preparationLeadTimeDays: 45
  }, leader, { database, now: new Date('2026-09-09T12:00:00Z') });
  assert.equal(result.workflow.isCritical, true);
  assert.equal(result.workflow.preparationLeadTimeDays, 45);
  assert.equal(result.workflow.milestones.preparationLeadTimeDays, 45);

  result = await updateProjectWorkflow('project-1', {
    action: 'settings', version: result.workflow.version, plannedMobilizationDate: '2026-10-29'
  }, leader, { database, now: new Date('2026-09-09T12:00:00Z') });
  assert.equal(result.workflow.plannedMobilizationDate, '2026-10-29');
  assert.equal(result.workflow.milestones.preparationDate, '2026-09-14');

  result = await updateProjectWorkflow('project-1', {
    action: 'settings', version: result.workflow.version, plannedMobilizationDate: null
  }, leader, { database, now: new Date('2026-09-09T12:00:00Z') });
  assert.equal(result.workflow.plannedMobilizationDate, null);
  assert.deepEqual(result.workflow.milestones.items, []);
});

test('planejador vinculado mantém o workflow sem assumir aceite ou autorização do Líder', async () => {
  const { database, state } = fakeDatabase();
  let result = await startProjectWorkflow('project-1', {
    leaderUserId: 'leader-1',
    plannerUserId: 'leader-2',
    plannedMobilizationDate: '2027-02-15'
  }, manager, { database });
  assert.equal(result.workflow.leader.id, 'leader-1');
  assert.equal(result.workflow.planner.id, 'leader-2');
  result = await getProjectWorkflow('project-1', planner, { database });
  assert.equal(result.workflow.permissions.canEdit, true);
  assert.equal(result.workflow.permissions.canAccept, false);
  assert.equal(result.workflow.permissions.canAuthorizeMobilization, false);

  result = await updateProjectWorkflow('project-1', {
    action: 'settings', version: 1, plannedMobilizationDate: '2027-02-20'
  }, planner, { database });
  assert.equal(result.workflow.plannedMobilizationDate, '2027-02-20');

  state.workflow.stage = 'READY_TO_MOBILIZE';
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'authorize_mobilization', version: 2 }, planner, { database }),
    error => error.code === 'PROJECT_WORKFLOW_AUTHORIZATION_FORBIDDEN'
  );
});

test('somente o líder designado aceita o handover informativo', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'accept', version: 1 }, viewer, { database }),
    error => error.code === 'PROJECT_WORKFLOW_EDIT_FORBIDDEN'
  );
  const result = await updateProjectWorkflow('project-1', { action: 'accept', version: 1 }, leader, { database, now: new Date('2026-09-10T10:00:00Z') });
  assert.equal(result.workflow.stage, 'INITIAL_ANALYSIS');
  assert.equal(result.workflow.acceptedAt.toISOString(), '2026-09-10T10:00:00.000Z');
  const { HANDOVER, INITIAL_ANALYSIS } = result.workflow.stageTimeline;
  assert.ok(HANDOVER.enteredAt, 'início da gestão abre o Handover');
  assert.equal(HANDOVER.completedAt, INITIAL_ANALYSIS.enteredAt, 'o aceite conclui o Handover e abre a análise');
  assert.equal(INITIAL_ANALYSIS.completedAt, null);
});

test('pendência só aparece enquanto o item crítico correspondente está em Sim', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  let detail = await updateProjectWorkflow('project-1', { action: 'critical', version: 1, key: 'SPECIAL_EQUIPMENT', answer: true }, leader, { database });
  assert.equal(state.issues.length, 1);
  assert.equal(state.issues[0].area, 'Ativos');
  assert.equal(detail.workflow.issues.length, 1);
  detail = await updateProjectWorkflow('project-1', { action: 'critical', version: 2, key: 'SPECIAL_EQUIPMENT', answer: false }, leader, { database });
  assert.equal(detail.workflow.issues.length, 0);
  assert.equal(state.issues[0].status, 'RESOLVED');
  let list = await listProjectWorkflows({}, leader, { database });
  assert.equal(list.items[0].workflow.issueCount, 0);
  detail = await updateProjectWorkflow('project-1', { action: 'critical', version: 3, key: 'SPECIAL_EQUIPMENT', answer: true }, leader, { database });
  assert.equal(state.issues.length, 1);
  assert.equal(state.issues[0].status, 'OPEN');
  assert.equal(detail.workflow.issues.length, 1);
  list = await listProjectWorkflows({}, leader, { database });
  assert.equal(list.items[0].workflow.issueCount, 1);
});

test('requisito documental crítico usa os cards e não cria pendência genérica', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  const detail = await updateProjectWorkflow('project-1', { action: 'critical', version: 1, key: 'CLIENT_REQUIREMENTS', answer: true }, leader, { database });
  assert.equal(state.issues.length, 0);
  assert.equal(detail.workflow.criticalAnswers.find(item => item.key === 'CLIENT_REQUIREMENTS').answer, true);
});

test('análise bloqueia pendência sem responsável/prazo e libera após encaminhamento', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  state.workflow.stage = 'INITIAL_ANALYSIS';
  state.workflow.acceptedAt = new Date();
  state.workflow.analysisClientContactMade = true;
  state.workflow.analysisClientContactName = 'Marina';
  state.workflow.analysisClientContactPhone = '(11) 99999-9999';
  state.workflow.analysisClientContactDate = new Date('2026-09-10T00:00:00Z');
  state.workflow.isCritical = false;
  state.checklists.push(...PROJECT_WORKFLOW_CHECKLISTS.filter(item => item.stage === 'INITIAL_ANALYSIS').map(item => ({ id: item.key, projectId: 'project-1', key: item.key, status: 'DONE' })));
  state.answers.push(...PROJECT_WORKFLOW_CRITICAL_QUESTIONS.map(item => ({ id: item.key, projectId: 'project-1', key: item.key, answer: item.key === 'SPECIAL_EQUIPMENT' })));
  state.issues.push({ id: 'issue-1', projectId: 'project-1', sourceQuestion: 'SPECIAL_EQUIPMENT', description: 'Equipamento', area: 'Ativos', ownerName: null, requiredLeadTimeDays: null, dueDate: null, criticality: 'HIGH', status: 'OPEN' });
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'stage', version: 1, stage: 'WAITING_PLANNING' }, leader, { database }),
    error => error.code === 'PROJECT_WORKFLOW_STAGE_BLOCKED'
  );
  const updated = await updateProjectWorkflow('project-1', {
    action: 'issue', version: 1, issueId: 'issue-1', description: 'Providenciar equipamento',
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

test('Comercial consulta os sinais sem receber campos de edição ou permissão operacional', async () => {
  const { database } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  const result = await getProjectWorkflow('project-1', commercial, { database });
  assert.equal(result.workflow.permissions.canEditCommercial, false);
  assert.equal(result.workflow.permissions.canEdit, false);
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'checklist', version: 1, key: 'HANDOVER_WHATSAPP_GROUP', status: 'DONE' }, commercial, { database }),
    error => error.code === 'PROJECT_WORKFLOW_CHECKLIST_INVALID'
  );
  await assert.rejects(
    startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, commercial, { database }),
    error => error.code === 'PROJECT_WORKFLOW_MANAGER_REQUIRED'
  );
});

test('antigo líder com papel Comercial não mantém poderes operacionais', async () => {
  const { database } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  const formerLeader = { actorUserId: 'leader-1', user: { id: 'leader-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:commercial'] } };
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'checklist', version: 1, key: 'HANDOVER_WHATSAPP_GROUP', status: 'DONE' }, formerLeader, { database }),
    error => error.code === 'PROJECT_WORKFLOW_CHECKLIST_INVALID'
  );
});

test('fato CRM é exposto como somente leitura', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  state.commercialFacts.push({
    id: 'crm-fact', projectId: 'project-1', key: 'CONTRACT_SIGNED', status: 'CONFIRMED', source: 'CRM',
    reference: 'CTR-1', note: null, occurredOn: new Date('2026-09-01T00:00:00Z'), sourceVersion: 'v2', updatedAt: new Date()
  });
  Object.assign(state.workflow, {
    commercialExpectedMobilizationDate: new Date('2026-09-29T00:00:00Z'),
    commercialExpectedStartDate: new Date('2026-10-01T00:00:00Z'),
    commercialExpectedDurationDays: 30,
    commercialWhatsappGroupCreated: true,
    commercialParticipantsIncluded: true,
    commercialClientContactName: 'Contato Cliente',
    commercialAssumptions: 'Atendimento em turno administrativo.',
    commercialSourceUpdatedAt: new Date('2026-09-01T12:00:00Z')
  });
  const detail = await getProjectWorkflow('project-1', commercial, { database });
  const crmFact = detail.workflow.commercialFacts.find(item => item.key === 'CONTRACT_SIGNED');
  assert.equal(crmFact.readOnly, true);
  assert.equal(crmFact.sourceVersion, 'v2');
  assert.equal(detail.workflow.commercialExpectedMobilizationDate, '2026-09-29');
  assert.equal(detail.workflow.commercialExpectedStartDate, '2026-10-01');
  assert.equal(detail.workflow.commercialExpectedDurationDays, 30);
  assert.equal(detail.workflow.commercialWhatsappGroupCreated, true);
  assert.equal(state.workflow.version, 1);
  assert.equal(state.commercialFacts[0].status, 'CONFIRMED');
  assert.equal(state.events.length, 1);
});

test('Líder registra o contato inicial com nome e data sem editar as datas do CRM', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  state.workflow.stage = 'INITIAL_ANALYSIS';
  let detail = await updateProjectWorkflow('project-1', {
    action: 'analysis_contact', version: 1, made: true, contactName: 'Marina Souza', contactPhone: '(11) 99999-9999', contactDate: '2026-09-11'
  }, leader, { database });
  assert.equal(detail.workflow.analysisClientContactMade, true);
  assert.equal(detail.workflow.analysisClientContactName, 'Marina Souza');
  assert.equal(detail.workflow.analysisClientContactPhone, '(11) 99999-9999');
  assert.equal(detail.workflow.analysisClientContactDate, '2026-09-11');
  assert.equal(state.events.at(-1).action, 'WORKFLOW_ANALYSIS_CONTACT');
  detail = await updateProjectWorkflow('project-1', {
    action: 'analysis_contact', version: detail.workflow.version, made: false
  }, leader, { database });
  assert.equal(detail.workflow.analysisClientContactMade, false);
  assert.equal(detail.workflow.analysisClientContactName, null);
  assert.equal(detail.workflow.analysisClientContactPhone, null);
  assert.equal(detail.workflow.analysisClientContactDate, null);
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

test('oito fatos recebidos do CRM completam a sinalização sem mover a etapa', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  state.commercialFacts.push(...PROJECT_WORKFLOW_COMMERCIAL_FACTS.map((definition, index) => ({
    id: `crm-${index}`, projectId: 'project-1', key: definition.key, status: 'CONFIRMED', source: 'CRM',
    occurredOn: new Date('2026-09-09T00:00:00Z'), reference: definition.evidence === 'reference' ? 'REF-1' : null,
    note: definition.evidence === 'note' ? 'Condição definida' : null
  })));
  const result = await getProjectWorkflow('project-1', manager, { database });
  assert.equal(result.workflow.commercialReadiness.status, 'RELEASED');
  assert.equal(result.workflow.stage, 'HANDOVER');
  const list = await listProjectWorkflows({}, manager, { database });
  assert.equal(list.items[0].workflow.commercialReadiness.status, result.workflow.commercialReadiness.status);
});

test('áreas editam somente suas frentes do planejamento e não obtêm poderes do Líder', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  state.workflow.stage = 'MOBILIZATION_PLANNING';
  let detail = await updateProjectWorkflow('project-1', {
    action: 'logistics_plan', version: 1,
    vehicleRequired: false, vehicleQuantity: null, vehicleType: null,
    freightRequired: false,
    lodgingRequired: false, lodgingPeopleCount: null, lodgingExpectedDate: null,
    lodgingRequested: null, lodgingRequestedAt: null, lodgingCompletedAt: null
  }, operations, { database });
  assert.equal(detail.workflow.planningReadiness.completed, 1);
  assert.equal(detail.workflow.permissions.canEditLogisticsPlanning, true);
  detail = await updateProjectWorkflow('project-1', { action: 'team_plan', version: 2, defined: true, demands: [{ jobRoleId: 'role-1', requiredCount: 2 }] }, operations, { database });
  assert.equal(detail.workflow.planningReadiness.completed, 2);
  await assert.rejects(
    updateProjectWorkflow('project-1', {
      action: 'supply_plan', version: 3, defined: true,
      items: [{ id: 'stock-stock-filter-1', stockItemId: 'stock-filter-1', type: 'FILTRO', name: 'Filtro 10 µm', unitLabel: 'un', requiredQuantity: 2, requestedAt: null, purchasedAt: null }]
    }, operations, { database }),
    error => error.code === 'PROJECT_WORKFLOW_RESOURCE_PLANNING_EDIT_FORBIDDEN'
  );
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'stage', version: 3, stage: 'WAITING_PLANNING' }, operations, { database }),
    error => error.code === 'PROJECT_WORKFLOW_EDIT_FORBIDDEN'
  );
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'documentation_category', version: 3, type: 'EXAM', required: true }, administrative, { database }),
    error => error.code === 'PROJECT_WORKFLOW_EDIT_FORBIDDEN'
  );
});

test('Líder acompanha documentação nomeada com datas e histórico', async () => {
  const { database, state } = fakeDatabase();
  let detail = await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  detail = await updateProjectWorkflow('project-1', { action: 'documentation_category', version: detail.workflow.version, type: 'EXAM', required: true }, leader, { database });
  detail = await updateProjectWorkflow('project-1', { action: 'documentation_requirement_create', version: detail.workflow.version, type: 'EXAM', name: 'Audiometria' }, leader, { database });
  const item = detail.workflow.documentationCategories.find(category => category.type === 'EXAM').requirements[0];
  assert.equal(item.status, 'PENDING');
  detail = await updateProjectWorkflow('project-1', {
    action: 'documentation_requirement_update', version: detail.workflow.version, requirementId: item.id,
    status: 'REQUESTED', requestedAt: '2026-09-10', confirmedAt: null
  }, leader, { database });
  detail = await updateProjectWorkflow('project-1', {
    action: 'documentation_requirement_update', version: detail.workflow.version, requirementId: item.id,
    status: 'CONFIRMED', requestedAt: '2026-09-10', confirmedAt: '2026-09-11'
  }, leader, { database });
  const confirmed = detail.workflow.documentationCategories.find(category => category.type === 'EXAM').requirements[0];
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal(confirmed.requestedAt, '2026-09-10');
  assert.equal(confirmed.confirmedAt, '2026-09-11');
  assert.equal(confirmed.history.length, 3);
  assert.equal(state.documentationHistory.length, 3);
  assert.equal(detail.workflow.documentationReadiness.completed, 1);
});

test('checklist de outra etapa não pode ser antecipado por chamada direta', async () => {
  const { database } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2027-02-15' }, manager, { database });
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'checklist', version: 1, key: 'DEMOB_FIELD_SCOPE_COMPLETED', status: 'DONE' }, manager, { database }),
    error => error.code === 'PROJECT_WORKFLOW_CHECKLIST_STAGE_FORBIDDEN'
  );
});

function makeStateReadyForMobilization(state) {
  state.workflow.stage = 'PREPARATION';
  state.workflow.acceptedAt = new Date('2026-09-01T12:00:00Z');
  state.workflow.equipmentPlanDefined = true;
  state.workflow.supplyPlanDefined = true;
  state.workflow.logisticsPlan = { lodgingRequired: true, freightRequired: false };
  state.workflow.preJobScheduledDate = new Date('2026-09-09T00:00:00Z');
  state.workflow.preJobCompletedDate = new Date('2026-09-10T00:00:00Z');
  state.workflow.qsmsVerified = true;
  state.workflow.qsmsVerificationNote = 'APR e requisitos específicos do cliente verificados.';
  state.workflow.travelPlan = {
    lodgingRequestedDate: '2026-09-09',
    lodgingConfirmedDate: '2026-09-10',
    teamTransportDefined: true,
    teamTransportDescription: 'Van própria.',
    freightDefined: false,
    freightType: null,
    freightDepartureDate: null,
    freightDepartureTime: null
  };
  state.workflow.supplyPlan = [{
    id: 'stock-stock-filter-1',
    stockItemId: 'stock-filter-1',
    type: 'FILTRO',
    name: 'Filtro 10 µm',
    unitLabel: 'un',
    requiredQuantity: 2,
    requestedAt: null,
    purchasedAt: null
  }];
  state.equipmentCategoryPlans.push({
    id: 'equipment-plan-ready',
    projectId: 'project-1',
    categoryId: 'category-1',
    equipmentIds: ['equipment-1']
  });
  state.preparationItemChecks.push(
    ...PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS.EQUIPMENT.map(item => ({
      id: `preparation-equipment-${item.key}`,
      projectId: 'project-1',
      itemType: 'EQUIPMENT',
      itemId: 'equipment-1',
      key: item.key,
      status: 'DONE',
      createdAt: new Date(),
      updatedAt: new Date()
    })),
    ...PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS.MATERIAL.map(item => ({
      id: `preparation-material-${item.key}`,
      projectId: 'project-1',
      itemType: 'MATERIAL',
      itemId: 'stock-stock-filter-1',
      key: item.key,
      status: 'DONE',
      createdAt: new Date(),
      updatedAt: new Date()
    }))
  );
  state.checklists.push(...PROJECT_WORKFLOW_CHECKLISTS
    .filter(item => item.section.startsWith('D15_'))
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
  state.documentationCategories.push(...['DOCUMENT', 'EXAM', 'TRAINING', 'QUALITY', 'CERTIFICATION'].map((type, index) => ({
    id: `documentation-category-${index + 1}`,
    projectId: 'project-1',
    type,
    required: false,
    createdAt: new Date(),
    updatedAt: new Date()
  })));
  state.operationalMission = {
    id: 'mission-ready',
    stage: 'STANDBY',
    scheduleStatus: 'CONFIRMED',
    version: 1,
    kanbanOrder: 0,
    mobilizationDate: new Date('2026-09-29T00:00:00Z'),
    executionStartDate: new Date('2026-09-30T00:00:00Z'),
    executionEndDate: new Date('2026-10-10T00:00:00Z'),
    returnDate: null,
    headquartersResponsibleName: 'Responsável de campo',
    headquartersResponsibleRole: 'Supervisor',
    headquartersResponsibleCollaboratorId: 'collaborator-1',
    allocations: [{
      id: 'allocation-ready',
      collaboratorId: 'collaborator-1',
      jobRoleId: 'role-1',
      collaborator: { id: 'collaborator-1', name: 'João da Silva', isActive: true, jobRole: { id: 'role-1', name: 'Mecânico' } },
      jobRole: { id: 'role-1', name: 'Mecânico' }
    }]
  };
  state.teamMemberChecks.push(...PROJECT_WORKFLOW_TEAM_MEMBER_CHECKS.map(item => ({
    id: `team-check-${item.key}`,
    projectId: 'project-1',
    collaboratorId: 'collaborator-1',
    key: item.key,
    status: 'DONE',
    source: 'MANUAL',
    createdAt: new Date(),
    updatedAt: new Date()
  })));
  state.clientReleases.push({
    id: 'client-attendance',
    projectId: 'project-1',
    key: 'ATTENDANCE_CONFIRMATION',
    attendanceDate: new Date('2026-09-30T00:00:00Z'),
    attendanceConfirmedAt: new Date(),
    requested: false,
    completed: false,
    source: 'MANUAL',
    createdAt: new Date(),
    updatedAt: new Date()
  }, ...PROJECT_WORKFLOW_CLIENT_RELEASES.map(item => ({
    id: `client-${item.key}`,
    projectId: 'project-1',
    key: item.key,
    attendanceDate: null,
    attendanceConfirmedAt: null,
    requested: true,
    requestedAt: new Date('2026-09-09T00:00:00Z'),
    requestedTo: 'Marina',
    completed: true,
    completedAt: new Date('2026-09-10T00:00:00Z'),
    source: 'MANUAL',
    createdAt: new Date(),
    updatedAt: new Date()
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
  let detail = await updateProjectWorkflow('project-1', { action: 'team_plan', version: 1, defined: true, demands: [{ jobRoleId: 'role-1', requiredCount: 2 }] }, leader, { database });
  assert.equal(detail.workflow.resourcePlanning.team.demands[0].hiringNeed, 2);
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'equipment_plan', version: detail.workflow.version, defined: true, selections: [{ categoryId: 'category-1', equipmentIds: ['equipment-inexistente'] }] }, leader, { database }),
    error => error.code === 'PROJECT_WORKFLOW_EQUIPMENT_INVALID'
  );
  detail = await updateProjectWorkflow('project-1', { action: 'equipment_plan', version: detail.workflow.version, defined: true, selections: [{ categoryId: 'category-1', equipmentIds: ['equipment-1'] }] }, leader, { database });
  assert.equal(detail.workflow.resourcePlanning.equipment.categories[0].name, 'Bombas');
  assert.deepEqual(detail.workflow.resourcePlanning.equipment.equipmentIds, ['equipment-1']);
  detail = await updateProjectWorkflow('project-1', {
    action: 'supply_plan', version: detail.workflow.version, defined: true,
    items: [
      { id: 'stock-stock-filter-1', stockItemId: 'stock-filter-1', type: 'FILTRO', name: 'nome ignorado', unitLabel: 'kg', requiredQuantity: 6, requestedAt: '2026-09-10', purchasedAt: null },
      { id: 'custom-chemical-1', stockItemId: null, type: 'PRODUTO_QUIMICO', name: 'Produto especial', unitLabel: 'L', requiredQuantity: 2, requestedAt: null, purchasedAt: null }
    ]
  }, supplies, { database });
  assert.equal(detail.workflow.resourcePlanning.supplies.items[0].name, 'Filtro 10 µm');
  assert.equal(detail.workflow.resourcePlanning.supplies.items[0].availableQuantity, 4);
  assert.equal(detail.workflow.resourcePlanning.supplies.items[0].shortageQuantity, 2);
  assert.equal(detail.workflow.resourcePlanning.supplies.items[1].stockItemId, null);
  assert.equal(detail.workflow.resourcePlanning.supplies.items[1].purchaseRequired, true);
  assert.equal(detail.workflow.resourcePlanning.supplies.purchasePendingCount, 2);
  detail = await updateProjectWorkflow('project-1', {
    action: 'logistics_plan', version: detail.workflow.version,
    vehicleRequired: true, vehicleQuantity: 1, vehicleType: 'CAMINHAO',
    freightRequired: false,
    lodgingRequired: true, lodgingPeopleCount: 4, lodgingExpectedDate: null,
    lodgingRequested: false, lodgingRequestedAt: null, lodgingCompletedAt: null
  }, operations, { database });
  assert.equal(detail.workflow.resourcePlanning.logistics.lodgingExpectedDate, '2026-09-29');
  assert.equal(detail.workflow.resourcePlanning.logistics.complete, true);
  assert.deepEqual(detail.workflow.resourcePlanning.logistics.warnings, ['Hospedagem ainda não solicitada']);
  const result = await updateProjectWorkflow('project-1', { action: 'stage', version: detail.workflow.version, stage: 'PREPARATION' }, leader, { database });
  assert.equal(result.workflow.stage, 'PREPARATION');
  assert.ok(result.workflow.preparationReadiness.total > 0);
  assert.equal(result.workflow.preparationResources.equipment.items.length, 1);
  assert.equal(result.workflow.preparationResources.materials.items.length, 2);
  assert.equal(result.workflow.preparationResources.equipment.items[0].availabilityStatus, 'AVAILABLE');
  assert.equal(result.workflow.preparationResources.equipment.items[0].maintenance.status, 'NOT_REQUIRED');
  assert.equal(result.workflow.preparationResources.equipment.items[0].calibration.status, 'NOT_REQUIRED');
  assert.equal(result.workflow.preparationResources.materials.items[0].availableInStock, false);
});

test('QSMS edita sua frente sem avançar a etapa', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  state.workflow.stage = 'PREPARATION';
  let result = await updateProjectWorkflow('project-1', { action: 'qsms', version: 1, verified: true }, qsms, { database });
  assert.equal(result.workflow.qsms.verified, true);
  assert.equal(result.workflow.preparationReadiness.completed, 0);
  result = await updateProjectWorkflow('project-1', { action: 'qsms', version: 2, verificationNote: 'APR e documentação de segurança.' }, qsms, { database });
  assert.equal(result.workflow.qsms.verificationNote, 'APR e documentação de segurança.');
  assert.equal(result.workflow.preparationReadiness.completed, 1);
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'preparation_item_check', version: 3, itemType: 'EQUIPMENT', itemId: 'equipment-1', key: 'TESTED', status: 'DONE' }, qsms, { database }),
    error => error.code === 'PROJECT_WORKFLOW_PREPARATION_EDIT_FORBIDDEN'
  );
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'stage', version: 3, stage: 'MOBILIZATION_PLANNING' }, qsms, { database }),
    error => error.code === 'PROJECT_WORKFLOW_EDIT_FORBIDDEN'
  );
});

test('preparação acompanha equipe por colaborador e liberações do cliente com datas', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  makeStateReadyForMobilization(state);
  let result = await updateProjectWorkflow('project-1', {
    action: 'team_member_check', version: 1, collaboratorId: 'collaborator-1', key: 'NOTIFIED', status: 'PENDING'
  }, operations, { database });
  assert.equal(result.workflow.teamPreparation.members[0].checks.find(item => item.key === 'NOTIFIED').status, 'PENDING');
  result = await updateProjectWorkflow('project-1', {
    action: 'team_member_check', version: 2, collaboratorId: 'collaborator-1', key: 'EXAMS_RELEASED', status: 'PENDING'
  }, administrative, { database });
  assert.equal(result.workflow.mobilizationGate.fronts.find(item => item.key === 'DOCUMENTATION').status, 'BLOCKED');
  result = await updateProjectWorkflow('project-1', {
    action: 'client_attendance', version: 3, attendanceDate: '2026-10-01'
  }, operations, { database, now: new Date('2026-09-12T15:00:00Z') });
  assert.equal(result.workflow.clientReleases.attendance.date, '2026-10-01');
  assert.equal(result.workflow.clientReleases.attendance.confirmed, true);
  result = await updateProjectWorkflow('project-1', {
    action: 'client_release', version: 4, key: 'CUSTOMER_REGISTRATION', requested: true,
    requestedAt: '2026-09-12', requestedTo: 'Portaria da unidade', completed: false, completedAt: null
  }, administrative, { database });
  const registration = result.workflow.clientReleases.items.find(item => item.key === 'CUSTOMER_REGISTRATION');
  assert.equal(registration.requestedTo, 'Portaria da unidade');
  assert.equal(registration.completed, false);
  result = await updateProjectWorkflow('project-1', {
    action: 'preparation_item_check', version: 5, itemType: 'MATERIAL', itemId: 'stock-stock-filter-1', key: 'SEPARATED', status: 'PENDING'
  }, supplies, { database });
  assert.equal(result.workflow.preparationResources.materials.items[0].checks[0].status, 'PENDING');
  assert.equal(result.workflow.mobilizationGate.fronts.find(item => item.key === 'MATERIALS').status, 'BLOCKED');
});

test('preparação registra pré-job e viagem em campos estruturados com salvamento por área', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  state.workflow.stage = 'PREPARATION';
  state.workflow.logisticsPlan = { lodgingRequired: true };

  let detail = await updateProjectWorkflow('project-1', {
    action: 'pre_job', version: 1, scheduledDate: '2026-09-12'
  }, operations, { database });
  assert.equal(detail.workflow.preJob.scheduledDate, '2026-09-12');
  assert.equal(detail.workflow.preJob.completedDate, null);

  detail = await updateProjectWorkflow('project-1', {
    action: 'pre_job', version: 2, completedDate: '2026-09-13'
  }, operations, { database });
  assert.equal(detail.workflow.preJob.completedDate, '2026-09-13');

  detail = await updateProjectWorkflow('project-1', {
    action: 'travel', version: 3, lodgingRequestedDate: '2026-09-12'
  }, administrative, { database });
  assert.equal(detail.workflow.travel.lodgingRequestedDate, '2026-09-12');

  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'travel', version: 4, freightDefined: false }, administrative, { database }),
    error => error.code === 'PROJECT_WORKFLOW_PREPARATION_EDIT_FORBIDDEN'
  );
  detail = await updateProjectWorkflow('project-1', {
    action: 'travel', version: 4, teamTransportDefined: true
  }, operations, { database });
  detail = await updateProjectWorkflow('project-1', {
    action: 'travel', version: 5, teamTransportDescription: 'Van própria com saída da sede.', freightDefined: false
  }, operations, { database });
  assert.equal(detail.workflow.travel.teamTransportDescription, 'Van própria com saída da sede.');
  assert.equal(detail.workflow.travel.freightDefined, false);
  assert.equal(state.events.at(-1).action, 'WORKFLOW_TRAVEL');
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
  result = await updateProjectWorkflow('project-1', { action: 'preparation_item_check', version: 2, itemType: 'EQUIPMENT', itemId: 'equipment-1', key: 'TESTED', status: 'PENDING' }, assets, { database });
  assert.equal(result.workflow.mobilizationAuthorization.status, 'SUSPENDED');
  assert.equal(result.workflow.mobilizationGate.ready, false);
  result = await updateProjectWorkflow('project-1', { action: 'preparation_item_check', version: 3, itemType: 'EQUIPMENT', itemId: 'equipment-1', key: 'TESTED', status: 'DONE' }, assets, { database });
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
    action: 'demobilization', version: 5, mobilizationDate: '2026-09-10', fieldCompletionDate: '2026-09-20', returnDate: '2026-09-22'
  }, leader, {
    database,
    synchronizeOfficialMissionDemobilization: async (_tx, _projectId, returnDate) => {
      state.project.demobilizationDate = new Date(`${returnDate}T00:00:00Z`);
    }
  });
  assert.equal(result.workflow.fieldCompletionDate, '2026-09-20');
  assert.equal(result.workflow.demobilizationDate, '2026-09-22');
  assert.equal(result.project.mobilizationDate, '2026-09-10');
  assert.equal(state.project.mobilizationDate.toISOString().slice(0, 10), '2026-09-10');
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

test('Encerramento registra autoria e reabertura exige justificativa auditável', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-29' }, manager, { database });
  state.workflow.stage = 'FINAL_MEASUREMENT';
  state.postJob = {
    projectId: 'project-1', meetingDate: new Date('2026-09-25T00:00:00Z'), serviceTypes: ['FLUSHING'], createdAt: new Date(), updatedAt: new Date()
  };
  state.measurement = {
    projectId: 'project-1', approvedAt: new Date('2026-09-30T00:00:00Z'), approvedAmount: 0, createdAt: new Date(), updatedAt: new Date()
  };
  state.checklists.push(...PROJECT_WORKFLOW_CHECKLISTS
    .filter(item => item.stage === 'FINAL_MEASUREMENT')
    .map(item => ({ id: `check-${item.key}`, projectId: 'project-1', key: item.key, status: 'DONE' })));
  const synchronizedStages = [];
  let detail = await updateProjectWorkflow('project-1', {
    action: 'stage', version: 1, stage: 'FINISHED'
  }, leader, {
    database,
    now: new Date('2026-10-01T12:00:00Z'),
    synchronizeOfficialMissionStage: async (_tx, _projectId, stage) => synchronizedStages.push(stage)
  });
  assert.equal(detail.workflow.stage, 'FINISHED');
  assert.equal(detail.workflow.closedAt.toISOString(), '2026-10-01T12:00:00.000Z');
  assert.equal(detail.workflow.closedBy.name, 'Líder A');
  assert.equal(detail.workflow.permissions.canEdit, false);
  assert.equal(detail.workflow.permissions.canReopen, true);
  assert.deepEqual(synchronizedStages, ['FINISHED']);

  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'checklist', version: 2, key: 'FINAL_SCOPE_CLOSED', status: 'PENDING' }, leader, { database }),
    error => error.code === 'PROJECT_WORKFLOW_FINISHED_READ_ONLY'
  );
  await assert.rejects(
    updateProjectWorkflow('project-1', { action: 'stage', version: 2, stage: 'FINAL_MEASUREMENT' }, leader, { database }),
    error => error.code === 'PROJECT_WORKFLOW_REOPEN_REASON_REQUIRED'
  );
  detail = await updateProjectWorkflow('project-1', {
    action: 'stage', version: 2, stage: 'FINAL_MEASUREMENT', reason: 'Cliente solicitou ajuste no valor final.'
  }, leader, {
    database,
    synchronizeOfficialMissionStage: async (_tx, _projectId, stage) => synchronizedStages.push(stage)
  });
  assert.equal(detail.workflow.stage, 'FINAL_MEASUREMENT');
  assert.equal(detail.workflow.closedAt, null);
  assert.equal(detail.workflow.closedBy, null);
  assert.deepEqual(synchronizedStages, ['FINISHED', 'FINAL_MEASUREMENT']);
  assert.equal(state.events.at(-1).data.reason, 'Cliente solicitou ajuste no valor final.');
});

test('gate bloqueado impede autorização e papel de área não pode revalidar', async () => {
  const { database, state } = fakeDatabase();
  await startProjectWorkflow('project-1', { leaderUserId: 'leader-1', plannedMobilizationDate: '2026-09-10' }, manager, { database });
  makeStateReadyForMobilization(state);
  state.preparationItemChecks = state.preparationItemChecks.filter(item => !(item.itemType === 'MATERIAL' && item.key === 'SEPARATED'));
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
