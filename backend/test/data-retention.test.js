import assert from 'node:assert/strict';
import test from 'node:test';

import {
  abandonedDraftExplicitDeleteWhere,
  previewDataRetention,
  retentionCutoffs,
  runDataRetention,
  shouldStartDataRetentionJob,
  startDataRetentionJob
} from '../src/lib/data-retention.js';

function modelMock(calls, model) {
  return {
    count: async args => {
      calls.push([model, 'count', args]);
      return 3;
    },
    deleteMany: async args => {
      calls.push([model, 'deleteMany', args]);
      return { count: 1 };
    },
    updateMany: async args => {
      calls.push([model, 'updateMany', args]);
      return { count: 2 };
    },
    findMany: async args => {
      calls.push([model, 'findMany', args]);
      const explicitIds = args?.where?.AND?.find(item => item?.id?.in)?.id?.in;
      if (Array.isArray(explicitIds)) {
        return explicitIds.slice(0, args.take || explicitIds.length).map(id => ({ id }));
      }
      return [
        {
          id: `${model}-1`,
          userId: 'user-1',
          projectId: 'project-1',
          title: 'Draft antigo',
          updatedAt: new Date('2025-01-01T00:00:00.000Z')
        }
      ];
    }
  };
}

function retentionPrismaMock(calls, overrides = {}) {
  const client = {
    userSession: modelMock(calls, 'userSession'),
    passwordResetToken: modelMock(calls, 'passwordResetToken'),
    reportAuditLog: modelMock(calls, 'reportAuditLog'),
    epiSignatureRequestAuditLog: modelMock(calls, 'epiSignatureRequestAuditLog'),
    satisfactionSurvey: modelMock(calls, 'satisfactionSurvey'),
    reportDraft: modelMock(calls, 'reportDraft'),
    dataRetentionRun: {
      create: async args => {
        calls.push(['dataRetentionRun', 'create', args]);
        return { id: 'retention-run-1' };
      },
      update: async args => {
        calls.push(['dataRetentionRun', 'update', args]);
        return { id: args.where.id, ...args.data };
      }
    }
  };
  const tx = {
    userSession: client.userSession,
    passwordResetToken: client.passwordResetToken,
    reportAuditLog: client.reportAuditLog,
    epiSignatureRequestAuditLog: client.epiSignatureRequestAuditLog,
    satisfactionSurvey: client.satisfactionSurvey,
    reportDraft: client.reportDraft,
    dataRetentionRun: client.dataRetentionRun
  };
  return {
    ...client,
    $transaction: async callback => callback(overrides.tx || tx),
    ...overrides
  };
}

function emptyRetentionModel(calls, model) {
  return {
    count: async args => {
      calls.push([model, 'count', args]);
      return 0;
    },
    findMany: async args => {
      calls.push([model, 'findMany', args]);
      return [];
    },
    deleteMany: async args => {
      calls.push([model, 'deleteMany', args]);
      return { count: 0 };
    },
    updateMany: async args => {
      calls.push([model, 'updateMany', args]);
      return { count: 0 };
    }
  };
}

test('retentionCutoffs computes operational retention windows', () => {
  const now = new Date('2026-05-22T12:00:00.000Z');
  const cutoffs = retentionCutoffs(now);

  assert.equal(cutoffs.now, now);
  assert.equal(cutoffs.auditLogAnonymizeBefore.toISOString(), '2024-05-22T12:00:00.000Z');
  assert.equal(cutoffs.surveyEvidenceAnonymizeBefore.toISOString(), '2025-05-22T12:00:00.000Z');
  assert.equal(cutoffs.abandonedDraftDeleteBefore.toISOString(), '2025-11-20T12:00:00.000Z');
});

test('runDataRetention removes expirable data and anonymizes operational metadata only', async () => {
  const calls = [];
  const prismaClient = retentionPrismaMock(calls);

  const summary = await runDataRetention({
    prismaClient,
    now: new Date('2026-05-22T12:00:00.000Z'),
    logger: { info() {}, error() {} }
  });

  assert.deepEqual(summary, {
    expiredSessions: 1,
    expiredPasswordTokens: 1,
    reportAuditLogsAnonymized: 2,
    epiAuditLogsAnonymized: 2,
    satisfactionSurveysAnonymized: 2,
    abandonedDraftsDeleted: 0,
    abandonedDraftIdsDeleted: [],
    abandonedDraftDeletionRequiresExplicitIds: false,
    batches: {
      expiredSessions: 1,
      expiredPasswordTokens: 1,
      reportAuditLogs: 1,
      epiAuditLogs: 1,
      satisfactionSurveys: 1,
      abandonedDrafts: 0
    },
    batchSize: 500,
    maxBatchesPerTarget: 20
  });
  assert.deepEqual(calls.map(([model, action]) => [model, action]), [
    ['dataRetentionRun', 'create'],
    ['userSession', 'findMany'],
    ['userSession', 'deleteMany'],
    ['passwordResetToken', 'findMany'],
    ['passwordResetToken', 'deleteMany'],
    ['reportAuditLog', 'findMany'],
    ['reportAuditLog', 'updateMany'],
    ['epiSignatureRequestAuditLog', 'findMany'],
    ['epiSignatureRequestAuditLog', 'updateMany'],
    ['satisfactionSurvey', 'findMany'],
    ['satisfactionSurvey', 'updateMany'],
    ['dataRetentionRun', 'update']
  ]);
  assert.equal(calls.at(-1)[2].data.status, 'COMPLETED');
  assert.equal(calls.some(([model]) => ['reportSignature', 'epiSignatureRequest', 'epiRecord'].includes(model)), false);
});

test('runDataRetention does not delete abandoned drafts without explicit IDs', async () => {
  const calls = [];
  const prismaClient = retentionPrismaMock(calls);

  const summary = await runDataRetention({
    prismaClient,
    now: new Date('2026-05-22T12:00:00.000Z'),
    logger: { info() {}, error() {} },
    deleteAbandonedDrafts: true
  });

  assert.equal(summary.abandonedDraftsDeleted, 0);
  assert.deepEqual(summary.abandonedDraftIdsDeleted, []);
  assert.equal(summary.abandonedDraftDeletionRequiresExplicitIds, true);
  assert.equal(calls.some(([model, action]) => model === 'reportDraft' && action === 'deleteMany'), false);
});

test('runDataRetention processes retention in multiple bounded batches', async () => {
  const calls = [];
  let sessionBatch = 0;
  const userSession = {
    findMany: async args => {
      calls.push(['userSession', 'findMany', args]);
      sessionBatch += 1;
      if (sessionBatch > 2) return [];
      return [
        { id: `session-${sessionBatch}-1` },
        { id: `session-${sessionBatch}-2` }
      ];
    },
    deleteMany: async args => {
      calls.push(['userSession', 'deleteMany', args]);
      return { count: args.where.AND[1].id.in.length };
    }
  };
  const client = {
    userSession,
    passwordResetToken: emptyRetentionModel(calls, 'passwordResetToken'),
    reportAuditLog: emptyRetentionModel(calls, 'reportAuditLog'),
    epiSignatureRequestAuditLog: emptyRetentionModel(calls, 'epiSignatureRequestAuditLog'),
    satisfactionSurvey: emptyRetentionModel(calls, 'satisfactionSurvey'),
    reportDraft: emptyRetentionModel(calls, 'reportDraft'),
    dataRetentionRun: {
      create: async args => {
        calls.push(['dataRetentionRun', 'create', args]);
        return { id: 'retention-run-1' };
      },
      update: async args => {
        calls.push(['dataRetentionRun', 'update', args]);
        return { id: args.where.id, ...args.data };
      }
    }
  };
  const prismaClient = {
    ...client,
    $transaction: async callback => callback(client)
  };

  const summary = await runDataRetention({
    prismaClient,
    now: new Date('2026-05-22T12:00:00.000Z'),
    logger: { info() {}, error() {} },
    batchSize: 2,
    maxBatchesPerTarget: 2
  });

  assert.equal(summary.expiredSessions, 4);
  assert.equal(summary.batches.expiredSessions, 2);
  assert.equal(calls.filter(([model, action]) => model === 'userSession' && action === 'deleteMany').length, 2);
});

test('runDataRetention deletes abandoned drafts only by explicit reviewed IDs', async () => {
  const calls = [];
  const prismaClient = retentionPrismaMock(calls);

  const summary = await runDataRetention({
    prismaClient,
    now: new Date('2026-05-22T12:00:00.000Z'),
    logger: { info() {}, error() {} },
    deleteAbandonedDrafts: true,
    abandonedDraftIds: ['draft-rdo-1', 'draft-romaneio-1', 'draft-extra-1'],
    batchSize: 1
  });

  assert.equal(summary.abandonedDraftsDeleted, 1);
  assert.deepEqual(summary.abandonedDraftIdsDeleted, ['draft-rdo-1']);
  assert.equal(summary.abandonedDraftDeletionRequiresExplicitIds, false);
  assert.deepEqual(
    calls.find(([model, action]) => model === 'reportDraft' && action === 'deleteMany')[2].where,
    {
      AND: [
        abandonedDraftExplicitDeleteWhere({
          abandonedDrafts: { updatedAt: { lt: new Date('2025-11-20T12:00:00.000Z') } }
        }, ['draft-rdo-1', 'draft-romaneio-1', 'draft-extra-1']),
        { id: { in: ['draft-rdo-1'] } }
      ]
    }
  );
});

test('runDataRetention records failed runs after a failed batch for idempotent retry', async () => {
  const calls = [];
  const base = retentionPrismaMock(calls);
  const failingTx = {
    userSession: base.userSession,
    passwordResetToken: {
      deleteMany: async args => {
        calls.push(['passwordResetToken', 'deleteMany', args]);
        throw new Error('database write failed');
      }
    },
    reportAuditLog: base.reportAuditLog,
    epiSignatureRequestAuditLog: base.epiSignatureRequestAuditLog,
    satisfactionSurvey: base.satisfactionSurvey,
    reportDraft: base.reportDraft,
    dataRetentionRun: base.dataRetentionRun
  };
  const prismaClient = retentionPrismaMock(calls, {
    $transaction: async callback => callback(failingTx)
  });

  await assert.rejects(
    () => runDataRetention({
      prismaClient,
      now: new Date('2026-05-22T12:00:00.000Z'),
      logger: { info() {}, error() {} }
    }),
    /database write failed/
  );

  const failedRunUpdate = calls.find(([model, action, args]) => (
    model === 'dataRetentionRun'
    && action === 'update'
    && args.data.status === 'FAILED'
  ));
  assert.ok(failedRunUpdate);
  assert.match(failedRunUpdate[2].data.error, /database write failed/);
});

test('previewDataRetention counts affected rows without mutating data', async () => {
  const calls = [];
  const prismaClient = {
    userSession: modelMock(calls, 'userSession'),
    passwordResetToken: modelMock(calls, 'passwordResetToken'),
    reportAuditLog: modelMock(calls, 'reportAuditLog'),
    epiSignatureRequestAuditLog: modelMock(calls, 'epiSignatureRequestAuditLog'),
    satisfactionSurvey: modelMock(calls, 'satisfactionSurvey'),
    reportDraft: modelMock(calls, 'reportDraft')
  };

  const preview = await previewDataRetention({
    prismaClient,
    now: new Date('2026-05-22T12:00:00.000Z')
  });

  assert.deepEqual(preview, {
    now: '2026-05-22T12:00:00.000Z',
    auditLogAnonymizeBefore: '2024-05-22T12:00:00.000Z',
    surveyEvidenceAnonymizeBefore: '2025-05-22T12:00:00.000Z',
    abandonedDraftDeleteBefore: '2025-11-20T12:00:00.000Z',
    expiredSessions: 3,
    expiredPasswordTokens: 3,
    reportAuditLogsToAnonymize: 3,
    epiAuditLogsToAnonymize: 3,
    satisfactionSurveysToAnonymize: 3,
    abandonedDraftsToReview: 3,
    abandonedDraftPreviewLimit: 100,
    abandonedDraftIdsToReview: ['reportDraft-1'],
    abandonedDraftsToReviewSample: [
      {
        id: 'reportDraft-1',
        userId: 'user-1',
        projectId: 'project-1',
        title: 'Draft antigo',
        updatedAt: new Date('2025-01-01T00:00:00.000Z')
      }
    ]
  });
  assert.deepEqual(calls.map(([model, action]) => [model, action]), [
    ['userSession', 'count'],
    ['passwordResetToken', 'count'],
    ['reportAuditLog', 'count'],
    ['epiSignatureRequestAuditLog', 'count'],
    ['satisfactionSurvey', 'count'],
    ['reportDraft', 'count'],
    ['reportDraft', 'findMany']
  ]);
});

test('data retention boot job is disabled unless explicitly enabled', () => {
  assert.equal(shouldStartDataRetentionJob(), false);
  assert.equal(shouldStartDataRetentionJob({ enabled: false }), false);
  assert.equal(shouldStartDataRetentionJob({ enabled: true }), true);
  assert.equal(startDataRetentionJob({ logger: { info() {}, error() {} } }), null);
});
