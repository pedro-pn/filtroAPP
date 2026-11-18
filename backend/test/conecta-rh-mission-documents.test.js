import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import express from 'express';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import { getConectaComplianceBatch, resolveConectaEvidence } from '../src/lib/conecta-rh/compliance.js';
import { createEfetivoRhRouter } from '../src/routes/efetivo-rh.js';

test('documentação da missão: consulta real em lote e comprovantes autorizados', { timeout: 120_000 }, async t => {
  const database = await apiSimulationDatabase();
  t.after(() => database.close());
  const db = database.client;
  const companyId = randomUUID(), personId = randomUUID(), itemId = randomUUID();
  const evidence = { id: randomUUID(), version: randomUUID(), contentType: 'application/pdf', fileName: 'nr35.pdf', authenticatedDownloadPath: '/api/integracoes/filtroapp/v1/evidence/ignored', expiresAt: null };
  const role = await db.jobRole.create({ data: { name: 'Documentação', normalizedKey: 'documentacao' } });
  for (const id of ['mapped', 'unmapped', 'empty', 'foreign']) await db.collaborator.create({ data: { id, code: id, name: id, jobRoleId: role.id } });
  await db.conectaRhPerson.createMany({ data: [
    { companyId, personId, collaboratorId: 'mapped' },
    { companyId, personId: randomUUID(), collaboratorId: 'empty' },
    { companyId: randomUUID(), personId: randomUUID(), collaboratorId: 'foreign' }
  ] });
  const data = { id: itemId, personId, employmentId: null, category: 'TRAINING', typeCode: 'NR-35', title: 'NR-35',
    status: 'VALID', issuedOn: null, expiresOn: '2026-11-20', hasNoExpiry: false, evidence, privateNotes: 'não expor' };
  const row = await db.conectaRhAggregate.create({ data: { companyId, aggregateType: 'compliance', externalId: itemId, revision: 3,
    data, localId: 'mapped', status: 'APPLIED', occurredAt: new Date('2026-11-17T12:00:00Z') } });
  const config = { conectaRhCompanyId: companyId, conectaRhApiUrl: 'https://conecta.example.test/api/integracoes/filtroapp/v1', conectaRhReadToken: 'synthetic-server-only-token' };
  const now = new Date('2026-11-17T12:00:00Z');
  await db.jobRun.create({ data: { name: 'conecta-rh', status: 'COMPLETED', startedAt: now, finishedAt: now } });

  await t.test('retorna validade por período, emissão opcional, fonte e ausência sem aprovar pessoas', async () => {
    const result = await getConectaComplianceBatch(db, { collaboratorIds: ['mapped', 'unmapped', 'empty', 'foreign'], date: '2026-11-17', endDate: '2026-11-21' }, { companyId, now });
    assert.equal(result.sync.status, 'OK');
    assert.deepEqual(result.collaborators.map(row => row.state), ['AVAILABLE', 'UNMAPPED', 'EMPTY', 'UNMAPPED']);
    const [item] = result.collaborators[0].items;
    assert.equal(item.status, 'VALID'); assert.equal(item.expiresDuringMission, true); assert.equal(item.issuedOn, null);
    assert.deepEqual(item.evidence, { fileName: 'nr35.pdf', contentType: 'application/pdf' });
    assert(!JSON.stringify(result).includes('authenticatedDownloadPath'));
    assert(!JSON.stringify(result).includes('privateNotes'));
    assert.equal(await db.projectWorkflowTeamMemberCheck.count(), 0);
    const expiresToday = await getConectaComplianceBatch(db, { collaboratorIds: ['mapped'], date: '2026-11-20', endDate: '2026-11-20' }, { companyId, now });
    assert.equal(expiresToday.collaborators[0].items[0].status, 'VALID');
    assert.equal(expiresToday.collaborators[0].items[0].expiresDuringMission, false);
    const expired = await getConectaComplianceBatch(db, { collaboratorIds: ['mapped'], date: '2026-11-21' }, { companyId, now });
    assert.equal(expired.collaborators[0].items[0].status, 'EXPIRED');
  });

  await t.test('distingue configuração ausente, atraso e falha da sincronização', async () => {
    const options = { collaboratorIds: ['mapped'], date: '2026-11-17' };
    assert.equal((await getConectaComplianceBatch(db, options, { companyId: null, now })).collaborators[0].state, 'NOT_CONFIGURED');
    assert.equal((await getConectaComplianceBatch(db, options, { companyId, now: new Date('2026-11-17T12:16:00Z') })).sync.status, 'STALE');
    const failed = await db.jobRun.create({ data: { name: 'conecta-rh', status: 'FAILED', startedAt: new Date('2026-11-17T12:17:00Z') } });
    assert.equal((await getConectaComplianceBatch(db, options, { companyId, now })).sync.status, 'ERROR');
    await db.jobRun.delete({ where: { id: failed.id } });
  });

  await t.test('resolve novo link por clique usando somente a credencial do servidor e a versão persistida', async () => {
    let calls = 0;
    const fetchImpl = async (url, options) => {
      calls++;
      assert.equal(url.origin, 'https://conecta.example.test');
      assert.equal(url.pathname, `/api/integracoes/filtroapp/v1/evidence/${evidence.id}`);
      assert.equal(url.searchParams.get('version'), evidence.version);
      assert.equal(url.searchParams.get('companyId'), companyId);
      assert.equal(options.headers.Authorization, `Bearer ${config.conectaRhReadToken}`);
      assert.equal(options.redirect, 'error');
      return Response.json({ id: evidence.id, version: evidence.version, url: `https://files.example.test/nr35.pdf?temporary=${calls}`, expiresAt: '2026-11-17T12:05:00Z' });
    };
    const input = { collaboratorId: 'mapped', itemId, revision: 3 };
    const first = await resolveConectaEvidence(db, input, { config, fetchImpl, now });
    const second = await resolveConectaEvidence(db, input, { config, fetchImpl, now });
    assert.notEqual(first.url, second.url); assert.equal(calls, 2);
    assert(!JSON.stringify(first).includes(config.conectaRhReadToken));
    await assert.rejects(() => resolveConectaEvidence(db, { ...input, collaboratorId: 'foreign' }, { config, fetchImpl, now }), error => error.statusCode === 404);
    await assert.rejects(() => resolveConectaEvidence(db, { ...input, revision: 2 }, { config, fetchImpl, now }), error => error.statusCode === 409);
    assert.equal(calls, 2);
  });

  await t.test('recusa comprovante clínico, revogado, link vencido ou resposta incompatível sem expor erros da origem', async () => {
    const input = { collaboratorId: 'mapped', itemId, revision: 3 };
    let calls = 0;
    const neverFetch = async () => { calls++; throw new Error('secret-internal-url'); };
    for (const [change, statusCode] of [[{ typeCode: 'ASO' }, 403], [{ typeCode: 'TOXICOLOGICO' }, 403], [{ status: 'REVOKED' }, 410], [{ evidence: null }, 404]]) {
      await db.conectaRhAggregate.update({ where: { id: row.id }, data: { data: { ...data, ...change } } });
      assert.equal((await getConectaComplianceBatch(db, { collaboratorIds: ['mapped'], date: '2026-11-17' }, { companyId, now })).collaborators[0].items[0].evidence, null);
      await assert.rejects(() => resolveConectaEvidence(db, input, { config, fetchImpl: neverFetch, now }), error => error.statusCode === statusCode);
    }
    assert.equal(calls, 0);
    await db.conectaRhAggregate.update({ where: { id: row.id }, data: { data } });
    for (const body of [
      { id: evidence.id, version: evidence.version, url: 'https://files.example.test/a.pdf', expiresAt: '2026-11-17T11:59:00Z' },
      { id: evidence.id, version: randomUUID(), url: 'https://files.example.test/a.pdf', expiresAt: '2026-11-17T12:05:00Z' },
      { id: evidence.id, version: evidence.version, url: 'https://files.example.test/a.pdf', expiresAt: '2099-01-01T12:00:00Z' },
      { id: evidence.id, version: evidence.version, url: 'javascript:alert(1)', expiresAt: '2026-11-17T12:05:00Z' }
    ]) await assert.rejects(() => resolveConectaEvidence(db, input, { config, now, fetchImpl: async () => Response.json(body) }), error => error.statusCode === 502);
    await assert.rejects(() => resolveConectaEvidence(db, input, { config, now, fetchImpl: neverFetch }), error => error.statusCode === 502 && !error.message.includes('secret'));
    await assert.rejects(() => resolveConectaEvidence(db, input, { config, now, fetchImpl: async () => new Response(null, { status: 410 }) }), error => error.statusCode === 410);
  });

  await t.test('HTTP exige acesso ao Efetivo, limita lote e valida datas', async () => {
    const app = express();
    app.use((req, _res, next) => { req.auth = { user: { accountType: 'INTERNAL', moduleRoles: req.headers['x-viewer'] ? ['efetivo:viewer'] : [] } }; next(); });
    app.use('/collaborators', createEfetivoRhRouter({ database: db, config, fetchImpl: async () => Response.json({
      id: evidence.id, version: evidence.version, url: 'https://files.example.test/a.pdf', expiresAt: new Date(Date.now() + 300_000).toISOString()
    }) }));
    app.use((error, _req, res, _next) => res.status(error.name === 'ZodError' ? 400 : error.statusCode || 500).json({ error: error.message, code: error.code }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/collaborators`;
    assert.equal((await fetch(base + '/rh?ids=mapped&date=2026-11-17')).status, 403);
    for (const query of ['ids=mapped&date=2026-11-17&endDate=2026-11-16', 'ids=mapped&date=2026-02-30', 'ids=' + Array(101).fill('mapped').join(',') + '&date=2026-11-17']) {
      assert.equal((await fetch(base + '/rh?' + query, { headers: { 'x-viewer': '1' } })).status, 400);
    }
    const response = await fetch(base + '/rh?ids=mapped,empty&date=2026-11-17', { headers: { 'x-viewer': '1' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).collaborators.length, 2);
    assert.equal((await fetch(base + `/mapped/rh/${itemId}/evidence?revision=3`)).status, 403);
    const file = await fetch(base + `/mapped/rh/${itemId}/evidence?revision=3`, { headers: { 'x-viewer': '1' } });
    assert.equal(file.status, 200); assert.equal(file.headers.get('cache-control'), 'no-store');
    assert.equal(file.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await file.json()).url, 'https://files.example.test/a.pdf');
  });
});
