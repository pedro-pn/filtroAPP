import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

function runRestoreWithFakeDocker(env = {}, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-preflight-'));
  const backup = path.join(root, 'backup');
  const project = path.join(root, 'filtroAPP');
  const bin = path.join(root, 'bin');
  const dockerLog = path.join(root, 'docker.log');
  fs.mkdirSync(backup);
  fs.mkdirSync(project);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(backup, 'postgres.sql.gz'), '');
  if (options.reportsArchive) fs.writeFileSync(path.join(backup, 'relatorios.tar.gz'), '');
  if (options.certsArchive) fs.writeFileSync(path.join(backup, 'certs.tar.gz'), '');
  if (options.proxyArchive) fs.writeFileSync(path.join(backup, 'proxy.tar.gz'), '');
  if (options.proxyCompose) {
    const proxyCompose = path.resolve(project, env.PROXY_COMPOSE_FILE || '../infra-proxy/docker-compose.yml');
    fs.mkdirSync(path.dirname(proxyCompose), { recursive: true });
    fs.writeFileSync(proxyCompose, 'name: infra-proxy\nservices: {}\n');
  }
  const dockerScript = options.dockerScript || `#!/usr/bin/env bash\necho "$@" >> "${dockerLog}"\nexit 97\n`;
  fs.writeFileSync(path.join(bin, 'docker'), dockerScript);
  fs.chmodSync(path.join(bin, 'docker'), 0o755);

  const result = spawnSync('bash', [new URL('../../deploy/restore-prod.sh', import.meta.url).pathname], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      BACKUP_SOURCE: backup,
      PROJECT_DIR: project,
      REQUIRE_CHECKSUMS: 'false',
      RESTORE_STATUS_FILE: path.join(root, 'restore-status.json'),
      DOCKER_TEST_LOG: dockerLog,
      ...env
    },
    encoding: 'utf8'
  });

  const dockerCalls = fs.existsSync(dockerLog) ? fs.readFileSync(dockerLog, 'utf8') : '';
  fs.rmSync(root, { recursive: true, force: true });
  return { result, dockerCalls };
}

function writeGzip(filePath, content) {
  fs.writeFileSync(filePath, zlib.gzipSync(content));
}

function runSyncWithFakeDocker(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-staging-'));
  const backupRoot = path.join(root, 'backups');
  const bin = path.join(root, 'bin');
  const dockerLog = path.join(root, 'docker.log');
  const restoreSqlLog = path.join(root, 'restore.sql');
  const snapshotA = path.join(backupRoot, '2026-06-08-010000');
  const snapshotB = path.join(backupRoot, '2026-06-08-020000');
  const latest = path.join(backupRoot, 'latest');

  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(snapshotA, { recursive: true });
  fs.mkdirSync(snapshotB, { recursive: true });
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  writeGzip(path.join(snapshotA, 'postgres.sql.gz'), options.snapshotASql || 'SELECT 1 AS snapshot_a;');
  writeGzip(path.join(snapshotB, 'postgres.sql.gz'), options.snapshotBSql || 'SELECT 2 AS snapshot_b;');
  fs.writeFileSync(path.join(snapshotA, 'relatorios.tar.gz'), 'reports-a');
  fs.writeFileSync(path.join(snapshotB, 'relatorios.tar.gz'), 'reports-b');
  fs.symlinkSync(snapshotA, latest);

  const dockerScript = options.dockerScript || `#!/usr/bin/env bash
echo "$@" >> "${dockerLog}"
if [[ "$*" == *"ps --quiet --status running"* ]]; then
  ${options.stagingWasUp ? 'echo running-staging; exit 0' : 'exit 1'}
fi
if [[ "$*" == *"stop backend worker nginx"* ]]; then
  ${options.failStop ? 'exit 43' : 'exit 0'}
fi
if [[ "$*" == *"up -d postgres"* ]]; then
  ${options.switchLatestOnPostgresUp ? `ln -sfn "${snapshotB}" "${latest}"` : ':'}
  exit 0
fi
if [[ "$*" == *"pg_isready"* ]]; then
  exit 0
fi
if [[ "$*" == *"psql -v ON_ERROR_STOP=1"* && "$*" == *" -d filtrovali_restore_"* ]]; then
  cat > "${restoreSqlLog}"
  ${options.failRestore ? 'exit 42' : 'exit 0'}
fi
if [[ "$*" == *"run --rm --no-deps backend sh -c npx prisma migrate deploy"* ]]; then
  ${options.failMigration ? 'exit 44' : 'exit 0'}
fi
if [[ "$*" == *"psql -v ON_ERROR_STOP=1"* && "$*" == *" -d filtrovali" ]]; then
  cat > /dev/null
  echo "TEST: staging scrub" >> "${dockerLog}"
  ${options.failSanitize ? 'exit 45' : 'exit 0'}
fi
exit 0
`;
  fs.writeFileSync(path.join(bin, 'docker'), dockerScript);
  fs.chmodSync(path.join(bin, 'docker'), 0o755);

  const result = spawnSync('bash', [new URL('../../deploy/sync-staging.sh', import.meta.url).pathname], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      PROJECT_DIR: root,
      BACKUP_ROOT: backupRoot,
      LOCKFILE: path.join(root, 'sync.lock'),
      STAGING_POSTGRES_PASSWORD: 'postgres-secret',
      STAGING_ADMIN_PASSWORD_HASH: 'salt:hash',
      BUILD_SERVICES: 'false',
      ...options.env
    },
    encoding: 'utf8'
  });

  const dockerCalls = fs.existsSync(dockerLog) ? fs.readFileSync(dockerLog, 'utf8') : '';
  const restoreSql = fs.existsSync(restoreSqlLog) ? fs.readFileSync(restoreSqlLog, 'utf8') : '';
  fs.rmSync(root, { recursive: true, force: true });
  return { result, dockerCalls, restoreSql, snapshotA, snapshotB };
}

test('restore script validates checksums before mutating restored services', () => {
  const script = fs.readFileSync(new URL('../../deploy/restore-prod.sh', import.meta.url), 'utf8');

  assert.match(script, /sha256sum -c SHA256SUMS/);
  assert.ok(
    script.indexOf('sha256sum -c SHA256SUMS') < script.indexOf('docker compose -f "$COMPOSE_FILE" up -d --no-recreate "$POSTGRES_SERVICE"'),
    'backup checksums must be validated before starting restore mutations'
  );
});

test('backup default includes certs required by restore default', () => {
  const backupScript = fs.readFileSync(new URL('../../deploy/backup-prod.sh', import.meta.url), 'utf8');
  const restoreScript = fs.readFileSync(new URL('../../deploy/restore-prod.sh', import.meta.url), 'utf8');

  assert.match(backupScript, /INCLUDE_CERTS="\$\{INCLUDE_CERTS:-true\}"/);
  assert.match(restoreScript, /RESTORE_CERTS="\$\{RESTORE_CERTS:-true\}"/);
  assert.match(backupScript, /certs\.tar\.gz/);
  assert.match(restoreScript, /certs\.tar\.gz/);
});

test('backup script prevents concurrent runs before upload and cleanup', () => {
  const script = fs.readFileSync(new URL('../../deploy/backup-prod.sh', import.meta.url), 'utf8');
  const lockIndex = script.indexOf('flock -w "$BACKUP_LOCK_TIMEOUT_SECONDS" 9');
  const timestampIndex = script.indexOf('TIMESTAMP="$(date +%F-%H%M%S)"');
  const uploadIndex = script.indexOf('"$B2_BIN" sync "$RUN_DIR" "$B2_DEST"');
  const cleanupIndex = script.indexOf('find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name "20*"');

  assert.match(script, /BACKUP_LOCK_FILE="\$\{BACKUP_LOCK_FILE:-\$BACKUP_ROOT\/backup-prod\.lock\}"/);
  assert.match(script, /BACKUP_LOCK_TIMEOUT_SECONDS="\$\{BACKUP_LOCK_TIMEOUT_SECONDS:-0\}"/);
  assert.ok(lockIndex !== -1, 'backup script must acquire a lock');
  assert.ok(lockIndex < timestampIndex, 'lock must be acquired before creating the run directory');
  assert.ok(lockIndex < uploadIndex, 'lock must be held while uploading to B2');
  assert.ok(lockIndex < cleanupIndex, 'lock must be held while pruning local backups');
});

test('restore script aborts before docker when reports archive is required and missing', () => {
  const { result, dockerCalls } = runRestoreWithFakeDocker({
    RESTORE_REPORTS: 'true',
    RESTORE_CERTS: 'false'
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /relatorios\.tar\.gz/);
  assert.equal(dockerCalls, '');
});

test('restore script aborts before docker when cert archive is required and missing', () => {
  const { result, dockerCalls } = runRestoreWithFakeDocker({
    RESTORE_REPORTS: 'false',
    RESTORE_CERTS: 'true'
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /certs\.tar\.gz/);
  assert.equal(dockerCalls, '');
});

test('proxy restore aborts before docker when independent checkout is missing', () => {
  const { result, dockerCalls } = runRestoreWithFakeDocker({
    RESTORE_REPORTS: 'false', RESTORE_CERTS: 'false', RESTORE_PROXY: 'true'
  }, { proxyArchive: true });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /proxy compose not found/);
  assert.match(result.stderr, /PROXY_COMPOSE_FILE/);
  assert.equal(dockerCalls, '');
});

test('proxy restore validates sibling compose before changing services or volumes', () => {
  const { result, dockerCalls } = runRestoreWithFakeDocker({
    RESTORE_REPORTS: 'false', RESTORE_CERTS: 'false', RESTORE_PROXY: 'true'
  }, { proxyArchive: true, proxyCompose: true });

  assert.equal(result.status, 97);
  assert.equal(dockerCalls, 'compose -f ../infra-proxy/docker-compose.yml config -q\n');
});

test('proxy restore accepts a custom independent compose path', () => {
  const { result, dockerCalls } = runRestoreWithFakeDocker({
    RESTORE_REPORTS: 'false', RESTORE_CERTS: 'false', RESTORE_PROXY: 'true',
    PROXY_COMPOSE_FILE: 'operations/proxy.yml'
  }, { proxyArchive: true, proxyCompose: true });

  assert.equal(result.status, 97);
  assert.equal(dockerCalls, 'compose -f operations/proxy.yml config -q\n');
});

test('application restore does not require the independent proxy checkout by default', () => {
  const { result, dockerCalls } = runRestoreWithFakeDocker({
    RESTORE_REPORTS: 'false', RESTORE_CERTS: 'false', RESTORE_PROXY: 'false'
  });

  assert.equal(result.status, 97);
  assert.match(dockerCalls, /up -d --no-recreate postgres/);
  assert.doesNotMatch(dockerCalls, /infra-proxy/);
});

test('proxy restore does not replace the volume if stopping the independent proxy fails', () => {
  const { result, dockerCalls } = runRestoreWithFakeDocker({
    RESTORE_REPORTS: 'false', RESTORE_CERTS: 'false', RESTORE_PROXY: 'true'
  }, {
    proxyArchive: true,
    proxyCompose: true,
    dockerScript: `#!/usr/bin/env bash
echo "$@" >> "$DOCKER_TEST_LOG"
if [[ "$*" == *"tar -xzf /backup/proxy.tar.gz"* ]]; then
  for arg in "$@"; do
    if [[ "$arg" == *:/staging ]]; then
      mkdir -p "\${arg%:/staging}/proxy"
    fi
  done
fi
if [[ "$*" == "compose -f ../infra-proxy/docker-compose.yml stop" ]]; then
  exit 42
fi
exit 0
`
  });

  assert.equal(result.status, 42);
  assert.match(dockerCalls, /compose -f \.\.\/infra-proxy\/docker-compose\.yml stop/);
  assert.doesNotMatch(dockerCalls, /infra_proxy_data:\/to/);
  assert.doesNotMatch(dockerCalls, /DROP DATABASE IF EXISTS/);
});

test('restore script stops public services before mutating database or volumes', () => {
  const script = fs.readFileSync(new URL('../../deploy/restore-prod.sh', import.meta.url), 'utf8');

  assert.match(script, /docker compose -f "\$COMPOSE_FILE" stop "\$NGINX_SERVICE" "\$BACKEND_SERVICE"/);
  assert.ok(
    script.indexOf('docker compose -f "$COMPOSE_FILE" stop "$NGINX_SERVICE" "$BACKEND_SERVICE"')
      < script.indexOf('DROP DATABASE IF EXISTS $POSTGRES_DB'),
    'public services must stop before database is dropped'
  );
  assert.ok(
    script.indexOf('docker compose -f "$COMPOSE_FILE" stop "$NGINX_SERVICE" "$BACKEND_SERVICE"')
      < script.indexOf('cp -a /staging/relatorios/. /to/.restore-staging/'),
    'public services must stop before active report volume replacement'
  );
});

test('restore script validates report archive before replacing active volume or database', () => {
  const script = fs.readFileSync(new URL('../../deploy/restore-prod.sh', import.meta.url), 'utf8');
  const extractIndex = script.indexOf('tar -xzf /backup/relatorios.tar.gz -C /staging/relatorios');
  const copyIndex = script.indexOf('cp -a /staging/relatorios/. /to/.restore-staging/');
  const removeIndex = script.indexOf('find /to -mindepth 1 -maxdepth 1 ! -name .restore-staging -exec rm -rf {} +');
  const dropIndex = script.indexOf('DROP DATABASE IF EXISTS $POSTGRES_DB');

  assert.match(script, /mkdir -p \/staging\/relatorios/);
  assert.ok(extractIndex !== -1, 'reports backup must extract into temporary staging');
  assert.ok(copyIndex !== -1, 'staged reports must be copied into active volume staging');
  assert.ok(removeIndex !== -1, 'active reports volume contents must be replaced after staging');
  assert.ok(
    extractIndex < copyIndex && copyIndex < removeIndex,
    'reports backup must be fully staged before active volume contents are removed'
  );
  assert.ok(
    extractIndex < dropIndex && removeIndex < dropIndex,
    'reports archive must be staged and active volume replaced before database drop'
  );
});

test('restore script extracts staging archives as host user and can clean container-owned leftovers', () => {
  const script = fs.readFileSync(new URL('../../deploy/restore-prod.sh', import.meta.url), 'utf8');

  assert.match(
    script,
    /docker run --rm --user "\$\(id -u\):\$\(id -g\)" -v "\$\{BACKUP_SOURCE\}:\/backup:ro" -v "\$\{RESTORE_STAGING_DIR\}:\/staging" alpine sh -eu -c "rm -rf \/staging\/relatorios/
  );
  assert.match(
    script,
    /docker run --rm --user "\$\(id -u\):\$\(id -g\)" -v "\$\{BACKUP_SOURCE\}:\/backup:ro" -v "\$\{RESTORE_STAGING_DIR\}:\/staging" alpine sh -eu -c "rm -rf \/staging\/certs/
  );
  assert.match(script, /rm -rf "\$RESTORE_STAGING_DIR" 2>\/dev\/null \|\| docker run --rm/);
  assert.match(script, /rm -rf -- "\/cleanup\/\$1"/);
});

test('restore script does not drop database when report archive staging fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-tar-fail-'));
  const backup = path.join(root, 'backup');
  const bin = path.join(root, 'bin');
  const dockerLog = path.join(root, 'docker.log');
  const dockerScript = `#!/usr/bin/env bash
echo "$@" >> "${dockerLog}"
if [[ "$*" == *"tar -xzf /backup/relatorios.tar.gz"* ]]; then
  exit 42
fi
exit 0
`;
  fs.mkdirSync(backup);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(backup, 'postgres.sql.gz'), '');
  fs.writeFileSync(path.join(backup, 'relatorios.tar.gz'), '');
  fs.writeFileSync(path.join(bin, 'docker'), dockerScript);
  fs.chmodSync(path.join(bin, 'docker'), 0o755);

  const result = spawnSync('bash', [new URL('../../deploy/restore-prod.sh', import.meta.url).pathname], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      BACKUP_SOURCE: backup,
      PROJECT_DIR: root,
      REQUIRE_CHECKSUMS: 'false',
      RESTORE_REPORTS: 'true',
      RESTORE_CERTS: 'false'
    },
    encoding: 'utf8'
  });

  const dockerCalls = fs.existsSync(dockerLog) ? fs.readFileSync(dockerLog, 'utf8') : '';
  fs.rmSync(root, { recursive: true, force: true });

  assert.notEqual(result.status, 0);
  assert.match(dockerCalls, /tar -xzf \/backup\/relatorios\.tar\.gz/);
  assert.doesNotMatch(dockerCalls, /DROP DATABASE IF EXISTS/);
});

test('restore script starts application services only after restore steps', () => {
  const script = fs.readFileSync(new URL('../../deploy/restore-prod.sh', import.meta.url), 'utf8');
  const startIndex = script.indexOf('docker compose -f "$COMPOSE_FILE" up -d --no-recreate "$BACKEND_SERVICE" "$NGINX_SERVICE"');

  assert.ok(startIndex !== -1, 'backend/nginx must be started at the end');
  assert.ok(
    script.indexOf('npx prisma migrate deploy') < startIndex,
    'application services must start after migrations'
  );
  assert.ok(
    script.indexOf('tar -xzf /backup/relatorios.tar.gz -C /to/.restore-staging') < startIndex,
    'application services must start after report volume restore'
  );
});

test('restore script applies versioned migrations without data-loss db push', () => {
  const script = fs.readFileSync(new URL('../../deploy/restore-prod.sh', import.meta.url), 'utf8');

  assert.match(script, /npx prisma migrate deploy/);
  assert.doesNotMatch(script, /--accept-data-loss/);
  assert.doesNotMatch(script, /npx prisma db push/);
});

test('staging sync sanitizes production credentials and tokens before starting services', () => {
  const script = fs.readFileSync(new URL('../../deploy/sync-staging.sh', import.meta.url), 'utf8');
  const migrationIndex = script.indexOf('npx prisma migrate deploy');
  const sanitizeIndex = script.lastIndexOf('sanitize_staging_database');
  const startIndex = script.indexOf('docker compose -f "$STAGING_COMPOSE_FILE" up -d --force-recreate backend worker nginx');

  assert.match(script, /STAGING_ADMIN_PASSWORD/);
  assert.match(script, /RESTORE_REPORTS="\$\{RESTORE_REPORTS:-false\}"/);
  assert.match(script, /create_staging_mock_report_files/);
  assert.match(script, /report-source\.pdf/);
  assert.match(script, /romaneio\.docx/);
  assert.match(script, /DELETE FROM "UserSession"/);
  assert.match(script, /DELETE FROM "PasswordResetToken"/);
  assert.match(script, /DELETE FROM "EmailChangeToken"/);
  assert.match(script, /DELETE FROM "NotificationPreferenceToken"/);
  assert.match(script, /"username" = 'staging-user-' \|\| "id"/);
  assert.match(script, /UPDATE "Collaborator"\s+SET\s+"name" = 'Colaborador Staging '/);
  assert.match(script, /UPDATE "Project"\s+SET\s+"clientName" = 'Cliente Staging'/);
  assert.match(script, /UPDATE "User"[\s\S]*"passwordHash" = 'staging-disabled'/);
  assert.match(script, /UPDATE "ReportVersion"[\s\S]*'\/relatorios\/_staging_mock\/report-source\.pdf'/);
  assert.match(script, /staging_mock_file_hash report-source\.pdf/);
  assert.match(script, /"sourceDocumentHash" = '\$staging_source_hash_sql'/);
  assert.match(script, /"finalDocumentHash"[\s\S]*'\$staging_final_hash_sql'/);
  assert.match(script, /UPDATE "ReportAttachment"[\s\S]*'_staging_mock\/attachment\.txt'/);
  assert.match(script, /UPDATE "Romaneio"[\s\S]*'\/relatorios\/_staging_mock\/romaneio\.docx'/);
  assert.match(script, /UPDATE "CalibrationCertificate"[\s\S]*'_staging_mock\/certificate\.pdf'/);
  assert.match(script, /UPDATE "ReportSignature"[\s\S]*"tokenHash" = NULL/);
  assert.match(script, /UPDATE "SatisfactionSurvey"\s+SET\s+"tokenHash" = 'staging-scrubbed-'/);
  assert.match(script, /UPDATE "DataSubjectRequest"\s+SET\s+"name" = 'Titular Staging '/);
  assert.ok(migrationIndex !== -1, 'staging sync must run migrations before scrub');
  assert.ok(sanitizeIndex !== -1, 'staging sync must scrub restored production data');
  assert.ok(startIndex !== -1, 'staging sync must restart app services explicitly');
  assert.ok(
    migrationIndex < sanitizeIndex && sanitizeIndex < startIndex,
    'staging app services must start only after migrations and production-token scrub'
  );
});

test('staging sync aborts before migrations or service start when dump restore fails', () => {
  const { result, dockerCalls } = runSyncWithFakeDocker({ failRestore: true });

  assert.notEqual(result.status, 0);
  assert.match(dockerCalls, /psql -v ON_ERROR_STOP=1/);
  assert.match(dockerCalls, /-d filtrovali_restore_/);
  assert.doesNotMatch(dockerCalls, /npx prisma migrate deploy/);
  assert.doesNotMatch(dockerCalls, /up -d --force-recreate/);
  assert.doesNotMatch(dockerCalls, /relatorios\.tar\.gz -C \/to/);
});

test('running staging stops all writers before restore and rebuilds/restarts the worker after scrub', () => {
  const { result, dockerCalls } = runSyncWithFakeDocker({
    stagingWasUp: true,
    env: { BUILD_SERVICES: 'true' }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = dockerCalls.split('\n');
  const stop = calls.findIndex(call => call.endsWith('stop backend worker nginx'));
  const restore = calls.findIndex(call => call.includes('CREATE DATABASE'));
  const build = calls.findIndex(call => call.endsWith('build backend worker nginx'));
  const migration = calls.findIndex(call => call.includes('npx prisma migrate deploy'));
  const scrub = calls.indexOf('TEST: staging scrub');
  const start = calls.findIndex(call => call.endsWith('up -d --force-recreate backend worker nginx'));
  assert.ok(stop >= 0 && stop < restore, 'API and worker must stop before the first database mutation');
  assert.ok(restore < build && build < migration && migration < scrub && scrub < start,
    'all images must be rebuilt, migrated and scrubbed before any writer restarts');
});

for (const failure of ['failStop', 'failRestore', 'failMigration', 'failSanitize']) {
  test(`running staging never restarts API/worker when ${failure} occurs`, () => {
    const { result, dockerCalls } = runSyncWithFakeDocker({ stagingWasUp: true, [failure]: true });
    assert.notEqual(result.status, 0);
    assert.match(dockerCalls, /stop backend worker nginx/);
    assert.doesNotMatch(dockerCalls, /up -d --force-recreate/);
    if (failure === 'failStop') assert.doesNotMatch(dockerCalls, /CREATE DATABASE/);
  });
}

test('offline staging stays offline after a successful sync without starting the worker', () => {
  const { result, dockerCalls } = runSyncWithFakeDocker();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(dockerCalls, /up -d postgres/);
  assert.match(dockerCalls, /TEST: staging scrub/);
  assert.match(dockerCalls, /compose -f docker-compose.staging.yml down/);
  assert.doesNotMatch(dockerCalls, /up -d --force-recreate/);
});

test('staging sync uses the resolved backup directory and never extracts production report files', () => {
  const script = fs.readFileSync(new URL('../../deploy/sync-staging.sh', import.meta.url), 'utf8');
  const { result, dockerCalls, restoreSql } = runSyncWithFakeDocker({
    switchLatestOnPostgresUp: true,
    snapshotASql: 'SELECT 10 AS snapshot_a;',
    snapshotBSql: 'SELECT 20 AS snapshot_b;'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(script, /\$LATEST_BACKUP\/postgres\.sql\.gz/);
  assert.doesNotMatch(script, /\$LATEST_BACKUP\/relatorios\.tar\.gz/);
  assert.doesNotMatch(script, /tar -xzf \/backup\/relatorios\.tar\.gz/);
  assert.match(restoreSql, /snapshot_a/);
  assert.doesNotMatch(restoreSql, /snapshot_b/);
  assert.match(dockerCalls, /run --rm --no-deps backend node --input-type=module/);
  assert.doesNotMatch(dockerCalls, /relatorios\.tar\.gz/);
});

test('production docs provide concurrent index preflight before prisma migrations', () => {
  const docs = fs.readFileSync(new URL('../../deploy/PRODUCTION.md', import.meta.url), 'utf8');
  const concurrentSql = fs.readFileSync(
    new URL('../../deploy/create-performance-indexes-concurrently.sql', import.meta.url),
    'utf8'
  );
  const postgresStartIndex = docs.indexOf('up -d postgres');
  const preflightIndex = docs.indexOf('create-performance-indexes-concurrently.sql');
  const migrationIndex = docs.indexOf('npx prisma migrate deploy');
  const backendStartIndex = docs.indexOf('up -d backend nginx');

  assert.match(concurrentSql, /CREATE INDEX CONCURRENTLY IF NOT EXISTS "Report_active_date_created_idx"/);
  assert.match(concurrentSql, /CREATE INDEX CONCURRENTLY IF NOT EXISTS "Report_active_project_date_created_idx"/);
  assert.match(concurrentSql, /CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReportAttachment_reportId_idx"/);
  assert.match(docs, /build backend nginx/);
  assert.match(docs, /`CREATE INDEX CONCURRENTLY` não pode rodar dentro de transação/);
  assert.doesNotMatch(docs, /prisma db seed/);
  assert.ok(postgresStartIndex !== -1, 'production docs must start postgres before index preflight');
  assert.ok(preflightIndex !== -1, 'production docs must mention concurrent index preflight');
  assert.ok(migrationIndex !== -1, 'production docs must still apply Prisma migrations');
  assert.ok(backendStartIndex !== -1, 'production docs must start backend after index preflight');
  assert.ok(postgresStartIndex < preflightIndex, 'postgres must be running before concurrent index preflight');
  assert.ok(preflightIndex < migrationIndex, 'concurrent indexes must be created before Prisma migrations');
  assert.ok(preflightIndex < backendStartIndex, 'backend must start only after concurrent index preflight');
});

test('client report review keeps audit evidence when client account is deleted', () => {
  const schema = fs.readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const migration = fs.readFileSync(
    new URL('../prisma/migrations/20260601124000_preserve_client_review_user_audit/migration.sql', import.meta.url),
    'utf8'
  );

  assert.match(schema, /clientUserId String\?/);
  assert.match(schema, /clientUser\s+User\?\s+@relation\("ClientReportReviewer", fields: \[clientUserId\], references: \[id\], onDelete: SetNull\)/);
  assert.match(migration, /ALTER COLUMN "clientUserId" DROP NOT NULL/);
  assert.match(migration, /ON DELETE SET NULL ON UPDATE CASCADE/);
});
