import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { validateCrmOpportunity, planningCardCategory } from '../src/lib/projects/crm-opportunities.js';
import { validatePlanningNamespace, planningNamespace } from '../src/lib/projects/crm-planning-schema.js';
import { validatePlanningTransition } from '../src/lib/projects/crm-planning-links.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';
import { validatePlaygroundRequest } from '../src/lib/api-credentials/playground.js';
import { validatePlanningReadAccess } from '../src/lib/projects/crm-planning-read.js';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/crm-planning-events.json', import.meta.url)));
const event = index => structuredClone(fixtures.examples[index].request);

test('os dez exemplos do Prisma são retratos válidos, incluindo ganho sem CNPJ', () => {
  assert.equal(fixtures.examples.length, 10);
  for (const fixture of fixtures.examples) assert.doesNotThrow(() => validateCrmOpportunity(fixture.request), fixture.name);
  const won = validateCrmOpportunity(event(4));
  assert.equal(won.opportunity.commercialStatus, 'WON');
  assert.equal(won.opportunity.client.taxId, null);
  assert.equal(validateCrmOpportunity({ ...event(0), sourceVersion: Number.MAX_SAFE_INTEGER }).sourceVersion, Number.MAX_SAFE_INTEGER);
});

test('retrato completo exige campos nullable explícitos, datas reais e valores exatos', () => {
  for (const alter of [input => { delete input.opportunity.project; }, input => { input.extra = true; },
    input => { input.opportunity.expectedDates.closeOn = '2026-02-30'; }, input => { input.opportunity.value.amount = '1.001'; },
    input => { input.opportunity.recordUrl = 'javascript:alert(1)'; }, input => { input.sourceVersion = 9007199254740992; },
    input => { input.opportunity.expectedDates.executionEndOn = '2020-01-01'; }]) {
    const input = event(0); alter(input);
    assert.throws(() => validateCrmOpportunity(input), error => error.statusCode === 422);
  }
  const withdrawn = event(2); withdrawn.change.reason = null;
  assert.throws(() => validateCrmOpportunity(withdrawn), error => error.code === 'WITHDRAWAL_REASON_REQUIRED');
  const input = event(0); input.opportunity.planningRequested = false;
  assert.throws(() => validateCrmOpportunity(input), error => error.code === 'INVALID_PLANNING_DECISION');
  input.change.kind = 'STATE_UPDATED'; input.opportunity.planningDecision.reason = null;
  assert.throws(() => validatePlanningTransition({ planningRequested: true }, input), error => error.code === 'WITHDRAWAL_REASON_REQUIRED');
});

test('ambiente é autorizado no servidor e consulta exige ALL', () => {
  const ns = planningNamespace({ nodeEnv: 'production', appEnv: 'staging' });
  assert.equal(ns.environment, 'sandbox');
  assert.doesNotThrow(() => validatePlanningNamespace(event(0), ns));
  assert.throws(() => validatePlanningNamespace({ ...event(0), environment: 'production' }, ns), error => error.statusCode === 403);
  assert.throws(() => validatePlanningReadAccess({ projectAccessMode: 'SELECTED' }), error => error.code === 'PROJECT_NOT_ALLOWED');
});

test('Futuros, pausadas e fechamento pendente obedecem às quatro decisões', () => {
  const row = { contractVersion: 'planning-1.0', commercialStatus: 'OPEN', planningRequested: true, projectId: null };
  assert.equal(planningCardCategory(row), 'FUTURO');
  assert.equal(planningCardCategory({ ...row, commercialStatus: 'POSTPONED' }), 'PAUSADA');
  assert.equal(planningCardCategory({ ...row, commercialStatus: 'WON', planningRequested: false }), 'FUTURO');
  for (const fields of [{ planningRequested: false }, { commercialStatus: 'LOST' }, { commercialStatus: 'DISCARDED' },
    { commercialStatus: 'CANCELLED' }, { sourceRecordDeleted: true }, { projectId: 'confirmed' }, { contractVersion: 'legacy' }]) {
    assert.equal(planningCardCategory({ ...row, ...fields }), null);
  }
});

test('rota de escrita exige ambos escopos e playground compartilha o validador', () => {
  const route = createOperationalRouter().stack.find(layer => layer.route?.path === '/acompanhamento/oportunidades').route;
  for (const scopes of [[], ['efetivo.projetos.create'], ['acompanhamento.oportunidades.write']]) {
    const res = { setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    route.stack[0].handle({ apiAuth: { scopeCodes: new Set(scopes) }, query: {} }, res, () => assert.fail('Escopos incompletos'));
    assert.equal(res.statusCode, 403);
  }
  let allowed = false;
  route.stack[0].handle({ apiAuth: { scopeCodes: new Set(['efetivo.projetos.create', 'acompanhamento.oportunidades.write']) }, query: {} }, {}, () => { allowed = true; });
  assert.equal(allowed, true);
  assert.equal(validatePlaygroundRequest({ operationId: 'acompanhamento.opportunities.post', body: event(0) }).body.contractVersion, 'planning-1.0');
});

test('migração preserva histórico legado, amplia versão e permite várias oportunidades no projeto', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE "Project" ("id" TEXT PRIMARY KEY);');
    await db.exec(await readFile(new URL('../prisma/migrations/20261020190000_crm_hot_opportunities/migration.sql', import.meta.url), 'utf8'));
    await db.exec(`INSERT INTO "Project" VALUES ('p');
      INSERT INTO "CrmOpportunity" ("id","externalId","status","name","clientName","sourceVersion","sourceUpdatedAt","payloadHash","projectId","updatedAt")
      VALUES ('hot','source-hot','HOT','Negociação','Cliente',1,NOW(),'hash',NULL,NOW()),('won','source-won','WON','Fechada','Cliente',2,NOW(),'hash','p',NOW());
      INSERT INTO "CrmOpportunityEvent" ("id","opportunityId","sourceVersion","sourceUpdatedAt","status","snapshot") VALUES ('e','hot',1,NOW(),'HOT','{"status":"HOT"}');`);
    await db.exec(await readFile(new URL('../prisma/migrations/20261020220000_crm_planning_contract/migration.sql', import.meta.url), 'utf8'));
    const { rows } = await db.query('SELECT "legacyStatus","contractVersion","planningRequested","projectId" FROM "CrmOpportunity" ORDER BY "id"');
    assert.deepEqual(rows, [{ legacyStatus: 'HOT', contractVersion: 'legacy', planningRequested: false, projectId: null },
      { legacyStatus: 'WON', contractVersion: 'legacy', planningRequested: false, projectId: 'p' }]);
    assert.equal((await db.query('SELECT "snapshot" FROM "CrmOpportunityEvent"')).rows[0].snapshot.status, 'HOT');
    await db.exec(`INSERT INTO "CrmOpportunity" ("id","externalId","name","sourceVersion","sourceUpdatedAt","payloadHash","projectId","updatedAt")
      VALUES ('extra','source-extra','Adicional',9007199254740991,NOW(),'hash','p',NOW());`);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM "CrmOpportunity" WHERE "projectId"=\'p\'')).rows[0].n, 2);
  } finally { await db.close(); }
});

test('schemas publicados e exemplo do playground permanecem iguais ao contrato validado', async () => {
  const { z } = await import('zod');
  const { default: YAML } = await import('yaml');
  const { crmPlanningSnapshotSchema } = await import('../src/lib/projects/crm-planning-schema.js');
  const { CRM_PLANNING_EXAMPLE } = await import('../../shared/modules/crm-planning-example.js');
  const expected = z.toJSONSchema(crmPlanningSnapshotSchema, { unrepresentable: 'any' });
  expected.properties.opportunity.properties.recordUrl.pattern = '^https?://';
  const published = JSON.parse(await readFile(new URL('../../docs/prisma-planning.schema.json', import.meta.url)));
  assert.deepEqual(published, expected);
  const { $schema, ...embedded } = published;
  const openapi = YAML.parse(await readFile(new URL('../../specs/015-api-token-playground/contracts/openapi.yaml', import.meta.url), 'utf8'));
  assert.deepEqual(openapi.components.schemas.CrmOpportunityInput, embedded);
  assert.deepEqual(CRM_PLANNING_EXAMPLE, fixtures.examples[0].request);
});
