import assert from 'node:assert/strict';
import test from 'node:test';

import prisma from '../src/lib/prisma.js';
import { removeSubmittedRdoDrafts } from '../src/lib/reports/drafts.js';
import reportsRouter from '../src/routes/resources/reports.js';

const input = {
  draftId: 'active', projectId: 'project-1', createdByUserId: 'user-1',
  reportType: 'RDO', reportDate: '2026-10-20', status: 'PENDING',
  arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00',
  daytimeCount: 0, collaboratorIds: [], services: []
};
const auth = { user: {
  id: 'user-1', role: 'COLLABORATOR', collaboratorId: 'collaborator-1',
  reportEmissionPermissions: ['SITE_RDO']
} };
const project = {
  id: input.projectId, code: 'TEST', name: 'Projeto teste', location: 'Oficina',
  isActive: true, deletedAt: null, registrationPending: false,
  visibleToCollaborators: true, operatorId: auth.user.collaboratorId,
  authorizedUsers: [], plannedServices: []
};

function initialDrafts() {
  const common = { userId: 'user-1', projectId: input.projectId, reportDate: input.reportDate, payload: {} };
  return [
    { ...common, id: 'active', projectId: 'old-project', reportDate: '2026-10-19' },
    { ...common, id: 'duplicate' },
    { ...common, id: 'legacy', projectId: null, reportDate: null,
      payload: { projectId: input.projectId, reportDate: `${input.reportDate}T00:00:00.000Z` } },
    { ...common, id: 'other-user', userId: 'user-2' },
    { ...common, id: 'other-project', projectId: 'project-2' },
    { ...common, id: 'other-date', reportDate: '2026-10-19' },
    { ...common, id: 'romaneio', payload: { __module: 'romaneio' } },
    { ...common, id: 'service-only', payload: { serviceOnly: true } }
  ];
}

function draftClient(state, { failCleanup = false } = {}) {
  return {
    async $executeRaw(_sql, lockKey) {
      assert.equal(lockKey, 'rdo-drafts:user-1');
    },
    reportDraft: {
      async findMany({ where }) { return state.drafts.filter(draft => draft.userId === where.userId); },
      async deleteMany({ where }) {
        if (failCleanup) throw new Error('Draft cleanup unavailable');
        state.drafts = state.drafts.filter(draft => !(draft.userId === where.userId && where.id.in.includes(draft.id)));
      }
    }
  };
}

function invokeCreate(body = input, path = '/', requestAuth = auth) {
  const handler = reportsRouter.stack.find(layer => layer.route?.path === path && layer.route.methods.post).route.stack.at(-1).handle;
  return new Promise((resolve, reject) => {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      json(report) { resolve({ statusCode: this.statusCode, report }); } };
    handler({ body, auth: requestAuth }, response, reject);
  });
}

function mockReportDatabase(t, options = {}) {
  const state = { drafts: initialDrafts(), reports: [] };
  const originals = {
    transaction: prisma.$transaction,
    findReport: prisma.report.findUnique,
    findAttachments: prisma.reportAttachment.findMany
  };
  t.after(() => {
    prisma.$transaction = originals.transaction;
    prisma.report.findUnique = originals.findReport;
    prisma.reportAttachment.findMany = originals.findAttachments;
  });
  prisma.$transaction = async callback => {
    const pending = structuredClone(state);
    const result = await callback({
      ...draftClient(pending, options),
      projectPlannedService: { findMany: async () => [] },
      project: { findFirstOrThrow: async () => project },
      projectReportSeq: { upsert: async () => ({ nextNumber: 1 }) },
      workforceHoliday: { findMany: async () => [] },
      workforceCalendarState: { findUnique: async () => null },
      efetivoMissionPlan: { findFirst: async () => null },
      report: {
        findFirst: async () => null,
        async create({ data }) {
          const report = { ...data, id: 'submitted', project, services: [], collaborators: [] };
          pending.reports.push(report);
          return report;
        }
      }
    });
    Object.assign(state, pending);
    return result;
  };
  prisma.report.findUnique = async () => state.reports[0];
  prisma.reportAttachment.findMany = async () => [];
  return state;
}

test('sending an RDO consumes its active and duplicate drafts in the report transaction', async t => {
  const state = mockReportDatabase(t);
  const response = await invokeCreate();
  assert.equal(response.statusCode, 201);
  assert.equal(response.report.status, 'PENDING');
  assert.equal(state.reports.length, 1);
  assert.deepEqual(state.drafts.map(draft => draft.id), [
    'other-user', 'other-project', 'other-date', 'romaneio', 'service-only'
  ]);
});

test('a cleanup failure rejects submission and retains the draft without committing the report', async t => {
  const state = mockReportDatabase(t, { failCleanup: true });
  await assert.rejects(invokeCreate(), /Draft cleanup unavailable/);
  assert.deepEqual(state.drafts, initialDrafts());
  assert.equal(state.reports.length, 0);
});

test('older clients without a draft ID also consume matching RDO drafts', async t => {
  const state = mockReportDatabase(t);
  const { draftId: _draftId, ...payload } = input;
  await invokeCreate(payload);
  assert.equal(state.drafts.some(draft => draft.id === 'duplicate' || draft.id === 'legacy'), false);
  assert.equal(state.drafts.some(draft => draft.id === 'active'), true);
});

test('submission cannot delete another user or module draft by supplying its ID', async () => {
  for (const draftId of ['other-user', 'romaneio']) {
    const state = { drafts: initialDrafts() };
    await removeSubmittedRdoDrafts(draftClient(state), auth.user.id, { ...input, draftId });
    assert.ok(state.drafts.some(draft => draft.id === draftId));
  }
});

test('service-only submission retains regular RDO drafts for the same project and date', async () => {
  const state = { drafts: initialDrafts() };
  await removeSubmittedRdoDrafts(draftClient(state), auth.user.id, { ...input, draftId: null, serviceOnly: true });
  assert.equal(state.drafts.some(draft => draft.id === 'service-only'), false);
  assert.equal(state.drafts.some(draft => draft.id === 'duplicate'), true);
});

test('service-only route also rejects the whole transaction if draft cleanup fails', async t => {
  const state = mockReportDatabase(t, { failCleanup: true });
  await assert.rejects(invokeCreate({
    ...input, draftId: 'service-only',
    services: [{ serviceType: 'mecanica', startTime: '08:00', endTime: '17:00', finalized: true }]
  }, '/service-only', { user: { id: auth.user.id, role: 'MANAGER' } }), /Draft cleanup unavailable/);
  assert.deepEqual(state.drafts, initialDrafts());
  assert.equal(state.reports.length, 0);
});
