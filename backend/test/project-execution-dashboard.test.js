import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import { makeProjectExecutionSchemas } from '../../shared/schemas/project-execution.js';
import {
  buildProjectExecutionDashboard,
  buildProjectExecutionWeeklyReview,
  overdueRdoDays,
  createProjectExecutionDeviation,
  saveProjectExecutionWeeklyReview,
  updateProjectExecutionDeviation,
  updateProjectExecutionReportTargets
} from '../src/lib/efetivo/project-workflow/execution-dashboard.js';

function fakeDatabase() {
  const state = {
    workflow: { projectId: 'project-1', stage: 'EXECUTION', leaderUserId: 'leader-1', plannerUserId: 'planner-1', version: 7, executionReportTargets: {}, createdAt: new Date('2026-09-01T12:00:00Z') },
    events: [],
    weeklyReviews: new Map(),
    qualityPayload: null,
    qualityStatus: 'ABERTO'
  };
  const database = {
    $transaction: callback => callback(database),
    project: {
      findFirst: async input => input.where.id === 'project-1' ? {
        id: 'project-1',
        workflow: Object.fromEntries(Object.keys(input.select.workflow.select).map(key => [key, state.workflow[key]]))
      } : null
    },
    projectWorkflow: {
      update: async input => {
        Object.assign(state.workflow, input.data);
        return { ...state.workflow };
      }
    },
    projectWorkflowEvent: {
      create: async input => {
        state.events.push(input.data);
        return input.data;
      }
    },
    report: { findMany: async () => [] },
    projectExecutionWeeklyReview: {
      findMany: async () => Array.from(state.weeklyReviews.values()).map(row => ({
        ...row,
        completedBy: row.completedByUserId ? { id: row.completedByUserId, name: 'Líder de Projetos' } : null
      })),
      findUnique: async input => state.weeklyReviews.get(input.where.projectId_weekStartDate.weekStartDate.toISOString().slice(0, 10)) || null,
      upsert: async input => {
        const week = input.where.projectId_weekStartDate.weekStartDate.toISOString().slice(0, 10);
        const row = { ...state.weeklyReviews.get(week), ...(state.weeklyReviews.has(week) ? input.update : input.create) };
        state.weeklyReviews.set(week, row);
        return row;
      }
    },
    qualityNature: {
      findFirst: async () => null,
      create: async input => ({ id: 'nature-1', isActive: true, ...input.data }),
      update: async () => null
    },
    qualityRecord: {
      findFirst: async input => input.where.id === 'deviation-1' && input.where.projectId === 'project-1' ? { id: 'deviation-1' } : null,
      update: async input => {
        state.qualityStatus = input.data.status;
        return { id: input.where.id, status: state.qualityStatus };
      }
    }
  };
  return { database, state };
}

const leader = { actorUserId: 'leader-1', user: { id: 'leader-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:viewer'] } };
const planner = { actorUserId: 'planner-1', user: { id: 'planner-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:viewer'] } };
const viewer = { actorUserId: 'viewer-1', user: { id: 'viewer-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:viewer'] } };
const tracking = async () => ({ diasCorridos: { elapsed: 1, planned: 10, pct: 10 }, avancoPct: 5, footer: {} });
const noDeviations = async () => [];
const emptyWeeklyChecks = () => Object.fromEntries(['PROGRESS', 'SERVICE_FRONTS', 'DIFFICULTIES', 'DEVIATIONS_INCIDENTS', 'REPORT_DELIVERY', 'REPORT_SIGNATURES'].map(key => [key, false]));

test('contratos rejeitam metas e desvios incompletos', () => {
  const schemas = makeProjectExecutionSchemas(z);
  assert.equal(schemas.reportTargets.safeParse({ targets: [{ reportType: 'RTP', expectedCount: 4 }] }).success, true);
  assert.equal(schemas.reportTargets.safeParse({ targets: [{ reportType: 'RTP', expectedCount: -1 }] }).success, false);
  assert.equal(schemas.reportTargets.safeParse({ targets: [{ reportType: 'RTP', expectedCount: 4, completedCount: 1 }] }).success, false);
  assert.equal(schemas.reportTargets.safeParse({ targets: [{ reportType: 'RLR', expectedCount: 4, completedCount: 5 }] }).success, false);
  assert.equal(schemas.deviationCreate.safeParse({ category: 'PRAZO' }).success, false);
  assert.equal(schemas.weeklyReview.safeParse({ weekStartDate: '2026-09-07', checks: emptyWeeklyChecks() }).success, true);
  assert.equal(schemas.weeklyReview.safeParse({ weekStartDate: '2026-09-07', checks: { PROGRESS: true } }).success, false);
});

test('painel consolida prazo, RDO, relatórios integrados e RLR manual', () => {
  const dashboard = buildProjectExecutionDashboard({
    tracking: {
      diasCorridos: { elapsed: 12, planned: 30, pct: 40 },
      avancoPct: 38,
      avancoMethod: 'RDO',
      footer: { startDate: '2026-09-01', expectedEndDate: '2026-10-01', projectedEndByPace: '2026-10-03' }
    },
    reports: [
      { id: 'rdo-1', reportType: 'RDO', status: 'SIGNED', reportDate: new Date('2026-09-08T00:00:00Z'), services: [{ id: 's1' }], attachments: [{ id: 'a1' }] },
      { id: 'rdo-2', reportType: 'RDO', status: 'RETURNED', reportDate: new Date('2026-09-09T00:00:00Z'), services: [], attachments: [] },
      { id: 'rdo-3', reportType: 'RDO_PRODUCTION', status: 'APPROVED', reportDate: new Date('2026-09-10T00:00:00Z'), services: [], attachments: [] },
      { id: 'rtp-1', reportType: 'RTP', status: 'APPROVED', reportDate: new Date('2026-09-09T00:00:00Z'), services: [], attachments: [] },
      { id: 'rtp-2', reportType: 'RTP', status: 'RETURNED', reportDate: new Date('2026-09-09T00:00:00Z'), services: [], attachments: [] }
    ],
    targetData: { RTP: { expected: 4 }, RLR: { expected: 5, completed: 4 } },
    scope: { services: [{ serviceType: 'FILTRAGEM', systems: [] }], normalHours: [{ roleName: 'Operador', hours: 80 }], overtime: [] },
    progress: { hasScope: true, progressPct: 38, services: [] },
    deviations: [{ id: 'd1', status: 'ABERTO' }],
    canEdit: true
  });
  assert.deepEqual(dashboard.schedule, {
    plannedProgressPct: 40,
    actualProgressPct: 38,
    progressMethod: 'RDO',
    elapsedDays: 12,
    plannedDays: 30,
    startDate: '2026-09-01',
    expectedEndDate: '2026-10-01',
    projectedEndDate: '2026-10-03'
  });
  assert.equal(dashboard.rdo.receivedCount, 3);
  assert.equal(dashboard.rdo.releasedToClientCount, 2);
  assert.equal(dashboard.rdo.signedCount, 1);
  assert.equal(dashboard.rdo.withQuantitiesCount, 1);
  assert.equal(dashboard.rdo.evidenceCount, 1);
  assert.equal(dashboard.rdo.recent.length, 3);
  assert.equal(dashboard.signatures.signedCount, 1);
  assert.equal(dashboard.signatures.pendingCount, 4);
  assert.equal(dashboard.signatures.signedReports[0].id, 'rdo-1');
  assert.equal(dashboard.signatures.pendingReports.length, 4);
  assert.equal(dashboard.scope.services[0].serviceType, 'FILTRAGEM');
  assert.equal(dashboard.scope.normalHours[0].hours, 80);
  assert.equal(dashboard.progress.progressPct, 38);
  assert.equal(dashboard.technicalReports.find(item => item.reportType === 'RTP').issuedCount, 2);
  assert.equal(dashboard.technicalReports.find(item => item.reportType === 'RTP').missingCount, 2);
  assert.equal(dashboard.technicalReports.find(item => item.reportType === 'RLR').issuedCount, 4);
  assert.equal(dashboard.deviations.length, 1);
  assert.equal(dashboard.permissions.canEdit, true);
});

test('RDO vence 24 horas depois do fim do dia e o aviso some quando a entrega existe', () => {
  const now = new Date('2026-09-12T12:00:00Z');
  assert.equal(overdueRdoDays('2026-09-10', [], new Date('2026-09-12T02:59:59Z')).count, 0);
  assert.equal(overdueRdoDays('2026-09-10', [], new Date('2026-09-12T03:00:00Z')).count, 1);
  assert.deepEqual(overdueRdoDays('2026-09-08', ['2026-09-08', '2026-09-10'], now), {
    count: 1, recentDates: ['2026-09-09']
  });
  assert.equal(overdueRdoDays('2026-09-11', [], now).count, 0);
  const dashboard = buildProjectExecutionDashboard({
    stage: 'EXECUTION', mission: { executionStartDate: '2026-09-08' }, now,
    reports: [{ id: 'rdo-1', reportType: 'RDO', status: 'PENDING', reportDate: new Date('2026-09-08T00:00:00Z') }]
  });
  assert.equal(dashboard.rdo.overdueCount, 2);
  assert.deepEqual(dashboard.rdo.overdueDates, ['2026-09-10', '2026-09-09']);
  assert.equal(buildProjectExecutionDashboard({ stage: 'POST_JOB', mission: { executionStartDate: '2026-09-08' }, now }).rdo.overdueCount, 0);
  assert.equal(buildProjectExecutionDashboard({ stage: 'EXECUTION', mission: { executionStartDate: '2026-09-08' }, legacyStartDate: '2026-09-10', now }).rdo.overdueCount, 1);
});

test('revisão semanal nasce na quinta-feira e semanas não concluídas continuam pendentes', () => {
  const before = buildProjectExecutionWeeklyReview({
    stage: 'EXECUTION', startDate: '2026-09-07', now: new Date('2026-09-10T02:59:59Z'), canVerify: true
  });
  assert.equal(before.pendingCount, 0);
  assert.equal(before.nextDueDate, '2026-09-10');
  const thursday = buildProjectExecutionWeeklyReview({
    stage: 'EXECUTION', startDate: '2026-09-01', now: new Date('2026-09-10T03:00:00Z'), canVerify: true
  });
  assert.deepEqual(thursday.pending.map(week => week.dueDate), ['2026-09-03', '2026-09-10']);
  assert.equal(thursday.permissions.canVerify, true);
  const nextWeek = buildProjectExecutionWeeklyReview({
    stage: 'EXECUTION', startDate: '2026-09-11', now: new Date('2026-09-17T12:00:00Z')
  });
  assert.deepEqual(nextWeek.pending.map(week => week.dueDate), ['2026-09-17']);
  const completed = buildProjectExecutionWeeklyReview({
    stage: 'EXECUTION', startDate: '2026-09-01', now: new Date('2026-09-17T12:00:00Z'),
    rows: [{ weekStartDate: new Date('2026-09-07T00:00:00Z'), checks: Object.fromEntries(Object.keys(emptyWeeklyChecks()).map(key => [key, true])), completedAt: new Date('2026-09-10T12:00:00Z') }]
  });
  assert.deepEqual(completed.pending.map(week => week.dueDate), ['2026-09-03', '2026-09-17']);
  assert.equal(completed.recentCompleted.length, 1);
  assert.equal(buildProjectExecutionWeeklyReview({ stage: 'POST_JOB', startDate: '2026-09-01', now: new Date('2026-09-17T12:00:00Z') }).pendingCount, 0);
  const legacy = buildProjectExecutionDashboard({
    stage: 'EXECUTION', mission: { executionStartDate: '2026-09-01' },
    workflowCreatedAt: new Date('2026-09-10T12:00:00Z'), now: new Date('2026-09-17T12:00:00Z')
  });
  assert.deepEqual(legacy.weeklyReview.pending.map(week => week.dueDate), ['2026-09-10', '2026-09-17']);
});

test('responsáveis pelo projeto registram a revisão semanal de uma quinta-feira já vencida', async () => {
  const { database, state } = fakeDatabase();
  const dependencies = {
    database,
    now: new Date('2026-09-10T12:00:00Z'),
    getProjectDetail: tracking,
    getPlannedScope: async () => null,
    computeProjectProgress: async () => null,
    listProjectDeviations: noDeviations
  };
  const payload = { weekStartDate: '2026-09-07', checks: { ...emptyWeeklyChecks(), PROGRESS: true }, note: 'Frente liberada.' };
  await assert.rejects(saveProjectExecutionWeeklyReview('project-1', payload, viewer, dependencies), error => error.code === 'PROJECT_EXECUTION_WEEKLY_REVIEW_FORBIDDEN');
  await assert.rejects(saveProjectExecutionWeeklyReview('project-1', { ...payload, weekStartDate: '2026-09-14' }, leader, dependencies), error => error.code === 'PROJECT_EXECUTION_WEEKLY_REVIEW_NOT_DUE');
  const partial = await saveProjectExecutionWeeklyReview('project-1', payload, leader, dependencies);
  assert.equal(partial.weeklyReview.pending.find(week => week.weekStartDate === '2026-09-07').checkedCount, 1);
  assert.equal(state.weeklyReviews.get('2026-09-07').completedAt, null);
  const completeChecks = Object.fromEntries(Object.keys(emptyWeeklyChecks()).map(key => [key, true]));
  const complete = await saveProjectExecutionWeeklyReview('project-1', { ...payload, checks: completeChecks }, leader, dependencies);
  assert.equal(complete.weeklyReview.pending.some(week => week.weekStartDate === '2026-09-07'), false);
  assert.equal(complete.weeklyReview.recentCompleted[0].completedBy.name, 'Líder de Projetos');
  assert.equal(state.events.at(-1).action, 'WORKFLOW_EXECUTION_WEEKLY_REVIEW');
  assert.equal(state.events.at(-1).data.completed, true);
  await saveProjectExecutionWeeklyReview('project-1', { ...payload, checks: completeChecks, note: 'Atualização do gestor de contrato.' }, planner, dependencies);
  assert.equal(state.weeklyReviews.get('2026-09-07').completedByUserId, 'leader-1');
  state.workflow.stage = 'POST_JOB';
  await assert.rejects(saveProjectExecutionWeeklyReview('project-1', payload, leader, dependencies), error => error.code === 'PROJECT_EXECUTION_WEEKLY_REVIEW_STAGE_FORBIDDEN');
});

test('metas documentais são auditadas sem invalidar a versão do gate', async () => {
  const { database, state } = fakeDatabase();
  const result = await updateProjectExecutionReportTargets('project-1', {
    targets: [{ reportType: 'RTP', expectedCount: 4 }, { reportType: 'RLR', expectedCount: 3, completedCount: 1 }]
  }, leader, { database, getProjectDetail: tracking, getPlannedScope: async () => null, computeProjectProgress: async () => null, listProjectDeviations: noDeviations });
  assert.equal(state.workflow.version, 7);
  assert.deepEqual(state.workflow.executionReportTargets, { RTP: { expected: 4 }, RLR: { expected: 3, completed: 1 } });
  assert.equal(state.events.at(-1).action, 'WORKFLOW_EXECUTION_REPORT_TARGETS');
  assert.equal(result.technicalReports.find(item => item.reportType === 'RLR').issuedCount, 1);
});

test('somente líder ou gestor registra desvio e a gravação reutiliza Qualidade', async () => {
  const { database, state } = fakeDatabase();
  const input = {
    category: 'PRAZO', description: 'Atraso na liberação', ownerName: 'Responsável', dueDate: '2026-09-12',
    impact: 'ALTO', action: 'Replanejar a frente', status: 'ABERTO'
  };
  await assert.rejects(
    createProjectExecutionDeviation('project-1', input, viewer, { database }),
    error => error.code === 'PROJECT_WORKFLOW_EDIT_FORBIDDEN'
  );
  const record = await createProjectExecutionDeviation('project-1', input, leader, {
    database,
    now: new Date('2026-09-09T15:00:00Z'),
    createQualityRecord: async (_client, payload) => {
      state.qualityPayload = payload;
      return { id: 'deviation-1', number: 'D-2026-0001' };
    }
  });
  assert.equal(record.id, 'deviation-1');
  assert.equal(state.qualityPayload.data.type, 'DESVIO');
  assert.equal(state.qualityPayload.data.projectId, 'project-1');
  assert.equal(state.qualityPayload.data.origin, 'Prazo');
  assert.equal(state.qualityPayload.data.natureId, 'nature-1');
  assert.equal(state.events.at(-1).action, 'WORKFLOW_EXECUTION_DEVIATION_CREATED');
});

test('alteração de status fica restrita à etapa de execução e ao responsável pelo workflow', async () => {
  const { database, state } = fakeDatabase();
  await assert.rejects(
    updateProjectExecutionDeviation('project-1', 'deviation-1', { status: 'EM_ACAO' }, viewer, { database }),
    error => error.code === 'PROJECT_WORKFLOW_EDIT_FORBIDDEN'
  );
  const result = await updateProjectExecutionDeviation('project-1', 'deviation-1', { status: 'EM_ACAO' }, leader, {
    database,
    listProjectDeviations: async () => [{ id: 'deviation-1', status: state.qualityStatus }]
  });
  assert.equal(result.status, 'EM_ACAO');
  assert.equal(state.events.at(-1).action, 'WORKFLOW_EXECUTION_DEVIATION_STATUS');
});
