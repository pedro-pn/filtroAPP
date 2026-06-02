import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function runRestoreWithFakeDocker(env = {}, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-preflight-'));
  const backup = path.join(root, 'backup');
  const bin = path.join(root, 'bin');
  const dockerLog = path.join(root, 'docker.log');
  fs.mkdirSync(backup);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(backup, 'postgres.sql.gz'), '');
  if (options.reportsArchive) fs.writeFileSync(path.join(backup, 'relatorios.tar.gz'), '');
  if (options.certsArchive) fs.writeFileSync(path.join(backup, 'certs.tar.gz'), '');
  const dockerScript = options.dockerScript || `#!/usr/bin/env bash\necho "$@" >> "${dockerLog}"\nexit 97\n`;
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
      ...env
    },
    encoding: 'utf8'
  });

  const dockerCalls = fs.existsSync(dockerLog) ? fs.readFileSync(dockerLog, 'utf8') : '';
  fs.rmSync(root, { recursive: true, force: true });
  return { result, dockerCalls };
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
