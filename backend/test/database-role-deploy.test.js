import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

function serviceBlock(compose, name) {
  const match = compose.match(new RegExp(`\\n  ${name}:\\r?\\n([\\s\\S]*?)(?=\\n  [a-z][a-z-]*:\\r?\\n|\\nvolumes:)`));
  assert.ok(match, `service ${name} must exist`);
  return match[1];
}

for (const file of ['docker-compose.prod.yml', 'docker-compose.staging.yml']) {
  test(`${file}: migrations run in a one-shot service and the owner credential never reaches API/worker`, () => {
    const compose = read(file);
    const migrate = serviceBlock(compose, 'migrate');
    const backend = serviceBlock(compose, 'backend');
    const worker = serviceBlock(compose, 'worker');

    assert.match(migrate, /command: \["npx", "prisma", "migrate", "deploy"\]/);
    assert.match(migrate, /restart: "no"/);
    assert.match(backend, /command: \["node", "src\/server\.js"\]/);
    assert.match(backend, /migrate:\s+condition: service_completed_successfully/);
    for (const block of [backend, worker]) {
      assert.match(block, /MIGRATION_DATABASE_URL: ""/);
      // O env-file também alimenta o container do Postgres; a senha do dono
      // precisa ser zerada nos containers da aplicação.
      assert.match(block, /\n\s+POSTGRES_PASSWORD: ""/);
      assert.match(block, /\n\s+STAGING_POSTGRES_PASSWORD: ""/);
    }
  });
}

test('Prisma CLI prefers the owner URL and falls back to DATABASE_URL', () => {
  const config = read('backend/prisma.config.ts');
  assert.match(config, /process\.env\.MIGRATION_DATABASE_URL \|\| process\.env\.DATABASE_URL/);
});

test('app-role.sql grants only DML and covers future migrations', () => {
  const sql = read('deploy/db/app-role.sql');
  assert.match(sql, /NOSUPERUSER NOCREATEDB NOCREATEROLE/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES IN SCHEMA public\s+GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES IN SCHEMA public\s+GRANT USAGE, SELECT, UPDATE ON SEQUENCES/);
  assert.match(sql, /REVOKE CREATE ON SCHEMA public FROM PUBLIC/);
  assert.doesNotMatch(sql, /\bTRUNCATE\b|\bALL PRIVILEGES\b|\bREFERENCES\b|\bTRIGGER ON\b/i);
});

test('restores create the role before loading the dump and reapply grants afterwards', () => {
  for (const [file, restoreMarker] of [
    ['deploy/restore-prod.sh', 'restoring postgres database'],
    ['deploy/sync-staging.sh', 'restaurando banco temporário']
  ]) {
    const script = read(file);
    const ensureRole = script.indexOf("SELECT format('CREATE ROLE %I NOLOGIN'");
    const restore = script.indexOf(restoreMarker);
    const grants = script.indexOf('< "$APP_ROLE_SQL"');
    assert.ok(ensureRole !== -1 && ensureRole < restore, `${file}: role must exist before the dump`);
    assert.ok(grants > restore, `${file}: grants must be reapplied after the dump`);
  }
});
