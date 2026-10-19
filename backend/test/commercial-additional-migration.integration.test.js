import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

test('migração preserva duplicatas/seleções Access, escopo e versões existentes; novas identidades são exclusivas', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.equal(url.pathname, '/filtroapp_bridge_test');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  const schema = `legacy_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path = "${schema}"`);
    await client.query(`
      CREATE TABLE "Project" (id TEXT PRIMARY KEY, "commercialScopeImport" JSONB);
      CREATE TABLE "CommercialProposal" (id TEXT PRIMARY KEY, "codBd" INTEGER UNIQUE, "codProp" INTEGER, "nRev" INTEGER);
      CREATE TABLE "CommercialAppProposal" (id TEXT PRIMARY KEY, "externalId" TEXT UNIQUE, "proposalCode" TEXT,
        "revisionNumber" INTEGER, "projectId" TEXT, "clientCnpj" TEXT);
      CREATE UNIQUE INDEX "app_revision" ON "CommercialAppProposal" ("proposalCode", "revisionNumber");
      CREATE TABLE "CommercialAppDelivery" ("eventId" TEXT PRIMARY KEY);
      CREATE TABLE "ProjectAdditionalProposal" (id TEXT PRIMARY KEY, "projectId" TEXT, "codProp" INTEGER NOT NULL,
        "sourceProposalCodBd" INTEGER NOT NULL, "metricInclusion" JSONB, "selectedByUserId" TEXT);
      CREATE TABLE "ProjectPlannedService" (id TEXT PRIMARY KEY, "projectId" TEXT);
      CREATE TABLE "ProjectDocumentVersion" (id TEXT PRIMARY KEY, source TEXT, "externalId" TEXT, "sourceVersion" TEXT);
      INSERT INTO "Project" VALUES ('project', '{"externalId":"main-revision"}');
      INSERT INTO "CommercialProposal" VALUES ('canonical', 1, 501, 0), ('legacy-alias', 2, 501, 0);
      INSERT INTO "ProjectAdditionalProposal" VALUES ('selected-legacy', 'project', 501, 2, '{"hours":false}', 'manager');
      INSERT INTO "CommercialAppProposal" VALUES ('main', 'main-revision', '500', 2, 'project', '12345678000190');
      INSERT INTO "ProjectPlannedService" VALUES ('existing-service', 'project');
      INSERT INTO "ProjectDocumentVersion" VALUES ('existing-version', 'SYSTEM', 'comercialapp:COMMERCIAL_PROPOSAL', '500:2:pdf-id');
    `);
    await client.query(await readFile(new URL('../prisma/migrations/20261019180000_commercial_additional_contributions/migration.sql', import.meta.url), 'utf8'));
    const [selection] = (await client.query('SELECT * FROM "ProjectAdditionalProposal"')).rows;
    assert.equal(selection.id, 'selected-legacy'); assert.equal(selection.sourceProposalCodBd, 2);
    assert.equal(selection.source, 'ACCESS_IMPORT'); assert.equal(selection.proposalCode, '501');
    assert.equal(selection.metricInclusion.hours, false); assert.equal(selection.selectedByUserId, 'manager');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM "CommercialProposal"')).rows[0].n, 2);
    assert.equal((await client.query('SELECT "legacyDuplicate" FROM "CommercialProposal" WHERE id = $1', ['legacy-alias'])).rows[0].legacyDuplicate, true);
    assert.equal((await client.query('SELECT "contributionKey" FROM "ProjectPlannedService"')).rows[0].contributionKey, 'COMERCIAL_APP:500');
    const version = (await client.query('SELECT * FROM "ProjectDocumentVersion"')).rows[0];
    assert.equal(version.id, 'existing-version'); assert.equal(version.externalId, 'comercialapp:500:COMMERCIAL_PROPOSAL');
    assert.equal(version.sourceVersion, '500:2:pdf-id');
    async function rejected(sql, values) {
      await client.query('SAVEPOINT expected_conflict');
      await assert.rejects(client.query(sql, values), error => ['23505', '23514'].includes(error.code));
      await client.query('ROLLBACK TO SAVEPOINT expected_conflict');
    }
    await rejected('INSERT INTO "CommercialProposal" VALUES ($1, 3, 501, 0, false)', ['new-duplicate']);
    await rejected('INSERT INTO "CommercialProposal" VALUES ($1, 4, 599, 0, true)', ['fake-legacy']);
    await client.query(`INSERT INTO "ProjectAdditionalProposal" (id, "projectId", "codProp", "sourceProposalCodBd") VALUES ('access-compat', 'project', 502, 3)`);
    assert.equal((await client.query('SELECT "proposalCode" FROM "ProjectAdditionalProposal" WHERE id = $1', ['access-compat'])).rows[0].proposalCode, '502');
    await rejected(`INSERT INTO "ProjectAdditionalProposal" (id, "projectId", source, "proposalCode", "sourceProposalCodBd", "commercialAppProposalId")
      VALUES ('mixed-refs', 'project', 'COMERCIAL_APP', '503', 3, 'revision-503-0')`);
    await client.query(`INSERT INTO "CommercialAppProposal" (id, "externalId", "proposalCode", "revisionNumber", "projectId", "clientCnpj", "proposalKind", "parentProposalCode", "additionalProposalId", "sourceRevisionNumber")
      VALUES ('additional-0', 'rev-503-0', '503', 0, 'project', '12345678000190', 'ADDITIONAL', '500', 'additional-503', 2)`);
    await rejected(`INSERT INTO "CommercialAppProposal" (id, "externalId", "proposalCode", "revisionNumber", "projectId", "clientCnpj", "proposalKind", "parentProposalCode", "additionalProposalId", "sourceRevisionNumber")
      VALUES ('additional-1', 'rev-503-1', '503', 1, 'other-project', '12345678000190', 'ADDITIONAL', '500', 'additional-503', 2)`);
    await rejected(`UPDATE "CommercialAppProposal" SET "parentProposalCode" = '499' WHERE id = 'additional-0'`);
  } finally { await client.query('ROLLBACK'); await client.end(); }
});

test('migração de Data Book conserva emissões e relatórios legados; separa documentos por contribuição', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  assert.equal(new URL(process.env.TEST_DATABASE_URL).pathname, '/filtroapp_bridge_test');
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  const schema = `books_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path = "${schema}"`);
    await client.query(`CREATE TABLE "ProjectDatabook" (id TEXT PRIMARY KEY, "projectId" TEXT, "startDate" DATE, "endDate" DATE);
      CREATE UNIQUE INDEX "ProjectDatabook_projectId_startDate_endDate_key" ON "ProjectDatabook" ("projectId", "startDate", "endDate");
      CREATE TABLE "ProjectDatabookRevision" (id TEXT PRIMARY KEY, "databookId" TEXT, input JSONB);
      CREATE TABLE "Report" (id TEXT PRIMARY KEY, "specialConditions" JSONB);
      INSERT INTO "ProjectDatabook" VALUES ('original', 'project', '2026-10-01', '2026-10-19');
      INSERT INTO "ProjectDatabookRevision" VALUES ('rev-0', 'original', '{"dias":[{"rdo":1}],"projeto":{"doc":"DB-500-01"}}');
      INSERT INTO "Report" VALUES ('rdo-1', '{"serviceLinkKey":"preservado"}');`);
    await client.query(await readFile(new URL('../prisma/migrations/20261019210000_proposal_scope_databooks/migration.sql', import.meta.url), 'utf8'));
    assert.equal((await client.query('SELECT "scopeKey" FROM "ProjectDatabook"')).rows[0].scopeKey, 'ALL');
    assert.equal((await client.query('SELECT input FROM "ProjectDatabookRevision"')).rows[0].input.projeto.doc, 'DB-500-01');
    const report = (await client.query('SELECT * FROM "Report"')).rows[0];
    assert.deepEqual(report.contributionAssignments, {});
    assert.equal(report.specialConditions.serviceLinkKey, 'preservado');
    await client.query(`INSERT INTO "ProjectDatabook" (id,"projectId","startDate","endDate","scopeKey")
      VALUES ('extra-a','project','2026-10-01','2026-10-19','COMERCIAL_APP:502'), ('main','project','2026-10-01','2026-10-19','ACCESS_IMPORT:500')`);
    assert.equal((await client.query('SELECT COUNT(*) FROM "ProjectDatabook"')).rows[0].count, '3');
    await client.query('SAVEPOINT duplicate');
    await assert.rejects(() => client.query(`INSERT INTO "ProjectDatabook" (id,"projectId","startDate","endDate","scopeKey")
      VALUES ('duplicate','project','2026-10-01','2026-10-19','COMERCIAL_APP:502')`), error => error.code === '23505');
    await client.query('ROLLBACK TO SAVEPOINT duplicate');
  } finally { await client.query('ROLLBACK'); await client.end(); }
});
