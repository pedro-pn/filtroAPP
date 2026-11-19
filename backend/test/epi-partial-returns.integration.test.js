import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import express from 'express';
import { z } from 'zod';
import epiRouter, { confirmPublicEpiSignatureRequest } from '../src/routes/resources/epis.js';
import prisma from '../src/lib/prisma.js';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';

const signatureImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6f7cAAAAASUVORK5CYII=';

test('EPI HTTP + PostgreSQL: devoluções parciais preservam a entrega, assinatura e saldo', { timeout: 120_000 }, async t => {
  const database = await apiSimulationDatabase();
  const { client, db } = database;
  t.after(() => database.close());
  for (const model of ['userSession', 'collaborator', 'epiCatalogItem', 'epiRecord', 'epiSignatureRequest', 'epiSignatureRequestAuditLog']) {
    for (const method of ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findMany', 'create', 'update', 'updateMany']) {
      const previous = prisma[model][method];
      prisma[model][method] = (...args) => client[model][method](...args);
      t.after(() => { prisma[model][method] = previous; });
    }
  }
  const previousTransaction = prisma.$transaction;
  prisma.$transaction = (...args) => client.$transaction(...args);
  t.after(() => { prisma.$transaction = previousTransaction; });
  const role = await client.jobRole.create({ data: { name: 'Operador', normalizedKey: 'operador' } });
  const collaborator = await client.collaborator.create({ data: { code: 'partial-returns', name: 'Colaborador de teste', jobRoleId: role.id } });
  const user = await client.user.create({ data: {
    username: 'partial-returns', name: 'Técnico', passwordHash: 'synthetic', role: 'COLLABORATOR', accountType: 'INTERNAL',
    moduleRoles: { create: { module: 'EPI', role: 'EPI_TECHNICIAN' } }
  } });
  const token = 'epi-partial-returns-test-token';
  await client.userSession.create({ data: {
    userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600_000)
  } });
  const delivery = (data = {}) => client.epiRecord.create({ data: {
    collaboratorId: collaborator.id, epiName: 'Luva', ca: '123', size: 'G', quantity: 5,
    lendDate: new Date('2026-11-01T12:00:00Z'), ...data
  } });
  const original = await delivery({ signedAt: new Date('2026-11-02T12:00:00Z'), signatureImageDataUrl });
  // Migra o índice real, preservando uma devolução completa legada.
  const legacy = await delivery({ quantity: 1, archivedAt: new Date() });
  const legacyReturn = await delivery({ quantity: 1, returnSourceRecordId: legacy.id, devolutionDate: new Date(), signedAt: new Date() });
  await db.exec('CREATE UNIQUE INDEX "EpiRecord_openReturnSourceRecordId_key" ON "EpiRecord"("returnSourceRecordId") WHERE "returnSourceRecordId" IS NOT NULL AND "archivedAt" IS NULL;');
  await db.exec(await readFile(new URL('../prisma/migrations/20261119160000_epi_partial_returns/migration.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../prisma/migrations/20261119150000_epi_signed_history_guard/migration.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await client.epiRecord.findUniqueOrThrow({ where: { id: legacyReturn.id } }), legacyReturn);

  const app = express();
  app.use(express.json());
  app.use('/epi', epiRouter);
  app.use((error, _req, res, _next) => {
    res.status(error instanceof z.ZodError ? 400 : error.statusCode || error.status || 500).json({ error: error.message });
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/epi${path}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  };
  const returnUnits = (id, quantity, devolutionDate = '19/11/2026') => request(`/records/${id}/returns`, { quantity, devolutionDate });
  const record = id => client.epiRecord.findUniqueOrThrow({ where: { id } });
  const listed = async id => {
    const result = await request('/collaborators');
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data[0].epiRecords.find(item => item.id === id);
  };
  // Usa a transação real de confirmação; apenas a geração do arquivo é isolada.
  const confirm = token => confirmPublicEpiSignatureRequest({
    token, client,
    body: { signerName: 'Colaborador de teste', signatureImageDataUrl, privacyNoticeAccepted: true, privacyNoticeVersion: 'signature_epi_v1' },
    pdfArtifactFactory: async () => ({})
  });

  await t.test('rejeita quantidade inválida, data inválida e valor acima do saldo sem criar registros', async () => {
    const count = await client.epiRecord.count();
    for (const quantity of [0, -1, 1.5, 6, '', null, 'abc', 1000]) {
      assert.equal((await returnUnits(original.id, quantity)).status, 400, String(quantity));
    }
    assert.equal((await returnUnits(original.id, 2, '31/02/2026')).status, 400);
    assert.equal((await returnUnits(original.id, 2, '31/10/2026')).status, 400);
    assert.equal(await client.epiRecord.count(), count);
    assert.equal(await client.epiSignatureRequest.count(), 0);
  });

  await t.test('devolve 2 de 5 e preserva as 3 restantes e a evidência original', async () => {
    const returned = await returnUnits(original.id, 2);
    assert.equal(returned.status, 201, JSON.stringify(returned.data));
    const revision = returned.data.record;
    assert.equal(revision.quantity, 2);
    assert.equal(revision.size, 'G');
    assert.equal(revision.returnSourceRecordId, original.id);
    assert.equal(revision.pendingReturn, true);
    assert.equal((await listed(original.id)).remainingQuantity, 5);
    assert.equal((await listed(original.id)).pendingReturnQuantity, 2);
    assert.equal((await request(`/public-sign/${returned.data.token}`)).data.records[0].quantity, 2);
    assert.equal((await returnUnits(original.id, 1)).status, 409);
    // O índice protege também inserts externos de uma segunda devolução pendente.
    await assert.rejects(delivery({ returnSourceRecordId: original.id, pendingReturn: true }), error => error.code === 'P2002');
    await confirm(returned.data.token);
    await confirm(returned.data.token); // Repetir a assinatura não baixa a quantidade outra vez.
    assert.deepEqual(await record(original.id), original);
    assert.equal((await record(revision.id)).pendingReturn, false);
    const balance = await listed(original.id);
    assert.equal(balance.returnedQuantity, 2);
    assert.equal(balance.remainingQuantity, 3);
    assert.equal(balance.pendingReturnQuantity, 0);
    assert.equal((await returnUnits(original.id, 4)).status, 400);
    assert.equal((await returnUnits(revision.id, 1)).status, 409);
    // Arquivar o recibo não devolve suas unidades ao saldo.
    assert.equal((await request(`/collaborators/${collaborator.id}/records/archive`, { recordIds: [revision.id] })).status, 200);
    assert.equal((await listed(original.id)).remainingQuantity, 3);
  });

  await t.test('reemite uma devolução expirada, soma devoluções sucessivas e encerra somente ao zerar', async () => {
    const expired = await returnUnits(original.id, 1);
    assert.equal(expired.status, 201, JSON.stringify(expired.data));
    await client.epiSignatureRequest.update({ where: { id: expired.data.record.signatureRequestId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const replacement = await returnUnits(original.id, 2);
    assert.equal(replacement.status, 201, JSON.stringify(replacement.data));
    assert.equal(replacement.data.record.id, expired.data.record.id);
    assert.equal(replacement.data.record.quantity, 2);
    assert.equal((await request(`/public-sign/${expired.data.token}`)).data.status, 'EXPIRED');
    await confirm(replacement.data.token);
    assert.equal((await record(original.id)).archivedAt, null);
    assert.equal((await listed(original.id)).remainingQuantity, 1);
    // O cliente anterior, que omite a quantidade, devolve apenas o saldo atual.
    const last = await request(`/records/${original.id}`, { devolutionDate: '19/11/2026' }, 'PUT');
    assert.equal(last.status, 200, JSON.stringify(last.data));
    assert.equal(last.data.record.quantity, 1);
    await confirm(last.data.token);
    const completed = await record(original.id);
    assert.ok(completed.archivedAt);
    assert.equal(completed.quantity, 5);
    assert.equal(completed.signatureImageDataUrl, original.signatureImageDataUrl);
    assert.deepEqual(completed.signedAt, original.signedAt);
    assert.equal((await listed(original.id)).remainingQuantity, 0);
    assert.equal((await returnUnits(original.id, 1)).status, 409);
    assert.equal((await returnUnits(legacy.id, 1)).status, 409);
  });

  await t.test('entrega sem assinatura permite devolução parcial e protege o vínculo de alterações e exclusões', async () => {
    const unsigned = await delivery();
    const pending = await returnUnits(unsigned.id, 2);
    assert.equal(pending.status, 201, JSON.stringify(pending.data));
    assert.equal((await request(`/records/${unsigned.id}`, { quantity: 1 }, 'PUT')).status, 409);
    assert.equal((await request(`/records/${unsigned.id}`, undefined, 'DELETE')).status, 409);
    await confirm(pending.data.token);
    assert.equal((await record(unsigned.id)).quantity, 5);
    assert.equal((await record(unsigned.id)).signedAt, null);
    assert.equal((await listed(unsigned.id)).remainingQuantity, 3);
    assert.equal((await request(`/records/${unsigned.id}`, { devolutionDate: '19/11/2026' }, 'PUT')).status, 409);
    assert.equal((await request(`/records/${unsigned.id}`, undefined, 'DELETE')).status, 409);
    const final = await returnUnits(unsigned.id, 3);
    assert.equal(final.status, 201, JSON.stringify(final.data));
    await confirm(final.data.token);
    assert.ok((await record(unsigned.id)).archivedAt);
  });

  await t.test('confirmação com saldo insuficiente reverte toda a assinatura', async () => {
    const source = await delivery();
    const pending = await returnUnits(source.id, 4);
    // Simula alteração externa posterior à criação do link.
    await client.epiRecord.update({ where: { id: source.id }, data: { quantity: 3 } });
    await assert.rejects(confirm(pending.data.token), error => error.statusCode === 409);
    assert.equal((await record(pending.data.record.id)).signedAt, null);
    assert.equal((await record(pending.data.record.id)).pendingReturn, true);
    assert.equal((await client.epiSignatureRequest.findUniqueOrThrow({ where: { id: pending.data.record.signatureRequestId } })).status, 'PENDING');
    assert.equal((await record(source.id)).archivedAt, null);
  });

  await t.test('pedidos simultâneos reservam somente uma devolução e devolução integral continua disponível', async () => {
    const source = await delivery({ quantity: 1 });
    const results = await Promise.all([returnUnits(source.id, 1), returnUnits(source.id, 1)]);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
    assert.equal(await client.epiRecord.count({ where: { returnSourceRecordId: source.id, pendingReturn: true } }), 1);
    await confirm(results.find(result => result.status === 201).data.token);
    assert.ok((await record(source.id)).archivedAt);
    assert.equal((await listed(source.id)).remainingQuantity, 0);
  });
});
