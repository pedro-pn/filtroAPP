import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

import { buildAvailabilityPeriod } from '../src/lib/efetivo/planning/availability-period.js';

const migration = new URL('../prisma/migrations/20261027210000_repair_forecast_demobilizations/migration.sql', import.meta.url);

async function fixture() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE "EfetivoPlan" ("id" TEXT PRIMARY KEY, "kind" TEXT DEFAULT 'OFFICIAL', "status" TEXT DEFAULT 'ACTIVE', "revision" INTEGER DEFAULT 1, "updatedAt" TIMESTAMP);
    CREATE TABLE "Project" ("id" TEXT PRIMARY KEY, "demobilizationDate" TIMESTAMP DEFAULT '2026-10-22 03:00:00', "isActive" BOOLEAN DEFAULT TRUE, "deletedAt" TIMESTAMP, "updatedAt" TIMESTAMP);
    CREATE TABLE "EfetivoMissionPlan" (
      "id" TEXT PRIMARY KEY, "planId" TEXT, "projectId" TEXT, "stage" TEXT DEFAULT 'EXECUTION',
      "returnDate" DATE DEFAULT '2026-10-22', "executionEndDate" DATE DEFAULT '2026-10-21',
      "scheduleStatus" TEXT DEFAULT 'CONFIRMED', "deletedAt" TIMESTAMP, "version" INTEGER DEFAULT 1, "updatedAt" TIMESTAMP
    );
    CREATE TABLE "EfetivoMissionCycle" (
      "id" TEXT PRIMARY KEY, "missionId" TEXT, "isDefault" BOOLEAN DEFAULT TRUE,
      "mobilizationDate" DATE DEFAULT '2026-10-04', "demobilizationDate" DATE DEFAULT '2026-10-22',
      "createdAt" TIMESTAMP DEFAULT '2026-09-21', "updatedAt" TIMESTAMP
    );
    CREATE TABLE "EfetivoMissionAllocation" ("id" TEXT PRIMARY KEY, "missionId" TEXT, "demobilizationDate" DATE, "deletedAt" TIMESTAMP);
    CREATE TABLE "EfetivoAllocationCycle" (
      "id" TEXT PRIMARY KEY, "allocationId" TEXT, "mobilizationDate" DATE DEFAULT '2026-10-04',
      "demobilizationDate" DATE DEFAULT '2026-10-22', "createdAt" TIMESTAMP DEFAULT '2026-09-21', "updatedAt" TIMESTAMP
    );
    CREATE TABLE "EfetivoAuditEvent" (
      "id" TEXT PRIMARY KEY, "planId" TEXT, "action" TEXT, "entityType" TEXT, "entityId" TEXT,
      "summary" TEXT, "beforeData" JSONB, "afterData" JSONB, "createdAt" TIMESTAMP
    );
    CREATE TABLE "ProjectWorkflowEvent" ("projectId" TEXT, "action" TEXT, "data" JSONB);
    INSERT INTO "EfetivoPlan" ("id") VALUES ('official');
    INSERT INTO "EfetivoPlan" ("id", "kind", "status") VALUES ('scenario', 'SCENARIO', 'DRAFT');
  `);
  return database;
}

async function addMission(database, id, planId = 'official') {
  await database.query('INSERT INTO "Project" ("id") VALUES ($1)', [id]);
  await database.query('INSERT INTO "EfetivoMissionPlan" ("id", "projectId", "planId") VALUES ($1, $1, $2)', [id, planId]);
  await database.query('INSERT INTO "EfetivoMissionCycle" ("id", "missionId") VALUES ($1, $1)', [id]);
}

async function snapshot(database) {
  return {
    plans: (await database.query('SELECT * FROM "EfetivoPlan" ORDER BY "id"')).rows,
    projects: (await database.query('SELECT * FROM "Project" ORDER BY "id"')).rows,
    missions: (await database.query('SELECT * FROM "EfetivoMissionPlan" ORDER BY "id"')).rows,
    cycles: (await database.query('SELECT * FROM "EfetivoMissionCycle" ORDER BY "id"')).rows,
    individual: (await database.query('SELECT * FROM "EfetivoAllocationCycle" ORDER BY "id"')).rows,
    audits: (await database.query('SELECT * FROM "EfetivoAuditEvent" ORDER BY "id"')).rows
  };
}

test('previsão antiga da Klabin não encerra José nem troca o projeto atual pela próxima programação', async () => {
  const database = await fixture();
  try {
    await addMission(database, 'klabin');
    await database.exec(`
      INSERT INTO "EfetivoMissionAllocation" ("id", "missionId") VALUES ('inherited', 'klabin'), ('manual', 'klabin');
      INSERT INTO "EfetivoAllocationCycle" ("id", "allocationId") VALUES ('copied-end', 'inherited'), ('manual-end', 'manual');
      INSERT INTO "EfetivoAuditEvent" ("id", "entityId", "action") VALUES ('manual-edit', 'manual-end', 'ALLOCATION_CYCLE_UPDATE');
    `);
    const sql = await readFile(migration, 'utf8');
    await database.exec(sql);
    const state = await snapshot(database);
    assert.equal(state.cycles[0].demobilizationDate, null);
    assert.equal(state.missions[0].returnDate, null);
    assert.equal(state.projects[0].demobilizationDate, null);
    assert.equal(state.missions[0].executionEndDate.toISOString().slice(0, 10), '2026-10-21');
    assert.equal(state.missions[0].version, 2);
    assert.equal(state.plans.find(plan => plan.id === 'official').revision, 2);
    assert.equal(state.individual.find(cycle => cycle.id === 'copied-end').demobilizationDate, null);
    assert.equal(state.individual.find(cycle => cycle.id === 'manual-end').demobilizationDate.toISOString().slice(0, 10), '2026-10-22');
    assert.equal(state.audits.filter(event => event.action?.endsWith('_FORECAST_DEMOBILIZATION_REPAIR')).length, 2);

    const projection = {
      jobRoles: [{ id: 'role', name: 'Operador', isActive: true, isOperational: true }],
      collaborators: [{ id: 'jose', name: 'José', jobRoleId: 'role', isActive: true }],
      missions: [{
        id: 'future', projectId: 'mid', stage: 'STANDBY', scheduleStatus: 'CONFIRMED',
        project: { code: '5844', name: 'MID' },
        mobilizationDate: '2026-11-15', executionEndDate: '2026-11-23',
        cycles: [{ mobilizationDate: '2026-11-15', demobilizationDate: null }],
        allocations: [{ collaboratorId: 'jose' }]
      }, {
        ...state.missions[0],
        project: { code: '5839', name: 'Klabin' },
        mobilizationDate: '2026-10-04', cycles: state.cycles,
        allocations: [{ collaboratorId: 'jose' }]
      }]
    };
    const result = buildAvailabilityPeriod({ startDate: '2026-10-27', endDate: '2026-11-24', projection });
    assert.ok(result.people[0].days.every(day => day.status === 'MOBILIZED' && day.detail === '5839 · Klabin'));

    await database.exec(sql);
    assert.deepEqual(await snapshot(database), state, 'reexecutar não altera datas, auditoria ou revisões');
  } finally {
    await database.close();
  }
});

test('reparo preserva saídas explícitas, remobilizações, históricos e cenários', async () => {
  const database = await fixture();
  try {
    const protectedIds = ['cycle-edit', 'workflow', 'workflow-legacy', 'mission-edit', 'actual-return', 'history', 'finished', 'cancelled', 'deleted', 'archived-project', 'deleted-project', 'remobilization'];
    for (const id of protectedIds) await addMission(database, id);
    await addMission(database, 'scenario-mission', 'scenario');
    await database.exec(`
      INSERT INTO "EfetivoAuditEvent" ("id", "entityId", "action") VALUES ('cycle-edit', 'cycle-edit', 'MISSION_CYCLE_UPDATE');
      INSERT INTO "ProjectWorkflowEvent" VALUES ('workflow', 'WORKFLOW_DEMOBILIZATION', '{"returnDate":"2026-10-22"}');
      INSERT INTO "ProjectWorkflowEvent" VALUES ('workflow-legacy', 'WORKFLOW_DEMOBILIZATION', '{"demobilizationDate":"2026-10-22"}');
      INSERT INTO "EfetivoAuditEvent" ("id", "entityId", "action", "beforeData", "afterData")
        VALUES ('mission-edit', 'mission-edit', 'MISSION_UPDATE', '{"returnDate":null}', '{"stage":"EXECUTION","returnDate":"2026-10-22"}');
      INSERT INTO "EfetivoAuditEvent" ("id", "entityId", "action", "afterData")
        VALUES ('actual-return', 'actual-return', 'MISSION_DEMOBILIZATION_UPDATE', '{"returnDate":"2026-10-22"}');
      UPDATE "EfetivoMissionCycle" SET "createdAt" = '2026-10-23' WHERE "id" = 'history';
      UPDATE "EfetivoMissionPlan" SET "stage" = 'FINISHED' WHERE "id" = 'finished';
      UPDATE "EfetivoMissionPlan" SET "scheduleStatus" = 'CANCELLED' WHERE "id" = 'cancelled';
      UPDATE "EfetivoMissionPlan" SET "deletedAt" = '2026-10-23' WHERE "id" = 'deleted';
      UPDATE "Project" SET "isActive" = FALSE WHERE "id" = 'archived-project';
      UPDATE "Project" SET "deletedAt" = '2026-10-23' WHERE "id" = 'deleted-project';
      INSERT INTO "EfetivoMissionCycle" ("id", "missionId", "isDefault", "mobilizationDate", "demobilizationDate")
        VALUES ('remobilization-second', 'remobilization', FALSE, '2026-10-24', NULL);
    `);
    const before = await snapshot(database);
    await database.exec(await readFile(migration, 'utf8'));
    assert.deepEqual(await snapshot(database), before);
  } finally {
    await database.close();
  }
});

test('retorno previsto vazio também é recuperado sem apagar data distinta do projeto ou saída individual explícita', async () => {
  const database = await fixture();
  try {
    await addMission(database, 'forecast-only');
    await database.exec(`
      UPDATE "EfetivoMissionPlan" SET "returnDate" = NULL, "stage" = 'FINAL_MEASUREMENT' WHERE "id" = 'forecast-only';
      UPDATE "EfetivoMissionCycle" SET "demobilizationDate" = '2026-10-21' WHERE "id" = 'forecast-only';
      INSERT INTO "EfetivoMissionAllocation" ("id", "missionId", "demobilizationDate") VALUES ('explicit', 'forecast-only', '2026-10-21');
      INSERT INTO "EfetivoAllocationCycle" ("id", "allocationId", "demobilizationDate") VALUES ('explicit', 'explicit', '2026-10-21');
    `);
    await database.exec(await readFile(migration, 'utf8'));
    const state = await snapshot(database);
    assert.equal(state.cycles[0].demobilizationDate, null);
    assert.equal(state.projects[0].demobilizationDate.toISOString().slice(0, 10), '2026-10-22');
    assert.equal(state.individual[0].demobilizationDate.toISOString().slice(0, 10), '2026-10-21');
  } finally {
    await database.close();
  }
});
