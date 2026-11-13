import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import express from 'express';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import { receiveConectaEvent, getConectaReceipt, getConectaCompliance } from '../src/lib/conecta-rh/service.js';
import { validateConectaEvent, receiptDate } from '../src/lib/conecta-rh/schema.js';
import { collectAllocationConflicts } from '../src/lib/efetivo/planning/conflicts.js';
import { createConectaRhRouter } from '../src/routes/integrations/v1/conecta-rh.js';
import { createApiTokenAuthenticator } from '../src/middleware/api-token-auth.js';
import { apiRequestContext, integrationApiBoundary, integrationApiErrorHandler } from '../src/middleware/api-request-context.js';
import { createApiToken } from '../src/lib/api-credentials/token.js';
import { syncConectaRh } from '../src/lib/conecta-rh/sync.js';
import { resolveSelectedMissionTeam } from '../src/lib/efetivo/planning/mission-team.js';

test('Conecta: recepção real, referência provisória por vínculo, correções e autenticação', { timeout: 120_000 }, async t => {
  const database = await apiSimulationDatabase();
  t.after(() => database.close());
  const db = database.client;
  // Exercita a migration real, além do schema gerado, apenas na instância WASM vazia.
  await database.db.exec(`DROP TABLE "ConectaRhReceipt"; DROP TABLE "ConectaRhPerson";
    DROP TABLE "ConectaRhAggregate"; DROP TABLE "ConectaRhSyncState";
    ALTER TABLE "Collaborator" DROP COLUMN "rhStatus", DROP COLUMN "rhEmploymentId",
      DROP COLUMN "rhFirstReceivedAt", DROP COLUMN "admissionDateProvisional";`);
  await database.db.exec(await readFile(new URL('../prisma/migrations/20261113100000_conecta_rh/migration.sql', import.meta.url), 'utf8'));
  const companyId = randomUUID(), personId = randomUUID(), roleId = randomUUID(), employmentId = randomUUID();
  const firstReceived = new Date('2026-11-13T01:30:00Z');
  const employment = { personId, employmentId, name: 'Pessoa fictícia', cpf: null, registrationNumber: '0045', email: null,
    isOperational: true, admissionDate: null, terminationDate: null, status: 'PRE_ADMISSION', currentJobRoleId: roleId };
  const envelope = (aggregateType, data, revision = 1, extra = {}) => ({ schemaVersion: '1.0', eventId: randomUUID(), companyId,
    eventType: `${aggregateType}.upserted`, aggregateType, aggregateId: aggregateType === 'employment' ? data.employmentId : data.id,
    revision, occurredAt: '2026-11-11T12:00:00Z', data, ...extra });
  const receive = (event, now = firstReceived) => receiveConectaEvent(db, event, { companyId, now, idempotencyKey: event.eventId });
  let person;
  const initial = envelope('employment', employment);
  const initialRole = envelope('job_role', { id: roleId, name: 'Operador Conecta', cbo: null, isActive: true, isOperational: true });

  await t.test('a primeira entrega é preservada enquanto aguarda o cargo', async () => {
    assert.equal(receiptDate(firstReceived), '2026-11-12');
    const ack = await receive(initial);
    assert.equal(ack.status, 'PENDING');
    assert.equal(ack.reasonCode, 'JOB_ROLE_PENDING');
    assert.equal(await db.collaborator.count(), 0);
    await receive(initialRole, new Date('2026-11-15T12:00:00Z'));
    assert.equal((await getConectaReceipt(db, ack.receiptId, companyId)).status, 'APPLIED');
    person = await db.collaborator.findFirstOrThrow();
    assert.equal(person.admissionDate.toISOString().slice(0, 10), '2026-11-12');
    assert.equal(person.admissionDateProvisional, true);
    assert.equal(person.rhStatus, 'PRE_ADMISSION');
    assert.equal(person.rhFirstReceivedAt.toISOString(), firstReceived.toISOString());
    assert.equal(person.isActive, true);
    assert.equal(await db.collaboratorJobRoleHistory.count(), 1);
  });

  await t.test('reenvios idênticos e revisões sem data não deslocam a referência nem duplicam a pessoa', async () => {
    const duplicate = await receive(initial, new Date('2026-12-01T12:00:00Z'));
    assert.equal(duplicate.status, 'APPLIED');
    assert.equal(duplicate.receivedAt, firstReceived.toISOString());
    await receive(envelope('employment', { ...employment, name: 'Nome corrigido' }, 2), new Date('2026-11-14T12:00:00Z'));
    person = await db.collaborator.findFirstOrThrow();
    assert.equal(person.admissionDate.toISOString().slice(0, 10), '2026-11-12');
    assert.equal(person.name, 'Nome corrigido');
    assert.equal(await db.collaborator.count(), 1);
    await assert.rejects(() => receive({ ...initial, data: { ...employment, name: 'Outro corpo' } }), e => e.code === 'EVENT_CONTENT_CONFLICT');
    await assert.rejects(() => receive(envelope('employment', { ...employment, name: 'Outra versão' }, 2)), e => e.code === 'REVISION_CONTENT_CONFLICT');
  });

  const change = envelope('role_change', { id: randomUUID(), personId, employmentId, jobRoleId: roleId, effectiveDate: null, status: 'ACTIVE', supersedesId: null });
  await t.test('vigência sem data usa a mesma referência; a data oficial substitui ambas', async () => {
    assert.equal((await receive(change)).status, 'APPLIED');
    assert.equal((await db.collaboratorJobRoleHistory.findFirstOrThrow()).effectiveDate.toISOString().slice(0, 10), '2026-11-12');
    await receive(envelope('employment', { ...employment, admissionDate: '2026-11-10', status: 'ACTIVE' }, 3));
    person = await db.collaborator.findFirstOrThrow();
    assert.equal(person.id, (await db.conectaRhPerson.findFirstOrThrow()).collaboratorId);
    assert.equal(person.admissionDate.toISOString().slice(0, 10), '2026-11-10');
    assert.equal(person.admissionDateProvisional, false);
    assert.equal(person.rhStatus, 'ACTIVE');
    assert.equal(person.rhEmploymentId, employmentId);
    assert.equal(await db.collaboratorJobRoleHistory.count(), 1);
    assert.equal((await db.collaboratorJobRoleHistory.findFirstOrThrow()).effectiveDate.toISOString().slice(0, 10), '2026-11-10');
  });

  await t.test('pré-admissão com data futura permanece pendente de ativação e exige confirmação para mobilizar', async () => {
    await receive(envelope('employment', { ...employment, admissionDate: '2027-01-01' }, 4));
    person = await db.collaborator.findFirstOrThrow();
    assert.equal(person.rhStatus, 'PRE_ADMISSION');
    assert.equal(person.admissionDate.toISOString().slice(0, 10), '2027-01-01');
    const options = { collaborator: person, jobRoleId: person.jobRoleId, period: { startDate: '2026-11-13', endDate: '2026-11-20' } };
    assert.deepEqual(collectAllocationConflicts(options).map(c => c.code), ['PRE_ADMISSION_CONFIRMATION_REQUIRED']);
    assert.deepEqual(collectAllocationConflicts({ ...options, allowPreAdmissionCollaborator: true }), []);
    const teamInput = { collaboratorIds: [person.id], scheduleStatus: 'CONFIRMED', mobilizationDate: '2026-11-13', returnDate: '2026-11-20' };
    await assert.rejects(() => resolveSelectedMissionTeam(db, { ...teamInput, confirmedPreAdmissionCollaboratorIds: ['another-person'] }, 'isolated-plan'),
      e => e.conflicts?.[0]?.code === 'PRE_ADMISSION_CONFIRMATION_REQUIRED');
    assert.equal((await resolveSelectedMissionTeam(db, { ...teamInput, confirmedPreAdmissionCollaboratorIds: [person.id] }, 'isolated-plan')).allocations[0].collaboratorId, person.id);
    // A passagem do tempo não altera o status recebido do RH.
    assert.equal((await receive(initial, new Date('2027-02-01T12:00:00Z'))).status, 'APPLIED');
    assert.equal((await db.collaborator.findFirstOrThrow()).rhStatus, 'PRE_ADMISSION');
  });

  await t.test('recontratação cria nova referência para a mesma pessoa; correção antiga não a substitui', async () => {
    await receive(envelope('employment', { ...employment, status: 'TERMINATED', admissionDate: '2026-11-10', terminationDate: '2026-11-15' }, 5));
    const rehire = { ...employment, employmentId: randomUUID() };
    await receive(envelope('employment', rehire), new Date('2026-11-20T12:00:00Z'));
    await receive(envelope('employment', { ...employment, status: 'TERMINATED', admissionDate: '2026-11-10', terminationDate: '2026-11-16' }, 6));
    person = await db.collaborator.findFirstOrThrow();
    assert.equal(await db.collaborator.count(), 1);
    assert.equal(person.rhEmploymentId, rehire.employmentId);
    assert.equal(person.admissionDate.toISOString().slice(0, 10), '2026-11-20');
    assert.equal(person.admissionDateProvisional, true);
  });

  await t.test('salário respeita vigência e cancelamento; conformidade é calculada na data da mobilização', async () => {
    const salary = envelope('job_role_salary', { id: randomUUID(), jobRoleId: roleId, amount: '4250.00', currency: 'BRL', basis: 'MONTHLY',
      effectiveDate: '2027-01-01', status: 'ACTIVE', supersedesId: null });
    await receive(salary);
    assert.equal((await db.costParameterSet.findFirstOrThrow()).params.salarioBase, '4250.00');
    await receive({ ...salary, eventId: randomUUID(), revision: 2, data: { ...salary.data, status: 'CANCELLED' } });
    assert.equal(await db.costParameterSet.count(), 0);
    const compliance = envelope('compliance', { id: randomUUID(), personId, employmentId: null, category: 'TRAINING', typeCode: 'NR-35', title: 'NR-35',
      status: 'VALID', issuedOn: '2026-01-01', expiresOn: '2026-11-13', hasNoExpiry: false, evidence: null });
    await receive(compliance);
    assert.equal((await getConectaCompliance(db, person.id, '2026-11-13', companyId))[0].status, 'VALID');
    assert.equal((await getConectaCompliance(db, person.id, '2026-11-14', companyId))[0].status, 'EXPIRED');
  });

  await t.test('desistência sem cargo desativa o cadastro já conciliado', async () => {
    const current = await db.conectaRhAggregate.findFirstOrThrow({ where: { aggregateType: 'employment', externalId: person.rhEmploymentId } });
    const result = await receive(envelope('employment', { ...current.data, status: 'CANCELLED', currentJobRoleId: null }, 2));
    assert.equal(result.status, 'APPLIED');
    person = await db.collaborator.findFirstOrThrow();
    assert.equal(person.isActive, false);
    assert.equal(person.rhStatus, 'CANCELLED');
    assert.equal(person.terminationDate, null);
  });

  await t.test('substituição no mesmo dia preserva uma vigência, e referência incompatível não exclui outro cargo', async () => {
    const secondRoleId = randomUUID();
    await receive(envelope('job_role', { id: secondRoleId, name: 'Técnico Conecta', cbo: null, isActive: true, isOperational: true }));
    const newEmployment = { ...employment, personId: randomUUID(), employmentId: randomUUID(), registrationNumber: null };
    await receive(envelope('employment', newEmployment));
    const mapping = await db.conectaRhPerson.findUniqueOrThrow({ where: { companyId_personId: { companyId, personId: newEmployment.personId } } });
    const first = envelope('role_change', { id: randomUUID(), personId: newEmployment.personId, employmentId: newEmployment.employmentId,
      jobRoleId: roleId, effectiveDate: null, status: 'ACTIVE', supersedesId: null });
    await receive(first);
    const replacement = envelope('role_change', { ...first.data, id: randomUUID(), jobRoleId: secondRoleId, supersedesId: first.aggregateId });
    assert.equal((await receive(replacement)).status, 'APPLIED');
    assert.equal(await db.collaboratorJobRoleHistory.count({ where: { collaboratorId: mapping.collaboratorId } }), 1);
    assert.equal((await db.collaborator.findUniqueOrThrow({ where: { id: mapping.collaboratorId } })).jobRoleId,
      (await db.conectaRhAggregate.findUniqueOrThrow({ where: { companyId_aggregateType_externalId: { companyId, aggregateType: 'job_role', externalId: secondRoleId } } })).localId);
    await receive({ ...first, eventId: randomUUID(), revision: 2, data: { ...first.data, status: 'CANCELLED' } });
    assert.equal(await db.collaboratorJobRoleHistory.count({ where: { collaboratorId: mapping.collaboratorId } }), 1);
    const salary = envelope('job_role_salary', { id: randomUUID(), jobRoleId: roleId, amount: '3000.00', currency: 'BRL', basis: 'MONTHLY',
      effectiveDate: '2026-11-01', status: 'ACTIVE', supersedesId: null });
    await receive(salary);
    const mismatched = envelope('job_role_salary', { ...salary.data, id: randomUUID(), jobRoleId: secondRoleId, supersedesId: salary.aggregateId });
    assert.equal((await receive(mismatched)).status, 'FAILED');
    assert.equal(await db.costParameterSet.count(), 1);
  });

  await t.test('snapshot/feed preservam eventos e avançam cursor vazio; falha parcial não avança o watermark', async () => {
    let failResource = null, expireCursor = false;
    let snapshots = 0;
    const requests = [];
    let snapshotId;
    const fetchImpl = async (url, options) => {
      requests.push(url);
      assert.equal(url.searchParams.get('companyId'), companyId);
      assert.equal(options.headers.Authorization, 'Bearer synthetic-read-token');
      const suffix = url.pathname.replace('/api/integracoes/filtroapp/v1', '');
      if (suffix === '/snapshots') {
        assert.equal(options.method, 'POST');
        snapshots++;
        snapshotId = randomUUID();
        return Response.json({ snapshotId, watermarkCursor: `watermark-${snapshots}`, expiresAt: '2099-01-01T00:00:00Z' });
      }
      if (suffix === '/changes') {
        if (expireCursor) { expireCursor = false; return Response.json({}, { status: 410 }); }
        return Response.json({ items: [], nextCursor: 'empty-checkpoint', hasMore: false, generatedAt: '2026-11-13T12:00:00Z' });
      }
      if (suffix.endsWith('/job-role-salaries')) return Response.json({}, { status: 403 });
      if (failResource && suffix.endsWith(failResource)) return Response.json({}, { status: 500 });
      return Response.json({ items: suffix.endsWith('/job-roles') ? [initialRole] : [], nextCursor: null, hasMore: false,
        snapshotId, watermarkCursor: `watermark-${snapshots}` });
    };
    const options = { database: db, companyId, apiUrl: 'https://conecta.example.test/api/integracoes/filtroapp/v1', token: 'synthetic-read-token', fetchImpl };
    const before = await receive(initial);
    assert.deepEqual(await syncConectaRh(options), { events: 1, snapshots: 1 });
    assert.equal((await db.conectaRhSyncState.findUniqueOrThrow({ where: { companyId } })).cursor, 'empty-checkpoint');
    assert.equal((await receive(initial)).receivedAt, before.receivedAt);
    await db.conectaRhSyncState.update({ where: { companyId }, data: { cursor: 'expired' } });
    expireCursor = true;
    failResource = '/compliance';
    await assert.rejects(() => syncConectaRh(options));
    assert.equal((await db.conectaRhSyncState.findUniqueOrThrow({ where: { companyId } })).cursor, 'expired');
    expireCursor = true;
    failResource = null;
    assert.equal((await syncConectaRh(options)).snapshots, 1);
    assert.equal((await db.conectaRhSyncState.findUniqueOrThrow({ where: { companyId } })).cursor, 'empty-checkpoint');
    assert.ok(requests.every(url => url.origin === 'https://conecta.example.test'));
    await assert.rejects(() => syncConectaRh({ ...options, apiUrl: 'http://conecta.example.test' }));
  });

  await t.test('HTTP: Bearer, escopos, empresa, idempotência, recebimento e formato de erro', async () => {
    const key = 'synthetic-conecta-test-key-at-least-32-characters';
    const envConfig = { conectaRhCompanyId: companyId, apiTokenHashKeys: { 1: key }, apiTokenActiveKeyVersion: 1 };
    const token = createApiToken({ key, keyVersion: 1 });
    const admin = await db.user.create({ data: { username: 'conecta-admin', name: 'Admin fictício', passwordHash: 'synthetic', role: 'MANAGER', accountType: 'ADMIN' } });
    await db.apiCredential.create({ data: { selector: token.selector, secretVerifier: token.verifier, hashKeyVersion: 1, secretLastFour: token.secretLastFour,
      createdByUserId: admin.id, issuanceRequestId: randomUUID(), name: 'Conecta sintético', purpose: 'Teste', recipientName: 'Conecta', startsAt: new Date(0), projectAccessMode: 'ALL',
      scopes: { create: [{ scopeCode: 'rh.conecta.eventos.write', grantedByUserId: admin.id }] } } });
    const app = express();
    app.use(apiRequestContext(), express.json(), integrationApiBoundary());
    app.use(createApiTokenAuthenticator({ prismaClient: db, envConfig }));
    app.use('/api/integracoes/v1/rh/conecta', createConectaRhRouter({ prismaClient: db, envConfig }));
    app.use(integrationApiErrorHandler);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (event, tokenValue = token.token, extraHeaders = {}) => {
      const res = await fetch(base + '/api/integracoes/v1/rh/conecta/eventos', { method: 'POST', headers: {
        'Content-Type': 'application/json', Authorization: `Bearer ${tokenValue}`, 'Idempotency-Key': event.eventId, ...extraHeaders
      }, body: JSON.stringify(event) });
      return { res, body: await res.json() };
    };
    let result = await request(initialRole, 'invalid');
    assert.equal(result.res.status, 401);
    assert.equal(result.body.error.code, 'INVALID_TOKEN');
    result = await request({ ...initialRole, companyId: randomUUID(), eventId: randomUUID() });
    assert.equal(result.res.status, 403);
    assert.equal(result.body.error.code, 'COMPANY_NOT_ALLOWED');
    result = await request(envelope('job_role_salary', { id: randomUUID(), jobRoleId: roleId, amount: '4000.00', currency: 'BRL', basis: 'MONTHLY',
      effectiveDate: '2026-11-01', status: 'ACTIVE', supersedesId: null }));
    assert.equal(result.res.status, 403);
    result = await request(initialRole);
    assert.equal(result.res.status, 202);
    assert.equal(result.body.status, 'APPLIED');
    const receipt = await fetch(base + result.body.statusUrl, { headers: { Authorization: `Bearer ${token.token}` } });
    assert.equal(receipt.status, 200);
    assert.equal((await receipt.json()).status, 'APPLIED');
    result = await request(initialRole, token.token, { 'Idempotency-Key': randomUUID() });
    assert.equal(result.res.status, 400);
    assert.equal(result.body.error.code, 'IDEMPOTENCY_KEY_MISMATCH');
  });
});

test('contrato não aceita ativação sem admissão oficial ou tipo de evento incompatível', () => {
  const companyId = randomUUID(), employmentId = randomUUID();
  const raw = { schemaVersion: '1.0', eventId: randomUUID(), companyId, eventType: 'employment.upserted', aggregateType: 'employment', aggregateId: employmentId,
    revision: 1, occurredAt: '2026-11-11T12:00:00Z', data: { employmentId, personId: randomUUID(), name: 'Teste', cpf: null, registrationNumber: null,
      email: null, isOperational: true, status: 'ACTIVE', admissionDate: null, terminationDate: null, currentJobRoleId: randomUUID() } };
  assert.throws(() => validateConectaEvent(raw), e => e.name === 'ZodError');
  assert.throws(() => validateConectaEvent({ ...raw, eventType: 'role_change.upserted', data: { ...raw.data, status: 'PRE_ADMISSION' } }), e => e.code === 'AGGREGATE_MISMATCH');
});
