import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('restore script validates checksums before mutating restored services', () => {
  const script = fs.readFileSync(new URL('../../deploy/restore-prod.sh', import.meta.url), 'utf8');

  assert.match(script, /sha256sum -c SHA256SUMS/);
  assert.ok(
    script.indexOf('sha256sum -c SHA256SUMS') < script.indexOf('docker compose -f "$COMPOSE_FILE" up -d --no-recreate'),
    'backup checksums must be validated before starting restore mutations'
  );
});

test('restore script clears reports volume before extracting backup archive', () => {
  const script = fs.readFileSync(new URL('../../deploy/restore-prod.sh', import.meta.url), 'utf8');

  assert.match(script, /find \/to -mindepth 1 -maxdepth 1 -exec rm -rf \{\} \+/);
  assert.ok(
    script.indexOf('find /to -mindepth 1 -maxdepth 1 -exec rm -rf {} +') < script.indexOf('tar -xzf /backup/relatorios.tar.gz'),
    'reports volume must be cleaned before backup extraction'
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
