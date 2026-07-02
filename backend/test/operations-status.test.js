import assert from 'node:assert/strict';
import test from 'node:test';

import { getOperationalStatus } from '../src/lib/operations/status.js';

test('getOperationalStatus summarizes job failures, locks and queues', async () => {
  const now = new Date('2026-07-02T12:00:00.000Z');
  const files = new Map([
    ['/status/backup.json', JSON.stringify({
      status: 'SUCCESS',
      startedAt: '2026-07-01T09:00:00.000Z',
      finishedAt: '2026-07-01T09:05:00.000Z',
      runDir: '/backups/2026-07-01-090000'
    })],
    ['/status/restore.json', JSON.stringify({
      status: 'FAILURE',
      startedAt: '2026-07-01T10:00:00.000Z',
      finishedAt: '2026-07-01T10:05:00.000Z',
      backupSource: '/backups/2026-07-01-090000'
    })]
  ]);
  const client = {
    jobRun: {
      async findMany() {
        return [
          {
            id: 'run-signature',
            name: 'signature-reminders',
            status: 'FAILED',
            startedAt: new Date('2026-07-02T10:00:00.000Z'),
            finishedAt: new Date('2026-07-02T10:00:03.000Z'),
            durationMs: 3000,
            metadata: { intervalMs: 3600000 },
            result: null,
            error: 'smtp unavailable'
          },
          {
            id: 'run-survey',
            name: 'survey-reminders',
            status: 'COMPLETED',
            startedAt: new Date('2026-07-02T09:00:00.000Z'),
            finishedAt: new Date('2026-07-02T09:00:01.000Z'),
            durationMs: 1000,
            metadata: null,
            result: { sent: 1 },
            error: null
          },
          {
            id: 'run-zapsign',
            name: 'legacy-zapsign-reconciliation',
            status: 'COMPLETED',
            startedAt: new Date('2026-07-02T09:00:00.000Z'),
            finishedAt: new Date('2026-07-02T09:00:01.000Z'),
            durationMs: 1000,
            metadata: { intervalMs: 15 * 60 * 1000 },
            result: { checked: 0 },
            error: null
          }
        ];
      }
    },
    dataRetentionRun: {
      async findFirst() {
        return {
          id: 'retention-1',
          status: 'COMPLETED',
          mode: 'APPLY',
          deleteAbandonedDrafts: true,
          startedAt: new Date('2026-07-01T03:00:00.000Z'),
          finishedAt: new Date('2026-07-01T03:00:02.000Z'),
          summary: { users: 0 },
          error: null
        };
      }
    },
    reportApprovalPostProcessingJob: {
      async groupBy() {
        return [
          { status: 'PENDING', _count: { _all: 3 } },
          { status: 'FAILED', _count: { _all: 1 } }
        ];
      },
      async findFirst() {
        return {
          id: 'approval-1',
          reportId: 'report-1',
          attempts: 2,
          lockedAt: new Date('2026-07-02T11:30:00.000Z'),
          completedAt: null,
          error: 'pdf failed',
          createdAt: new Date('2026-07-02T11:00:00.000Z'),
          updatedAt: new Date('2026-07-02T11:30:00.000Z')
        };
      }
    },
    jobLock: {
      async findMany() {
        return [
          {
            name: 'signature-reminders',
            owner: 'api-1:123',
            lockedAt: new Date('2026-07-02T11:59:00.000Z'),
            expiresAt: new Date('2026-07-02T12:59:00.000Z')
          }
        ];
      }
    }
  };

  const status = await getOperationalStatus({
    prismaClient: client,
    now,
    config: {
      operationsBackupStatusFile: '/status/backup.json',
      operationsRestoreStatusFile: '/status/restore.json',
      operationsRequireBackupStatus: true,
      operationsRequireRestoreStatus: true,
      operationsBackupMaxAgeHours: 24,
      operationsRestoreMaxAgeDays: 30,
      operationsAlertJobEnabled: false,
      operationsAlertWebhookUrl: '',
      operationsAlertIntervalMs: 60 * 60 * 1000,
      errorTrackingWebhookUrl: '',
      errorTrackingProvider: 'webhook'
    },
    readFile: async filePath => files.get(filePath)
  });

  assert.equal(status.ok, false);
  assert.equal(status.generatedAt, '2026-07-02T12:00:00.000Z');
  assert.equal(status.jobs.recurring.find(job => job.name === 'signature-reminders').latestRun.status, 'FAILED');
  assert.equal(status.jobs.reportApprovalPostProcessing.counts.PENDING, 3);
  assert.equal(status.jobs.reportApprovalPostProcessing.counts.FAILED, 1);
  assert.equal(status.jobs.activeLocks[0].name, 'signature-reminders');
  assert.equal(status.backup.status, 'STALE');
  assert.equal(status.restore.status, 'FAILURE');
  assert.equal(status.problems.length, 5);
  assert.equal(status.errorTracking.enabled, false);
});

test('getOperationalStatus flags required status files without configured paths', async () => {
  const client = {
    jobRun: { async findMany() { return []; } },
    dataRetentionRun: { async findFirst() { return null; } },
    reportApprovalPostProcessingJob: {
      async groupBy() { return []; },
      async findFirst() { return null; }
    },
    jobLock: { async findMany() { return []; } }
  };

  const status = await getOperationalStatus({
    prismaClient: client,
    now: new Date('2026-07-02T12:00:00.000Z'),
    config: {
      operationsBackupStatusFile: '',
      operationsRestoreStatusFile: '',
      operationsRequireBackupStatus: true,
      operationsRequireRestoreStatus: true,
      operationsBackupMaxAgeHours: 24,
      operationsRestoreMaxAgeDays: 30,
      operationsAlertJobEnabled: false,
      operationsAlertWebhookUrl: '',
      operationsAlertIntervalMs: 60 * 60 * 1000,
      errorTrackingWebhookUrl: '',
      errorTrackingProvider: 'webhook'
    }
  });

  assert.equal(status.ok, false);
  assert.equal(status.backup.status, 'NOT_CONFIGURED');
  assert.equal(status.restore.status, 'NOT_CONFIGURED');
  assert.deepEqual(status.problems.map(item => item.message), [
    'Status de backup obrigatório não está configurado.',
    'Status de restore obrigatório não está configurado.'
  ]);
});
