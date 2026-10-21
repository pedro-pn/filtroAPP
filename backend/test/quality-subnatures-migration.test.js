import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('quality classification reset preserves records and evidence and starts an empty hierarchical catalog', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE "QualityNature" (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE "QualityRecord" (id TEXT PRIMARY KEY, "natureId" TEXT REFERENCES "QualityNature"(id) ON DELETE RESTRICT,
        description TEXT, "deletedAt" TIMESTAMP, "updatedAt" TIMESTAMP);
      CREATE TABLE "QualityEvidence" (id TEXT PRIMARY KEY, "recordId" TEXT REFERENCES "QualityRecord"(id), "storagePath" TEXT);
      INSERT INTO "QualityNature" VALUES ('old', 'Natureza antiga'), ('unused', 'Sem uso');
      INSERT INTO "QualityRecord" VALUES ('deviation', 'old', 'Preservar desvio', NULL, '2026-01-01'),
        ('archived', 'old', 'Preservar arquivado', '2026-02-01', '2026-01-01'), ('blank', NULL, 'Sem classificação', NULL, '2026-01-01');
      INSERT INTO "QualityEvidence" VALUES ('attachment', 'deviation', 'keep/attachment.pdf');
    `);
    await db.exec(await readFile(new URL('../prisma/migrations/20261021150000_quality_subnatures/migration.sql', import.meta.url), 'utf8'));
    assert.equal((await db.query('SELECT * FROM "QualityNature"')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM "QualitySubnature"')).rows.length, 0);
    const records = (await db.query('SELECT * FROM "QualityRecord" ORDER BY id')).rows;
    assert.equal(records.length, 3);
    assert.ok(records.every(row => row.natureId === null && row.subnatureId === null));
    assert.equal(records.find(row => row.id === 'archived').description, 'Preservar arquivado');
    assert.ok(records.find(row => row.id === 'archived').deletedAt);
    assert.equal((await db.query('SELECT "storagePath" FROM "QualityEvidence"')).rows[0].storagePath, 'keep/attachment.pdf');
    await db.exec(`
      INSERT INTO "QualityNature" VALUES ('new', 'Comercial e Proposta');
      INSERT INTO "QualitySubnature" (id, "natureId", name, "updatedAt") VALUES ('detail', 'new', 'Custo não previsto no orçamento', now());
      UPDATE "QualityRecord" SET "natureId" = 'new', "subnatureId" = 'detail' WHERE id = 'deviation';
    `);
    await assert.rejects(db.exec(`DELETE FROM "QualitySubnature" WHERE id = 'detail'`), error => ['23503', '23001'].includes(error.code));
    assert.equal((await db.query('SELECT "subnatureId" FROM "QualityRecord" WHERE id = $1', ['deviation'])).rows[0].subnatureId, 'detail');
  } finally {
    await db.close();
  }
});
