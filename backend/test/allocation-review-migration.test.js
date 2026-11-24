import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = new URL('../prisma/migrations/20261103210000_allocation_review/migration.sql', import.meta.url);

async function prepare(db) {
  // Estruturas mínimas que a migration referencia e que vêm de migrations anteriores.
  await db.exec(`
    CREATE TYPE "ModuleRoleCode" AS ENUM ('EFETIVO_MANAGER', 'EFETIVO_QSMS');
    CREATE TYPE "CollaboratorAbsenceType" AS ENUM ('FERIAS', 'FOLGA', 'AFASTAMENTO', 'FADIGA_OFFSHORE', 'ASO', 'TREINAMENTO');
    CREATE TABLE "Collaborator" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "Project" ("id" TEXT PRIMARY KEY);
    INSERT INTO "Collaborator" ("id") VALUES ('col-1');
    INSERT INTO "Project" ("id") VALUES ('prj-1');
  `);
  await db.exec(await readFile(MIGRATION, 'utf8'));
}

test('allocation review migration creates tables, enum value and uniqueness rules', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await prepare(db);

  const { rows: roles } = await db.query(`SELECT unnest(enum_range(NULL::"ModuleRoleCode"))::text AS value`);
  assert.ok(roles.some(row => row.value === 'EFETIVO_ALLOCATION_REVIEW'));

  await db.exec(`
    INSERT INTO "AllocationReviewWeek" ("id", "weekStart", "updatedAt") VALUES ('w1', '2026-10-26', CURRENT_TIMESTAMP);
    INSERT INTO "AllocationReviewRow" ("id", "weekId", "collaboratorId", "updatedAt") VALUES ('r1', 'w1', 'col-1', CURRENT_TIMESTAMP);
    INSERT INTO "AllocationReviewDay" ("id", "rowId", "collaboratorId", "workDate", "kind", "updatedAt")
      VALUES ('d1', 'r1', 'col-1', '2026-10-27', 'PROJECT', CURRENT_TIMESTAMP);
    INSERT INTO "AllocationReviewDayProject" ("dayId", "projectId") VALUES ('d1', 'prj-1');
  `);

  await assert.rejects(
    db.exec(`INSERT INTO "AllocationReviewRow" ("id", "weekId", "collaboratorId", "updatedAt") VALUES ('r2', 'w1', 'col-1', CURRENT_TIMESTAMP)`),
    /duplicate key|unique/i
  );
  await assert.rejects(
    db.exec(`INSERT INTO "AllocationReviewDay" ("id", "rowId", "collaboratorId", "workDate", "kind", "updatedAt")
      VALUES ('d2', 'r1', 'col-1', '2026-10-27', 'SEDE', CURRENT_TIMESTAMP)`),
    /duplicate key|unique/i
  );
  // Projeto com dia conferido não pode ser apagado (Restrict); apagar a semana leva tudo junto.
  await assert.rejects(db.exec(`DELETE FROM "Project" WHERE "id" = 'prj-1'`), /foreign key|violates/i);
  await db.exec(`DELETE FROM "AllocationReviewWeek" WHERE "id" = 'w1'`);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM "AllocationReviewDay"`);
  assert.equal(rows[0].n, 0);
});

test('allocation review migration is safe to re-run the enum value step', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await prepare(db);
  await db.exec(`ALTER TYPE "ModuleRoleCode" ADD VALUE IF NOT EXISTS 'EFETIVO_ALLOCATION_REVIEW';`);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM unnest(enum_range(NULL::"ModuleRoleCode")) v WHERE v::text = 'EFETIVO_ALLOCATION_REVIEW'`);
  assert.equal(rows[0].n, 1);
});

test('migração acrescenta Falta sem alterar dias existentes e permite reexecução', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await prepare(db);
  await db.exec(`
    INSERT INTO "AllocationReviewWeek" ("id", "weekStart", "updatedAt") VALUES ('w1', '2026-10-26', CURRENT_TIMESTAMP);
    INSERT INTO "AllocationReviewRow" ("id", "weekId", "collaboratorId", "updatedAt") VALUES ('r1', 'w1', 'col-1', CURRENT_TIMESTAMP);
    INSERT INTO "AllocationReviewDay" ("id", "rowId", "collaboratorId", "workDate", "kind", "updatedAt")
      VALUES ('d1', 'r1', 'col-1', '2026-10-26', 'SEDE', CURRENT_TIMESTAMP);
  `);
  const migration = await readFile(new URL('../prisma/migrations/20261124160000_allocation_review_falta/migration.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  assert.equal((await db.query('SELECT "kind" FROM "AllocationReviewDay" WHERE "id" = $1', ['d1'])).rows[0].kind, 'SEDE');
  await db.exec(`UPDATE "AllocationReviewDay" SET "kind" = 'FALTA' WHERE "id" = 'd1';`);
  assert.equal((await db.query('SELECT "kind" FROM "AllocationReviewDay" WHERE "id" = $1', ['d1'])).rows[0].kind, 'FALTA');
});
