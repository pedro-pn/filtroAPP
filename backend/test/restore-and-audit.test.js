import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function runRestoreWithFakeDocker(env = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-preflight-'));
  const backup = path.join(root, 'backup');
  const bin = path.join(root, 'bin');
  const dockerLog = path.join(root, 'docker.log');
  fs.mkdirSync(backup);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(backup, 'postgres.sql.gz'), '');
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash\necho "$@" >> "${dockerLog}"\nexit 97\n`);
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
      < script.indexOf('tar -xzf /backup/relatorios.tar.gz -C /to/.restore-staging'),
    'public services must stop before report volume staging'
  );
});

test('restore script stages reports before replacing active volume contents', () => {
  const script = fs.readFileSync(new URL('../../deploy/restore-prod.sh', import.meta.url), 'utf8');
  const extractIndex = script.indexOf('tar -xzf /backup/relatorios.tar.gz -C /to/.restore-staging');
  const removeIndex = script.indexOf('find /to -mindepth 1 -maxdepth 1 ! -name .restore-staging -exec rm -rf {} +');

  assert.match(script, /mkdir \/to\/\.restore-staging/);
  assert.ok(extractIndex !== -1, 'reports backup must extract into staging');
  assert.ok(removeIndex !== -1, 'active reports volume contents must be replaced after staging');
  assert.ok(
    extractIndex < removeIndex,
    'reports backup must be fully extracted before active volume contents are removed'
  );
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
