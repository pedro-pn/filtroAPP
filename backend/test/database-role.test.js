import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDatabaseRole,
  databaseRoleStatus,
  warnIfPrivilegedDatabaseRole
} from '../src/lib/operations/database-role.js';
import { getOperationalStatus } from '../src/lib/operations/status.js';

const restrictedRow = {
  user: 'filtrovali_app',
  superuser: false,
  canCreateInPublic: false,
  canCreateSchema: false,
  ownedTables: 0
};

test('classifyDatabaseRole separa papel restrito de dono/superusuário', () => {
  assert.equal(classifyDatabaseRole(restrictedRow).status, 'RESTRICTED');
  assert.equal(classifyDatabaseRole({ ...restrictedRow, user: 'postgres', superuser: true }).status, 'PRIVILEGED');
  assert.equal(classifyDatabaseRole({ ...restrictedRow, canCreateInPublic: true }).status, 'PRIVILEGED');
  assert.equal(classifyDatabaseRole({ ...restrictedRow, canCreateSchema: true }).status, 'PRIVILEGED');
  assert.equal(classifyDatabaseRole({ ...restrictedRow, ownedTables: 3 }).status, 'PRIVILEGED');
  assert.equal(classifyDatabaseRole(null).status, 'UNKNOWN');
});

test('databaseRoleStatus tolera cliente sem $queryRaw ou consulta com erro', async () => {
  assert.deepEqual(await databaseRoleStatus({}), { status: 'UNKNOWN' });
  assert.deepEqual(await databaseRoleStatus({ async $queryRaw() { throw new Error('offline'); } }), { status: 'UNKNOWN' });
  const status = await databaseRoleStatus({ async $queryRaw() { return [restrictedRow]; } });
  assert.equal(status.status, 'RESTRICTED');
  assert.equal(status.user, 'filtrovali_app');
});

test('warnIfPrivilegedDatabaseRole só avisa quando o papel é privilegiado', async () => {
  const warnings = [];
  const logger = { warn: message => warnings.push(message) };
  await warnIfPrivilegedDatabaseRole({ async $queryRaw() { return [restrictedRow]; } }, { logger });
  assert.equal(warnings.length, 0);
  await warnIfPrivilegedDatabaseRole(
    { async $queryRaw() { return [{ ...restrictedRow, user: 'postgres', superuser: true }]; } },
    { logger, processName: 'worker' }
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\[worker\].*"postgres"/);
  assert.doesNotMatch(warnings[0], /password|senha=/i);
});

function statusClient(roleRow) {
  return {
    jobRun: { async findMany() { return []; } },
    dataRetentionRun: { async findFirst() { return null; } },
    reportApprovalPostProcessingJob: {
      async groupBy() { return []; },
      async findFirst() { return null; }
    },
    jobLock: { async findMany() { return []; } },
    integrationSyncRun: { async findMany() { return []; } },
    accessImport: { async findFirst() { return null; } },
    async $queryRaw() { return [roleRow]; }
  };
}

const baseConfig = {
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
  commercialImportToken: '',
  omieAppKey: '',
  omieAppSecret: '',
  omieSyncEnabled: false
};

test('getOperationalStatus expõe o papel do banco e só alerta quando exigido', async () => {
  const privileged = { ...restrictedRow, user: 'postgres', superuser: true };
  const now = new Date('2026-11-18T12:00:00.000Z');

  const lenient = await getOperationalStatus({ prismaClient: statusClient(privileged), now, config: baseConfig });
  assert.equal(lenient.database.status, 'PRIVILEGED');
  assert.equal(lenient.ok, true);

  const strict = await getOperationalStatus({
    prismaClient: statusClient(privileged),
    now,
    config: { ...baseConfig, operationsRequireRestrictedDbRole: true }
  });
  assert.equal(strict.ok, false);
  assert.deepEqual(strict.problems, [{
    message: 'Aplicação conectada ao banco com papel de dono/superusuário.',
    scope: 'database-role',
    source: 'postgres'
  }]);

  const restricted = await getOperationalStatus({
    prismaClient: statusClient(restrictedRow),
    now,
    config: { ...baseConfig, operationsRequireRestrictedDbRole: true }
  });
  assert.equal(restricted.ok, true);
  assert.equal(restricted.database.status, 'RESTRICTED');
});
