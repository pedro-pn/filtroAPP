import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import { makeProjectExecutionSchemas } from '../../shared/schemas/project-execution.js';
import {
  buildProjectExecutionDashboard,
  createProjectExecutionDeviation,
  updateProjectExecutionDeviation,
  updateProjectExecutionReportTargets
} from '../src/lib/efetivo/project-workflow/execution-dashboard.js';

function fakeDatabase() {
  const state = {
    workflow: { projectId: 'project-1', stage: 'EXECUTION', leaderUserId: 'leader-1', version: 7, executionReportTargets: {} },
    events: [],
    qualityPayload: null,
    qualityStatus: 'ABERTO'
  };
  const database = {
    $transaction: callback => callback(database),
    project: {
      findFirst: async input => input.where.id === 'project-1' ? { id: 'project-1', workflow: { ...state.workflow } } : null
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
const viewer = { actorUserId: 'viewer-1', user: { id: 'viewer-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:viewer'] } };
const tracking = async () => ({ diasCorridos: { elapsed: 1, planned: 10, pct: 10 }, avancoPct: 5, footer: {} });
const noDeviations = async () => [];

test('contratos rejeitam metas e desvios incompletos', () => {
  const schemas = makeProjectExecutionSchemas(z);
  assert.equal(schemas.reportTargets.safeParse({ targets: [{ reportType: 'RTP', expectedCount: 4 }] }).success, true);
  assert.equal(schemas.reportTargets.safeParse({ targets: [{ reportType: 'RTP', expectedCount: -1 }] }).success, false);
  assert.equal(schemas.reportTargets.safeParse({ targets: [{ reportType: 'RTP', expectedCount: 4, completedCount: 1 }] }).success, false);
  assert.equal(schemas.reportTargets.safeParse({ targets: [{ reportType: 'RLR', expectedCount: 4, completedCount: 5 }] }).success, false);
  assert.equal(schemas.deviationCreate.safeParse({ category: 'PRAZO' }).success, false);
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
  assert.equal(dashboard.technicalReports.find(item => item.reportType === 'RTP').issuedCount, 2);
  assert.equal(dashboard.technicalReports.find(item => item.reportType === 'RTP').missingCount, 2);
  assert.equal(dashboard.technicalReports.find(item => item.reportType === 'RLR').issuedCount, 4);
  assert.equal(dashboard.deviations.length, 1);
  assert.equal(dashboard.permissions.canEdit, true);
});

test('metas documentais são auditadas sem invalidar a versão do gate', async () => {
  const { database, state } = fakeDatabase();
  const result = await updateProjectExecutionReportTargets('project-1', {
    targets: [{ reportType: 'RTP', expectedCount: 4 }, { reportType: 'RLR', expectedCount: 3, completedCount: 1 }]
  }, leader, { database, getProjectDetail: tracking, listProjectDeviations: noDeviations });
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
