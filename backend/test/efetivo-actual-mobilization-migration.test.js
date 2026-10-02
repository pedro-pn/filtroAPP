import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('migração abre ciclos automáticos, preserva encerramentos manuais e mantém o histórico concluído', async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE "ProjectWorkflow" ("projectId" TEXT PRIMARY KEY);
      CREATE TABLE "EfetivoMissionPlan" ("id" TEXT PRIMARY KEY, "projectId" TEXT, "stage" TEXT, "returnDate" DATE, "executionEndDate" DATE);
      CREATE TABLE "EfetivoMissionCycle" ("id" TEXT PRIMARY KEY, "missionId" TEXT, "mobilizationDate" DATE, "demobilizationDate" DATE, "createdAt" TIMESTAMP);
      CREATE TABLE "EfetivoMissionAllocation" ("id" TEXT PRIMARY KEY, "missionId" TEXT);
      CREATE TABLE "EfetivoAllocationCycle" ("id" TEXT PRIMARY KEY, "allocationId" TEXT, "demobilizationDate" DATE);
      CREATE TABLE "EfetivoAuditEvent" ("entityId" TEXT, "action" TEXT);
      CREATE TABLE "ProjectWorkflowEvent" ("projectId" TEXT, "action" TEXT, "data" JSONB);
      INSERT INTO "EfetivoMissionPlan" VALUES
        ('auto', 'p-auto', 'EXECUTION', NULL, '2026-10-20'),
        ('manual', 'p-manual', 'EXECUTION', NULL, '2026-10-20'),
        ('finished', 'p-finished', 'FINISHED', NULL, '2026-10-20'),
        ('effective', 'p-effective', 'EXECUTION', '2026-10-20', '2026-10-20');
      INSERT INTO "EfetivoMissionCycle" VALUES
        ('auto-first', 'auto', '2026-10-10', '2026-10-20', '2026-09-01'),
        ('auto-second', 'auto', '2026-10-22', '2026-10-25', '2026-10-22'),
        ('manual-first', 'manual', '2026-10-10', '2026-10-20', '2026-09-01'),
        ('finished-first', 'finished', '2026-10-10', '2026-10-20', '2026-09-01'),
        ('effective-first', 'effective', '2026-10-10', '2026-10-20', '2026-09-01');
      INSERT INTO "EfetivoMissionAllocation" VALUES ('auto-person', 'auto'), ('manual-person', 'auto'), ('effective-person', 'effective');
      INSERT INTO "EfetivoAllocationCycle" VALUES ('own-auto', 'auto-person', '2026-10-20'), ('own-manual', 'manual-person', '2026-10-20'), ('own-effective', 'effective-person', '2026-10-20');
      INSERT INTO "EfetivoAuditEvent" VALUES ('manual-first', 'MISSION_CYCLE_UPDATE'), ('own-manual', 'ALLOCATION_CYCLE_UPDATE');
      INSERT INTO "ProjectWorkflowEvent" VALUES ('p-effective', 'WORKFLOW_DEMOBILIZATION', '{"returnDate":"2026-10-20"}');
    `);
    const sql = await readFile(new URL('../prisma/migrations/20261002120000_confirm_actual_mobilization/migration.sql', import.meta.url), 'utf8');
    await database.exec(sql);
    const projectCycles = (await database.query('SELECT "id", "isDefault", "demobilizationDate"::text AS "end" FROM "EfetivoMissionCycle" ORDER BY "id"')).rows;
    assert.deepEqual(projectCycles, [
      { id: 'auto-first', isDefault: true, end: null },
      { id: 'auto-second', isDefault: false, end: '2026-10-25' },
      { id: 'effective-first', isDefault: true, end: '2026-10-20' },
      { id: 'finished-first', isDefault: true, end: '2026-10-20' },
      { id: 'manual-first', isDefault: true, end: '2026-10-20' }
    ]);
    assert.deepEqual((await database.query('SELECT "id", "demobilizationDate"::text AS "end" FROM "EfetivoAllocationCycle" ORDER BY "id"')).rows, [
      { id: 'own-auto', end: null }, { id: 'own-effective', end: '2026-10-20' }, { id: 'own-manual', end: '2026-10-20' }
    ]);
    await assert.rejects(database.exec(`INSERT INTO "EfetivoMissionCycle" ("id", "missionId", "isDefault") VALUES ('duplicate', 'auto', true)`), /duplicate key/);
  } finally {
    await database.close();
  }
});
