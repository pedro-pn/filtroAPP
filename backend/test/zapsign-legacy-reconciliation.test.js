import assert from 'node:assert/strict';
import test from 'node:test';
import { ReportStatus, ReportType } from '@prisma/client';

import {
  legacyZapSignCompletionData,
  processPendingLegacyZapSignReports
} from '../src/lib/zapsign-legacy-reconciliation.js';

test('legacyZapSignCompletionData finalizes only signed pending legacy RDOs', () => {
  const now = new Date('2026-05-21T12:00:00.000Z');
  const report = {
    reportType: ReportType.RDO,
    status: ReportStatus.APPROVED,
    zapsignDocToken: 'legacy-token',
    zapsignSignedAt: null
  };

  assert.deepEqual(
    legacyZapSignCompletionData(report, {
      status: 'signed',
      signedFile: 'https://signed.example.com/report.pdf',
      raw: { signed_at: '2026-05-21T11:00:00.000Z' }
    }, now),
    {
      status: ReportStatus.SIGNED,
      zapsignSignedAt: new Date('2026-05-21T11:00:00.000Z'),
      zapsignDocUrl: 'https://signed.example.com/report.pdf'
    }
  );

  assert.equal(legacyZapSignCompletionData(report, { status: 'pending', signedFile: 'https://signed.example.com/report.pdf' }, now), null);
  assert.equal(legacyZapSignCompletionData({ ...report, status: ReportStatus.SIGNED }, { status: 'signed', signedFile: 'x' }, now), null);
  assert.equal(legacyZapSignCompletionData(
    { ...report, project: { deletedAt: new Date('2026-05-20T00:00:00.000Z') } },
    { status: 'signed', signedFile: 'https://signed.example.com/report.pdf' },
    now
  ), null);
});

test('processPendingLegacyZapSignReports persists reports signed after ZapSign removal', async () => {
  const report = {
    id: 'report-1',
    reportType: ReportType.RDO,
    status: ReportStatus.APPROVED,
    zapsignDocToken: 'legacy-token',
    zapsignSignedAt: null,
    project: {
      clientCnpj: '12345678000190'
    },
    clientReviews: []
  };
  const updates = [];
  const reviews = [];
  const prismaClient = {
    report: {
      count: async args => {
        assert.deepEqual(args.where.project, { deletedAt: null });
        return 1;
      },
      findMany: async args => {
        assert.equal(args.where.status, ReportStatus.APPROVED);
        assert.deepEqual(args.where.zapsignDocToken, { not: null });
        assert.deepEqual(args.where.project, { deletedAt: null });
        return [report];
      }
    },
    $transaction: async callback => callback({
      report: {
        findUnique: async () => report,
        update: async args => {
          updates.push(args);
          return { ...report, ...args.data };
        }
      },
      user: {
        findFirst: async args => {
          assert.equal(args.where.username.equals, '12345678000190');
          return { id: 'client-user-1' };
        }
      },
      clientReportReview: {
        create: async args => {
          reviews.push(args);
          return args.data;
        }
      }
    })
  };

  const result = await processPendingLegacyZapSignReports({
    prismaClient,
    getDocument: async token => {
      assert.equal(token, 'legacy-token');
      return {
        status: 'signed',
        signedFile: 'https://signed.example.com/report.pdf',
        raw: { signed_at: '2026-05-21T11:00:00.000Z' }
      };
    }
  });

  assert.deepEqual(result, { checked: 1, reconciled: 1 });
  assert.equal(updates[0].where.id, 'report-1');
  assert.equal(updates[0].data.status, ReportStatus.SIGNED);
  assert.equal(updates[0].data.zapsignDocUrl, 'https://signed.example.com/report.pdf');
  assert.equal(updates[0].data.zapsignSignedAt.toISOString(), '2026-05-21T11:00:00.000Z');
  assert.equal(reviews[0].data.action, 'APPROVED');
  assert.equal(reviews[0].data.userAgent, 'Legacy ZapSign Reconciliation');
});

test('processPendingLegacyZapSignReports scans beyond the first legacy batch', async () => {
  const reports = Array.from({ length: 26 }, (_, index) => ({
    id: `report-${index + 1}`,
    reportType: ReportType.RDO,
    status: ReportStatus.APPROVED,
    zapsignDocToken: `legacy-token-${index + 1}`,
    zapsignSignedAt: null,
    project: {
      clientCnpj: '12345678000190'
    },
    clientReviews: []
  }));
  const updates = [];
  const prismaClient = {
    report: {
      count: async () => reports.length,
      findMany: async args => {
        assert.equal(args.take, 26);
        return reports.slice(args.skip || 0, (args.skip || 0) + args.take);
      }
    },
    $transaction: async callback => callback({
      report: {
        findUnique: async args => reports.find(report => report.id === args.where.id),
        update: async args => {
          updates.push(args);
          const report = reports.find(item => item.id === args.where.id);
          return { ...report, ...args.data };
        }
      },
      user: {
        findFirst: async () => ({ id: 'client-user-1' })
      },
      clientReportReview: {
        create: async args => args.data
      }
    })
  };

  const result = await processPendingLegacyZapSignReports({
    prismaClient,
    limit: 25,
    scanLimit: 26,
    getDocument: async token => ({
      status: token === 'legacy-token-26' ? 'signed' : 'pending',
      signedFile: token === 'legacy-token-26' ? 'https://signed.example.com/report-26.pdf' : null,
      raw: { signed_at: '2026-05-21T11:00:00.000Z' }
    })
  });

  assert.deepEqual(result, { checked: 26, reconciled: 1 });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, 'report-26');
});

test('processPendingLegacyZapSignReports does not mutate soft-deleted projects inside transaction', async () => {
  const report = {
    id: 'report-1',
    reportType: ReportType.RDO,
    status: ReportStatus.APPROVED,
    zapsignDocToken: 'legacy-token',
    zapsignSignedAt: null,
    project: {
      clientCnpj: '12345678000190',
      deletedAt: new Date('2026-05-20T00:00:00.000Z')
    },
    clientReviews: []
  };
  let updateCalled = false;
  let reviewCalled = false;
  const prismaClient = {
    report: {
      count: async () => 1,
      findMany: async () => [report]
    },
    $transaction: async callback => callback({
      report: {
        findUnique: async () => report,
        update: async () => {
          updateCalled = true;
          return report;
        }
      },
      user: {
        findFirst: async () => ({ id: 'client-user-1' })
      },
      clientReportReview: {
        create: async () => {
          reviewCalled = true;
          return {};
        }
      }
    })
  };

  const result = await processPendingLegacyZapSignReports({
    prismaClient,
    getDocument: async () => ({
      status: 'signed',
      signedFile: 'https://signed.example.com/report.pdf',
      raw: { signed_at: '2026-05-21T11:00:00.000Z' }
    })
  });

  assert.deepEqual(result, { checked: 1, reconciled: 0 });
  assert.equal(updateCalled, false);
  assert.equal(reviewCalled, false);
});
