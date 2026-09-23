import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProjectCloseoutDashboard, getProjectCloseoutDashboard } from '../src/lib/efetivo/project-workflow/closeout-dashboard.js';

test('painel de fechamento separa documentos, contrato, faturamento e medição', () => {
  const dashboard = buildProjectCloseoutDashboard({
    reports: [
      { reportType: 'RDO', status: 'SIGNED', reportDate: new Date('2026-09-08T00:00:00Z'), services: [{ id: 's1' }], attachments: [{ id: 'a1' }], clientReviews: [{ action: 'APPROVED' }] },
      { reportType: 'RDO', status: 'RETURNED', reportDate: new Date('2026-09-09T00:00:00Z'), services: [], attachments: [], clientReviews: [{ action: 'REJECTED' }] },
      { reportType: 'RDO_MAINTENANCE', status: 'APPROVED', reportDate: new Date('2026-09-10T00:00:00Z'), services: [], attachments: [], clientReviews: [] },
      { reportType: 'RTP', status: 'APPROVED', reportDate: new Date('2026-09-09T00:00:00Z'), services: [], attachments: [], clientReviews: [{ action: 'APPROVED' }] }
    ],
    targetData: { RTP: { expected: 2 }, RLR: { expected: 1, completed: 1 } },
    financial: { previstoOriginal: 800000, previstoAdicional: 35000, previsto: 835000, realizado: 600000, notas: 3 },
    measurement: { executedAmount: 835000, measuredAmount: 835000, approvedAmount: 820000, approvedAt: new Date('2026-09-30T00:00:00Z') },
    canEdit: true
  });

  assert.equal(dashboard.documentation.rdo.receivedCount, 3);
  assert.equal(dashboard.documentation.rdo.clientAcceptedCount, 1);
  assert.equal(dashboard.documentation.technicalReports.find(item => item.reportType === 'RTP').clientAcceptedCount, 1);
  assert.equal(dashboard.documentation.technicalReports.find(item => item.reportType === 'RLR').issuedCount, 1);
  assert.equal(dashboard.documentation.totalClientAccepted, 2);
  assert.deepEqual(dashboard.financial, {
    originalContractAmount: 800000,
    additionalContractAmount: 35000,
    contractAmount: 835000,
    invoicedAmount: 600000,
    invoiceCount: 3
  });
  assert.equal(dashboard.measurement.unmeasuredAmount, 0);
  assert.equal(dashboard.measurement.pendingApprovalAmount, 15000);
  assert.equal(dashboard.measurement.approvedAt, '2026-09-30');
  assert.equal(dashboard.permissions.canEdit, true);
});

test('painel mantém ausente diferente de zero quando não há fontes', () => {
  const dashboard = buildProjectCloseoutDashboard();
  assert.equal(dashboard.financial.contractAmount, null);
  assert.equal(dashboard.financial.invoicedAmount, null);
  assert.equal(dashboard.measurement.executedAmount, null);
  assert.equal(dashboard.measurement.pendingApprovalAmount, null);
  assert.equal(dashboard.documentation.rdo.receivedCount, 0);
});

test('consulta do fechamento respeita o projeto do Efetivo e reutiliza as fontes integradas', async () => {
  const queries = [];
  const workflow = {
    projectId: 'project-1',
    stage: 'FINAL_MEASUREMENT',
    leaderUserId: 'leader-1',
    executionReportTargets: { RTP: { expected: 1 } },
    measurement: { measuredAmount: 100, approvedAmount: 90, updatedBy: { id: 'leader-1', name: 'Líder' } }
  };
  const database = {
    project: {
      findFirst: async input => {
        queries.push(input);
        return { id: 'project-1', workflow };
      }
    },
    report: {
      findMany: async () => [{ reportType: 'RTP', status: 'SIGNED', services: [], attachments: [], clientReviews: [{ action: 'APPROVED' }] }]
    }
  };
  const result = await getProjectCloseoutDashboard('project-1', {
    actorUserId: 'leader-1',
    user: { id: 'leader-1', accountType: 'INTERNAL', moduleRoles: ['efetivo:viewer'] }
  }, {
    database,
    getProjectDetail: async () => ({ faturamento: { previsto: 120, realizado: 90, notas: 1 } })
  });
  assert.equal(queries[0].where.id, 'project-1');
  assert.equal(result.documentation.totalTechnicalIssued, 1);
  assert.equal(result.financial.contractAmount, 120);
  assert.equal(result.measurement.pendingApprovalAmount, 10);
  assert.equal(result.permissions.canEdit, true);
});
