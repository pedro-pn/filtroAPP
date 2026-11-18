import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  GRANDFATHERED_THROUGH,
  MIGRATIONS_DIR,
  checkMigration,
  classifyMigration,
  repositoryMigrations
} from '../scripts/migration-safety.js';

const rulesOf = sql => classifyMigration(sql).contract.map(item => item.rule);

test('expand migrations (what the previous code tolerates) pass without a header', () => {
  for (const sql of [
    'CREATE TABLE "Thing" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, CONSTRAINT "Thing_pkey" PRIMARY KEY ("id"));',
    'ALTER TABLE "Report" ADD COLUMN "note" TEXT;',
    'ALTER TABLE "Report" ADD COLUMN "count" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "label" TEXT;',
    'ALTER TABLE "Report" ALTER COLUMN "note" DROP NOT NULL;',
    'ALTER TABLE "Report" DROP CONSTRAINT "Report_projectId_fkey";',
    'CREATE INDEX "Report_status_idx" ON "Report"("status");',
    'DROP INDEX "Report_old_idx";',
    'ALTER INDEX "a_idx" RENAME TO "b_idx";',
    'ALTER TABLE "Report" RENAME CONSTRAINT "Report_pkey" TO "Rdo_pkey";',
    'ALTER TYPE "ReportType" ADD VALUE \'RLI\';',
    'UPDATE "Report" SET "note" = \'x\' WHERE "note" IS NULL;',
    'DELETE FROM "Report" WHERE "id" = \'1\';',
    'ALTER TABLE "Job" ALTER COLUMN "type" SET DEFAULT \'A\';',
    'ALTER TABLE "Job" ALTER COLUMN "updatedAt" DROP DEFAULT;',
    '-- DROP TABLE "Report"; só um comentário\nSELECT 1;',
    'INSERT INTO "Audit" ("text") VALUES (\'DROP TABLE "Report"\');',
    'CREATE OR REPLACE FUNCTION f() RETURNS trigger AS $$ BEGIN DELETE FROM "X"; RETURN NEW; END; $$ LANGUAGE plpgsql;',
    'DROP VIEW IF EXISTS "v"; CREATE VIEW "v" AS SELECT 1;'
  ]) {
    assert.deepEqual(rulesOf(sql), [], sql);
  }
});

test('contract operations are detected', () => {
  for (const [sql, rule] of [
    ['DROP TABLE "Report";', 'drop-table'],
    ['ALTER TABLE "Report" DROP COLUMN "note";', 'drop-column'],
    ['ALTER TABLE "Unit" DROP COLUMN IF EXISTS "isActive";', 'drop-column'],
    ['ALTER TABLE "A" RENAME TO "B";', 'rename-table'],
    ['ALTER TABLE "A" RENAME COLUMN "x" TO "y";', 'rename-column'],
    ['ALTER TABLE "A" ALTER COLUMN "x" TYPE BIGINT;', 'alter-type'],
    ['ALTER TABLE "A" ALTER COLUMN "x" SET DATA TYPE TEXT;', 'alter-type'],
    ['ALTER TABLE "A" ALTER COLUMN "x" SET NOT NULL;', 'set-not-null'],
    ['ALTER TABLE "A" ALTER COLUMN "x" DROP DEFAULT;', 'drop-default'],
    ['ALTER TABLE "A" ADD COLUMN "x" TEXT NOT NULL;', 'add-required-column'],
    ['ALTER TABLE "A" ADD COLUMN "ok" TEXT, ADD COLUMN "x" TIMESTAMP(3) NOT NULL;', 'add-required-column'],
    ['TRUNCATE "A";', 'truncate'],
    ['DELETE FROM "QualityNature";', 'delete-all'],
    ['DROP TYPE "Status_old";', 'drop-type'],
    ['ALTER TYPE "Status" RENAME TO "Status_old";', 'rename-type'],
    ['ALTER TYPE "Status" RENAME VALUE \'A\' TO \'B\';', 'rename-type'],
    ['DROP VIEW "v";', 'drop-view'],
    ['DROP SEQUENCE "s";', 'drop-schema']
  ]) {
    assert.ok(rulesOf(sql).includes(rule), `${sql} → ${rulesOf(sql).join(',') || 'nada'}`);
  }
  // Uma coluna chamada "type" não vira ALTER COLUMN ... TYPE.
  assert.deepEqual(rulesOf('ALTER TABLE "A" ALTER COLUMN "type" SET DEFAULT \'x\';'), []);
});

test('a contract migration needs the header with a reason', () => {
  const sql = 'ALTER TABLE "A" DROP COLUMN "legacy";';
  assert.equal(checkMigration('m', sql).problems.length, 1);
  assert.equal(checkMigration('m', `-- migration-safety: contract\n${sql}`).problems.length, 1, 'header without reason');
  assert.equal(checkMigration('m', `-- migration-safety: contract — curto\n${sql}`).problems.length, 1, 'reason too short');
  const ok = checkMigration('m', `-- migration-safety: contract — coluna legacy sem uso desde o deploy de 2026-11-20\n${sql}`);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.declaredContract, true);
  assert.match(ok.reason, /sem uso desde/);
});

test('unique indexes and new CHECK constraints are reported as warnings only', () => {
  const result = classifyMigration('CREATE UNIQUE INDEX "a_key" ON "A"("x"); ALTER TABLE "A" ADD CONSTRAINT "c" CHECK ("x" > 0);');
  assert.deepEqual(result.contract, []);
  assert.deepEqual(result.warnings.map(item => item.rule), ['unique-index', 'add-constraint']);
});

test('history up to the cutoff is grandfathered; newer repository migrations follow the rule', () => {
  const names = fs.readdirSync(MIGRATIONS_DIR).filter(name => fs.existsSync(path.join(MIGRATIONS_DIR, name, 'migration.sql')));
  assert.ok(names.includes(GRANDFATHERED_THROUGH), 'the cutoff must be a real migration');
  const problems = repositoryMigrations()
    .flatMap(({ name, file }) => checkMigration(name, fs.readFileSync(file, 'utf8')).problems);
  assert.deepEqual(problems, [], `migrations contract sem cabeçalho:\n${problems.join('\n')}\nVeja docs/PADRAO_MODULO.md, "Migrations (expand/contract)".`);
});

test('repositoryMigrations skips everything up to the cutoff', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-safety-'));
  try {
    for (const name of ['20260101000000_old', '20260201000000_cut', '20260301000000_new']) {
      fs.mkdirSync(path.join(dir, name));
      fs.writeFileSync(path.join(dir, name, 'migration.sql'), 'SELECT 1;');
    }
    fs.writeFileSync(path.join(dir, 'migration_lock.toml'), '');
    assert.deepEqual(repositoryMigrations(dir, { through: '20260201000000_cut' }).map(item => item.name), ['20260301000000_new']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
