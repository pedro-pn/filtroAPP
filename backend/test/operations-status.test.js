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
        assert.deepEqual(arguments[0].orderBy, { startedAt: 'desc' });
        return [
          { id: 'probe', name: 'assinaturas:finalization', status: 'COMPLETED', startedAt: new Date(now.getTime() - 10 * 60_000), finishedAt: now, result: { noop: true, checks: 10 } },
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
    },
    integrationSyncRun: {
      async findMany() {
        return [
          {
            id: 'omie-1',
            integration: 'OMIE',
            scope: 'purchases',
            status: 'SUCCESS',
            recordsRead: 10,
            recordsWritten: 8,
            error: null,
            summary: { linkedProjects: 2 },
            triggeredBy: 'SCHEDULE',
            startedAt: new Date('2026-07-02T08:00:00.000Z'),
            finishedAt: new Date('2026-07-02T08:00:10.000Z')
          },
          {
            id: 'omie-projects-error', integration: 'OMIE', scope: 'projects', status: 'ERROR',
            error: 'projects unavailable', startedAt: new Date('2026-07-02T07:00:00.000Z'),
            finishedAt: new Date('2026-07-02T07:00:10.000Z')
          }
        ];
      }
    },
    accessImport: {
      async findFirst() {
        return {
          id: 'access-1',
          fileName: 'propostas_bd.accdb',
          source: 'SCRIPT',
          status: 'SUCCESS',
          rowsRead: 50,
          created: 2,
          updated: 48,
          skipped: 0,
          pendingProjectsCreated: 0,
          error: null,
          summary: { proposals: 50 },
          importedByUserId: null,
          createdAt: new Date('2026-07-02T07:00:00.000Z')
        };
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
      errorTrackingProvider: 'webhook',
      commercialImportToken: 'token',
      omieAppKey: 'key',
      omieAppSecret: 'secret',
      omieSyncEnabled: true
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
  assert.equal(status.omie.status, 'SUCCESS');
  assert.equal(status.commercialImport.status, 'SUCCESS');
  assert.equal(status.problems.length, 6);
  assert.ok(status.problems.some(issue => issue.job === 'omie-sync' && issue.scope === 'projects'), 'sucesso de compras não esconde falha de projetos');
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
    jobLock: { async findMany() { return []; } },
    integrationSyncRun: { async findMany() { return []; } },
    accessImport: { async findFirst() { return null; } }
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
      errorTrackingProvider: 'webhook',
      commercialImportToken: '',
      omieAppKey: '',
      omieAppSecret: '',
      omieSyncEnabled: false
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

test('getOperationalStatus flags Omie and commercial import failures', async () => {
  const now = new Date('2026-07-02T12:00:00.000Z');
  const client = {
    jobRun: { async findMany() { return []; } },
    dataRetentionRun: { async findFirst() { return null; } },
    reportApprovalPostProcessingJob: {
      async groupBy() { return []; },
      async findFirst() { return null; }
    },
    jobLock: { async findMany() { return []; } },
    integrationSyncRun: {
      async findMany() {
        return [
          {
            id: 'omie-error',
            integration: 'OMIE',
            scope: 'purchases',
            status: 'ERROR',
            recordsRead: 20,
            recordsWritten: 10,
            error: 'omie unavailable',
            summary: null,
            triggeredBy: 'SCHEDULE',
            startedAt: new Date('2026-07-02T11:00:00.000Z'),
            finishedAt: new Date('2026-07-02T11:00:20.000Z')
          }
        ];
      }
    },
    accessImport: {
      async findFirst() {
        return {
          id: 'access-error',
          fileName: 'propostas_bd.accdb',
          source: 'SCRIPT',
          status: 'ERROR',
          rowsRead: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          pendingProjectsCreated: 0,
          error: 'invalid access file',
          summary: { errorName: 'Error' },
          importedByUserId: null,
          createdAt: new Date('2026-07-02T10:00:00.000Z')
        };
      }
    }
  };

  const status = await getOperationalStatus({
    prismaClient: client,
    now,
    config: {
      operationsBackupStatusFile: '',
      operationsRestoreStatusFile: '',
      operationsRequireBackupStatus: false,
      operationsRequireRestoreStatus: false,
      operationsBackupMaxAgeHours: 24,
      operationsRestoreMaxAgeDays: 30,
      operationsAlertJobEnabled: false,
      operationsAlertWebhookUrl: '',
      operationsAlertIntervalMs: 60 * 60 * 1000,
      errorTrackingWebhookUrl: '',
      errorTrackingProvider: 'webhook',
      commercialImportToken: 'token',
      omieAppKey: 'key',
      omieAppSecret: 'secret',
      omieSyncEnabled: true
    }
  });

  assert.equal(status.ok, false);
  assert.equal(status.omie.status, 'ERROR');
  assert.equal(status.commercialImport.status, 'ERROR');
  assert.deepEqual(status.problems.map(item => item.message), [
    'Sincronização Omie falhou na última execução.',
    'Recebimento do banco comercial falhou na última execução.'
  ]);
});

function emptyOperationsClient() {
  return {
    jobRun: { async findMany() { return []; } },
    dataRetentionRun: { async findFirst() { return null; } },
    reportApprovalPostProcessingJob: {
      async groupBy() { return []; },
      async findFirst() { return null; }
    },
    jobLock: { async findMany() { return []; } },
    integrationSyncRun: { async findMany() { return []; } },
    accessImport: { async findFirst() { return null; } }
  };
}

function deployConfig(overrides = {}) {
  return {
    operationsBackupStatusFile: '',
    operationsRestoreStatusFile: '',
    operationsDeployStatusFile: '/status/deploy-latest.json',
    operationsRequireBackupStatus: false,
    operationsRequireRestoreStatus: false,
    operationsRequireDeployStatus: false,
    operationsBackupMaxAgeHours: 24,
    operationsRestoreMaxAgeDays: 30,
    operationsAlertJobEnabled: false,
    operationsAlertWebhookUrl: '',
    operationsAlertIntervalMs: 60 * 60 * 1000,
    errorTrackingWebhookUrl: '',
    errorTrackingProvider: 'webhook',
    commercialImportToken: '',
    omieAppKey: '',
    omieAppSecret: '',
    omieSyncEnabled: false,
    ...overrides
  };
}

const NEW_SHA = 'a'.repeat(40);
const OLD_SHA = 'b'.repeat(40);

for (const [deployState, message] of [
  ['ROLLED_BACK', 'Último deploy falhou e voltou automaticamente para a versão anterior.'],
  ['FAILURE', 'Último deploy falhou.']
]) {
  test(`getOperationalStatus flags a ${deployState} deploy until a later success`, async () => {
    const files = new Map([['/status/deploy-latest.json', JSON.stringify({
      kind: 'deploy',
      mode: 'deploy',
      status: deployState,
      startedAt: '2026-11-18T20:00:00+00:00',
      finishedAt: '2026-11-18T20:04:00+00:00',
      sha: NEW_SHA,
      previousSha: OLD_SHA,
      message: 'conferência pós-deploy falhou'
    })]]);
    const status = await getOperationalStatus({
      prismaClient: emptyOperationsClient(),
      now: new Date('2026-11-25T12:00:00.000Z'),
      config: deployConfig(),
      readFile: async filePath => {
        if (!files.has(filePath)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return files.get(filePath);
      }
    });

    assert.equal(status.ok, false);
    assert.equal(status.deploy.status, deployState);
    assert.equal(status.deploy.shortSha, NEW_SHA.slice(0, 12));
    assert.equal(status.deploy.shortPreviousSha, OLD_SHA.slice(0, 12));
    assert.deepEqual(status.problems.map(item => item.message), [message]);
    assert.equal(status.problems[0].source, NEW_SHA.slice(0, 12));
    assert.equal(status.problems[0].deploy.message, 'conferência pós-deploy falhou');
  });
}

test('getOperationalStatus accepts a successful deploy and an absent deploy file', async () => {
  const success = await getOperationalStatus({
    prismaClient: emptyOperationsClient(),
    now: new Date('2026-11-25T12:00:00.000Z'),
    config: deployConfig(),
    readFile: async () => JSON.stringify({ status: 'SUCCESS', sha: NEW_SHA, previousSha: OLD_SHA, finishedAt: '2026-11-18T20:04:00+00:00' })
  });
  assert.equal(success.ok, true);
  assert.equal(success.deploy.status, 'SUCCESS');

  const absent = await getOperationalStatus({
    prismaClient: emptyOperationsClient(),
    now: new Date('2026-11-25T12:00:00.000Z'),
    config: deployConfig(),
    readFile: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }
  });
  assert.equal(absent.deploy.status, 'MISSING');
  assert.equal(absent.ok, true, 'sem deploy-latest.json não é problema por padrão');

  const required = await getOperationalStatus({
    prismaClient: emptyOperationsClient(),
    now: new Date('2026-11-25T12:00:00.000Z'),
    config: deployConfig({ operationsRequireDeployStatus: true }),
    readFile: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }
  });
  assert.deepEqual(required.problems.map(item => item.message), ['Status de deploy obrigatório está ausente.']);
});

function quietStatusClient(jobRuns) {
  return {
    jobRun: {
      async findMany({ where, orderBy, take }) {
        return jobRuns
          .filter(run => run.name === where.name)
          .sort((a, b) => (orderBy.startedAt === 'desc' ? b.startedAt - a.startedAt : a.startedAt - b.startedAt))
          .slice(0, take);
      }
    },
    dataRetentionRun: { async findFirst() { return null; } },
    reportApprovalPostProcessingJob: {
      async groupBy() { return []; },
      async findFirst() { return null; }
    },
    jobLock: { async findMany() { return []; } },
    integrationSyncRun: { async findMany() { return []; } },
    accessImport: { async findFirst() { return null; } }
  };
}

const quietStatusConfig = {
  operationsBackupStatusFile: '',
  operationsRestoreStatusFile: '',
  operationsRequireBackupStatus: false,
  operationsRequireRestoreStatus: false,
  operationsBackupMaxAgeHours: 24,
  operationsRestoreMaxAgeDays: 30,
  operationsAlertJobEnabled: true,
  operationsAlertWebhookUrl: '',
  operationsAlertIntervalMs: 60 * 60 * 1000,
  errorTrackingWebhookUrl: '',
  errorTrackingProvider: 'webhook',
  commercialImportToken: '',
  omieAppKey: '',
  omieAppSecret: '',
  omieSyncEnabled: false
};

test('getOperationalStatus does not flag the daily calibration window as stale', async () => {
  // Produção, 2026-11: o job checa de hora em hora, mas só grava execução na
  // janela das 9h (Brasília). Às 13h10 virava "sem execução recente" todo dia.
  const now = new Date('2026-11-23T16:10:53.000Z');
  const ranAt = new Date('2026-11-23T12:10:53.000Z');
  const status = await getOperationalStatus({
    prismaClient: quietStatusClient([
      { id: 'cal', name: 'calibration-reminders', status: 'COMPLETED', startedAt: ranAt, finishedAt: ranAt, metadata: { intervalMs: 3_600_000 } }
    ]),
    now,
    config: quietStatusConfig
  });

  assert.equal(status.jobs.recurring.find(job => job.name === 'calibration-reminders').latestRun.id, 'cal');
  assert.deepEqual(status.problems, []);
});

test('getOperationalStatus still sees an infrequent job behind many frequent runs', async () => {
  const now = new Date('2026-11-25T12:00:00.000Z');
  const runs = [];
  for (let index = 0; index < 200; index += 1) {
    const startedAt = new Date(now.getTime() - index * 15 * 60_000);
    runs.push({ id: `p-${index}`, name: 'pontomais-sync', status: 'COMPLETED', startedAt, finishedAt: startedAt, metadata: { intervalMs: 900_000 } });
  }
  const oldRun = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  runs.push({ id: 'cal-old', name: 'calibration-reminders', status: 'COMPLETED', startedAt: oldRun, finishedAt: oldRun, metadata: { intervalMs: 3_600_000 } });

  const status = await getOperationalStatus({ prismaClient: quietStatusClient(runs), now, config: quietStatusConfig });

  assert.deepEqual(status.problems.map(item => [item.message, item.job]), [
    ['Job recorrente sem execução recente.', 'calibration-reminders']
  ]);
});

test('getOperationalStatus vigia a cópia externa (B2) separada do backup local', async () => {
  const now = new Date('2026-11-26T15:00:00.000Z');
  const files = new Map([
    ['/status/backup.json', JSON.stringify({ status: 'SUCCESS', finishedAt: '2026-11-26T13:11:41Z', b2Configured: false })],
    ['/status/offsite.json', JSON.stringify({ status: 'SUCCESS', finishedAt: '2026-11-24T02:12:00Z', destination: 'b2://b/daily/2026-11-24-020001' })]
  ]);
  const readFile = async file => {
    if (!files.has(file)) throw Object.assign(new Error('não existe'), { code: 'ENOENT' });
    return files.get(file);
  };
  const config = {
    ...quietStatusConfig,
    operationsBackupStatusFile: '/status/backup.json',
    operationsOffsiteBackupStatusFile: '/status/offsite.json',
    operationsOffsiteBackupMaxAgeHours: 26
  };
  const stale = await getOperationalStatus({ prismaClient: quietStatusClient([]), now, config, readFile });
  assert.equal(stale.backup.status, 'SUCCESS');
  assert.equal(stale.offsiteBackup.status, 'STALE');
  assert.ok(stale.problems.some(item => item.message === 'Cópia externa do backup (B2) está velha demais.'));

  files.set('/status/offsite.json', JSON.stringify({ status: 'FAILURE', finishedAt: '2026-11-26T02:05:00Z', exitCode: 1 }));
  const failed = await getOperationalStatus({ prismaClient: quietStatusClient([]), now, config, readFile });
  assert.ok(failed.problems.some(item => item.message === 'Cópia externa do backup (B2) falhou na última execução.'));

  files.delete('/status/offsite.json');
  const missing = await getOperationalStatus({ prismaClient: quietStatusClient([]), now, config, readFile });
  assert.equal(missing.offsiteBackup.status, 'MISSING');
  assert.equal(missing.problems.some(item => item.message.includes('cópia externa')), false);
  const required = await getOperationalStatus({
    prismaClient: quietStatusClient([]), now, config: { ...config, operationsRequireOffsiteBackupStatus: true }, readFile
  });
  assert.ok(required.problems.some(item => item.message === 'Status obrigatório da cópia externa do backup (B2) está ausente.'));
});
