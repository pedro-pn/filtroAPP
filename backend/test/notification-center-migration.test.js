import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('central registra transições atômicas e não duplica integrações ou revisões', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE "User" (id TEXT PRIMARY KEY);
      CREATE TABLE "Project" (id TEXT PRIMARY KEY, "registrationPending" BOOLEAN DEFAULT false, "deletedAt" TIMESTAMP);
      CREATE TABLE "Report" (id TEXT PRIMARY KEY, "projectId" TEXT, "status" TEXT DEFAULT 'PENDING', "reportType" TEXT DEFAULT 'RDO', "deletedAt" TIMESTAMP);
      CREATE TABLE "CommercialAppProposal" (id TEXT PRIMARY KEY, "projectId" TEXT, "proposalKind" TEXT, "proposalCode" TEXT, "revisionNumber" INT);
      CREATE TABLE "ProjectAdditionalProposal" (id TEXT PRIMARY KEY, "projectId" TEXT, source TEXT, active BOOLEAN, "proposalCode" TEXT, "sourceProposalCodBd" INT);
      INSERT INTO "Project" (id) VALUES ('old');
    `);
    await db.exec(await readFile(new URL('../prisma/migrations/20261021120000_notification_center/migration.sql', import.meta.url), 'utf8'));
    const events = async kind => (await db.query('SELECT * FROM "NotificationEvent" WHERE kind = $1', [kind])).rows;
    assert.equal((await events('PROJECT_CREATED')).length, 0, 'sem inundação de avisos históricos');
    await db.exec(`
      INSERT INTO "Project" (id) VALUES ('manual');
      INSERT INTO "Project" (id, "registrationPending") VALUES ('received', true);
      UPDATE "Project" SET "registrationPending" = false WHERE id = 'received';
      UPDATE "Project" SET "registrationPending" = false WHERE id = 'received';
      INSERT INTO "Project" (id, "deletedAt") VALUES ('deleted', now());
    `);
    assert.equal((await events('PROJECT_CREATED')).length, 1);
    assert.equal((await events('PROJECT_RECEIVED')).length, 1);
    assert.equal((await events('PROJECT_READY')).length, 1);
    await db.exec(`INSERT INTO "Report" (id, "projectId") VALUES ('r1', 'manual')`);
    const first = (await events('REPORT_PENDING'))[0];
    await db.exec(`
      INSERT INTO "User" VALUES ('u1'), ('u2');
      INSERT INTO "NotificationRead" ("userId", "notificationId") SELECT 'u1', id FROM "NotificationEvent" WHERE kind = 'REPORT_PENDING';
      UPDATE "Report" SET status = 'PENDING' WHERE id = 'r1';
    `);
    assert.equal((await events('REPORT_PENDING')).length, 1);
    await db.exec(`
      UPDATE "Report" SET status = 'RETURNED' WHERE id = 'r1';
      UPDATE "Report" SET status = 'PENDING' WHERE id = 'r1';
    `);
    assert.equal((await events('REPORT_PENDING')).length, 1, 'reenvio tem só um aviso atual');
    assert.notEqual((await events('REPORT_PENDING'))[0].id, first.id, 'nova rodada volta a ser não lida');
    assert.equal((await db.query('SELECT * FROM "NotificationRead"')).rows.length, 0);
    assert.equal((await events('REPORT_RETURNED')).length, 1);
    await db.exec(`UPDATE "Report" SET "projectId" = 'received' WHERE id = 'r1'`);
    assert.ok((await db.query('SELECT "projectId" FROM "NotificationEvent" WHERE "reportId" = $1', ['r1'])).rows.every(row => row.projectId === 'received'));
    await db.exec(`UPDATE "Report" SET "projectId" = 'manual' WHERE id = 'r1'`);
    await db.exec(`INSERT INTO "Report" (id, "projectId", "reportType") VALUES ('operational', 'manual', 'RDO_MAINTENANCE')`);
    assert.equal((await events('REPORT_PENDING')).length, 2, 'relatórios operacionais também geram avisos');
    await db.exec(`
      INSERT INTO "CommercialAppProposal" VALUES ('main', 'manual', 'MAIN', '100', 0), ('extra0', 'manual', 'ADDITIONAL', '101', 0);
      INSERT INTO "ProjectAdditionalProposal" VALUES ('extra-link', 'manual', 'COMERCIAL_APP', true, '101', NULL);
      INSERT INTO "CommercialAppProposal" VALUES ('extra1', 'manual', 'ADDITIONAL', '101', 1);
      INSERT INTO "ProjectAdditionalProposal" VALUES ('access', 'manual', 'ACCESS_IMPORT', true, '102', 20);
      UPDATE "ProjectAdditionalProposal" SET active = true WHERE id = 'access';
      UPDATE "ProjectAdditionalProposal" SET "sourceProposalCodBd" = 21 WHERE id = 'access';
    `);
    assert.equal((await events('PROPOSAL_RECEIVED')).length, 4);
    await db.exec(`BEGIN; INSERT INTO "Project" (id) VALUES ('rollback'); ROLLBACK;`);
    assert.equal((await events('PROJECT_CREATED')).length, 1, 'rollback não gera notificação fantasma');
    await db.exec(`DELETE FROM "Project" WHERE id = 'manual'`);
    assert.equal((await events('PROPOSAL_RECEIVED')).length, 0);
    assert.equal((await events('REPORT_PENDING')).length, 0);
  } finally { await db.close(); }
});
