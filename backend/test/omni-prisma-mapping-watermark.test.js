import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('production Prisma mapping changes advance the project incremental watermark transactionally', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE "Project" (id TEXT PRIMARY KEY, "updatedAt" TIMESTAMP(3) NOT NULL);
      CREATE TABLE "CrmProjectMapping" (
        id TEXT PRIMARY KEY, "sourceSystem" TEXT, "tenantId" TEXT, environment TEXT,
        "projectId" TEXT REFERENCES "Project"(id), "prismaMissionId" TEXT, number TEXT, "numberScope" TEXT
      );
      INSERT INTO "Project" VALUES ('p1', '2026-01-01'), ('p2', '2026-01-01');
    `);
    await db.exec(await readFile(new URL('../prisma/migrations/20261104120000_omni_prisma_mapping_watermark/migration.sql', import.meta.url), 'utf8'));
    const stamps = async () => (await db.query('SELECT id, "updatedAt" FROM "Project" ORDER BY id')).rows.map(row => +new Date(row.updatedAt));
    const initial = await stamps();
    await db.exec(`INSERT INTO "CrmProjectMapping" VALUES ('m', 'prismaCRM', 'filtrovali', 'sandbox', 'p1', 'mission', '05776', 'fentecx')`);
    assert.deepEqual(await stamps(), initial, 'sandbox mappings stay private');
    await db.exec(`UPDATE "CrmProjectMapping" SET environment = 'production' WHERE id = 'm'`);
    const inserted = await stamps();
    assert.ok(inserted[0] > initial[0]);
    assert.equal(inserted[1], initial[1]);
    for (const update of [
      `number = '05777'`, `"numberScope" = 'filtrovali'`, `"prismaMissionId" = 'other-mission'`, `"tenantId" = 'other-tenant'`
    ]) {
      const before = await stamps();
      await db.exec(`UPDATE "CrmProjectMapping" SET ${update} WHERE id = 'm'`);
      const after = await stamps();
      assert.ok(after[0] > before[0], update);
      assert.equal(after[1], before[1]);
    }
    const beforeNoop = await stamps();
    await db.exec(`UPDATE "CrmProjectMapping" SET number = number WHERE id = 'm'`);
    assert.deepEqual(await stamps(), beforeNoop, 'idempotent replays do not churn the watermark');
    await db.exec(`UPDATE "CrmProjectMapping" SET "projectId" = 'p2' WHERE id = 'm'`);
    const moved = await stamps();
    assert.ok(moved[0] > beforeNoop[0], 'old project must emit a null mapping');
    assert.ok(moved[1] > beforeNoop[1], 'new project must emit its mapping');
    await db.exec(`BEGIN; DELETE FROM "CrmProjectMapping" WHERE id = 'm'; ROLLBACK;`);
    assert.deepEqual(await stamps(), moved, 'mapping and watermark roll back together');
    await db.exec(`UPDATE "CrmProjectMapping" SET environment = 'sandbox' WHERE id = 'm'`);
    const hidden = await stamps();
    assert.ok(hidden[1] > moved[1], 'moving out of production must be detected');
    await db.exec(`DELETE FROM "CrmProjectMapping" WHERE id = 'm'`);
    assert.deepEqual(await stamps(), hidden);
    await db.exec(`INSERT INTO "CrmProjectMapping" VALUES ('new', 'prismaCRM', 'filtrovali', 'production', 'p1', 'mission', NULL, NULL)`);
    const recreated = await stamps();
    assert.ok(recreated[0] > hidden[0], 'direct production insert is detected');
    await db.exec(`DELETE FROM "CrmProjectMapping" WHERE id = 'new'`);
    assert.ok((await stamps())[0] > recreated[0], 'production unlink is detected');
    await db.exec(`INSERT INTO "CrmProjectMapping" VALUES ('foreign', 'other-system', 'filtrovali', 'production', 'p1', 'mission', NULL, NULL)`);
    const foreign = await stamps();
    await db.exec(`UPDATE "CrmProjectMapping" SET number = '123' WHERE id = 'foreign'`);
    assert.deepEqual(await stamps(), foreign, 'other source systems are not published');
  } finally {
    await db.close();
  }
});
