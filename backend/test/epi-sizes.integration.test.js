import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import express from 'express';
import { z } from 'zod';
import epiRouter from '../src/routes/resources/epis.js';
import prisma from '../src/lib/prisma.js';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';

test('EPI HTTP + PostgreSQL: tamanhos disponíveis, seleção obrigatória e histórico de entregas', { timeout: 120_000 }, async t => {
  const database = await apiSimulationDatabase();
  const { client, db } = database;
  t.after(() => database.close());
  const stub = (target, method, implementation) => {
    const previous = target[method];
    target[method] = implementation;
    t.after(() => { target[method] = previous; });
  };
  for (const model of ['userSession', 'collaborator', 'epiCatalogItem', 'epiRecord', 'epiSignatureRequest', 'epiSignatureRequestAuditLog']) {
    for (const method of ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findMany', 'create', 'update', 'upsert', 'updateMany']) {
      stub(prisma[model], method, (...args) => client[model][method](...args));
    }
  }
  stub(prisma, '$transaction', (...args) => client.$transaction(...args));
  const role = await client.jobRole.create({ data: { name: 'Operador', normalizedKey: 'operador' } });
  const collaborator = await client.collaborator.create({ data: {
    code: 'epi-sizes', name: 'Colaborador de teste', jobRoleId: role.id
  } });
  const user = await client.user.create({ data: {
    username: 'epi-sizes', name: 'Técnico', passwordHash: 'synthetic', role: 'COLLABORATOR', accountType: 'INTERNAL',
    moduleRoles: { create: { module: 'EPI', role: 'EPI_TECHNICIAN' } }
  } });
  const token = 'epi-sizes-test-token';
  await client.userSession.create({ data: {
    userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 600_000)
  } });

  // Apply the actual additive migration over a legacy catalog and delivery.
  await db.exec('ALTER TABLE "EpiCatalogItem" DROP COLUMN "hasSizes", DROP COLUMN "sizes"; ALTER TABLE "EpiRecord" DROP COLUMN "size";');
  await db.query('INSERT INTO "EpiCatalogItem" (id, name, ca, "updatedAt") VALUES ($1, $2, $3, NOW())', ['legacy-item', 'Capacete antigo', '']);
  await db.query('INSERT INTO "EpiRecord" (id, "collaboratorId", "catalogItemId", "epiName", ca, "lendDate", "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
    ['legacy-record', collaborator.id, 'legacy-item', 'Capacete antigo', '']);
  await db.exec(await readFile(new URL('../prisma/migrations/20261116140000_epi_item_sizes/migration.sql', import.meta.url), 'utf8'));
  const legacyItem = await client.epiCatalogItem.findUniqueOrThrow({ where: { id: 'legacy-item' } });
  assert.equal(legacyItem.hasSizes, false);
  assert.deepEqual(legacyItem.sizes, []);
  assert.equal((await client.epiRecord.findUniqueOrThrow({ where: { id: 'legacy-record' } })).size, null);

  const app = express();
  app.use(express.json());
  app.use('/epi', epiRouter);
  app.use((error, _req, res, _next) => {
    res.status(error instanceof z.ZodError ? 400 : error.statusCode || error.status || 500)
      .json({ error: error.message });
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
    return { status: response.status, data: await response.json() };
  };
  const saveCatalog = (id, body) => request(`/catalog/${id}`, body, 'PUT');
  const deliveries = `/collaborators/${collaborator.id}/records`;
  const delivery = { epiName: 'Camisa', quantity: 3, lendDate: '16/11/2026' };

  const defaults = await request('/catalog', { name: 'Camisa', hasSizes: true });
  assert.equal(defaults.status, 201, JSON.stringify(defaults.data));
  assert.deepEqual(defaults.data.sizes, ['P', 'M', 'G', 'GG', 'XG', 'Especial']);
  const itemId = defaults.data.id;
  assert.equal((await saveCatalog(itemId, { name: 'Camisa de segurança' })).status, 200);
  assert.deepEqual((await request('/catalog')).data.find(item => item.id === itemId).sizes, defaults.data.sizes);
  for (const sizes of [[], ['P', 'p'], ['  '], ['A'.repeat(41)]]) {
    assert.equal((await saveCatalog(itemId, { hasSizes: true, sizes })).status, 400);
  }
  assert.equal((await saveCatalog(itemId, { sizes: ['P', 'M', 'G', '  42  '] })).status, 200);

  // Both a catalog id and the existing name/CA lookup enforce size selection.
  for (const size of [undefined, null, '', 'XXXL']) {
    const result = await request(deliveries, { ...delivery, catalogItemId: itemId, size });
    assert.equal(result.status, 400, JSON.stringify(result.data));
  }
  assert.equal((await request(deliveries, { ...delivery, epiName: 'Camisa de segurança' })).status, 400);
  const delivered = await request(deliveries, { ...delivery, catalogItemId: itemId, size: '42' });
  assert.equal(delivered.status, 201, JSON.stringify(delivered.data));
  assert.equal(delivered.data.size, '42');
  const recordId = delivered.data.id;
  const editRecord = body => request(`/records/${recordId}`, body, 'PUT');
  assert.equal((await editRecord({ size: 'P' })).status, 200);
  assert.equal((await editRecord({ size: 'XXXL' })).status, 400);
  assert.equal((await editRecord({ size: null })).status, 400);
  assert.equal((await editRecord({ size: '42' })).status, 200);
  assert.equal((await client.epiRecord.findUniqueOrThrow({ where: { id: recordId } })).quantity, 3);

  // Changing to another item requires a fresh valid selection, even when it offers the same size.
  const other = await request('/catalog', { name: 'Bota', hasSizes: true, sizes: ['42', '43'] });
  assert.equal((await editRecord({ catalogItemId: other.data.id })).status, 400);
  assert.equal((await editRecord({ catalogItemId: other.data.id, size: '43' })).data.size, '43');
  const plain = await request('/catalog', { name: 'Óculos' });
  assert.equal(plain.data.hasSizes, false);
  assert.deepEqual(plain.data.sizes, []);
  assert.equal((await editRecord({ catalogItemId: plain.data.id })).data.size, null);
  const plainDelivery = await request(deliveries, { epiName: 'Óculos', lendDate: delivery.lendDate, catalogItemId: plain.data.id });
  assert.equal(plainDelivery.status, 201);
  assert.equal(plainDelivery.data.size, null);
  assert.equal(plainDelivery.data.quantity, 1);
  assert.equal((await editRecord({ catalogItemId: itemId, size: '42' })).data.size, '42');

  // Catalog changes and returns preserve the size originally delivered.
  await saveCatalog(itemId, { hasSizes: false });
  const unsignedReturn = await editRecord({ devolutionDate: '17/11/2026' });
  assert.equal(unsignedReturn.status, 200);
  assert.equal(unsignedReturn.data.size, '42');
  assert.equal(unsignedReturn.data.quantity, 3);
  await client.epiRecord.update({ where: { id: recordId }, data: { devolutionDate: null } });
  await saveCatalog(itemId, { hasSizes: true, sizes: ['M'] });
  const list = await request('/collaborators');
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data[0].epiRecords.find(record => record.id === recordId).size, '42');
  const signature = await request(`/collaborators/${collaborator.id}/signature-requests`, { recordIds: [recordId] });
  assert.equal(signature.status, 201, JSON.stringify(signature.data));
  const publicRequest = await request(`/public-sign/${signature.data.token}`);
  assert.equal(publicRequest.status, 200, JSON.stringify(publicRequest.data));
  assert.equal(publicRequest.data.status, 'ACTIVE', JSON.stringify(publicRequest.data));
  assert.equal(publicRequest.data.records[0].size, '42');
  await client.epiSignatureRequest.update({ where: { id: signature.data.request.id }, data: { status: 'SIGNED' } });
  await client.epiRecord.update({ where: { id: recordId }, data: { signedAt: new Date() } });
  assert.equal((await editRecord({ size: 'M' })).status, 409);
  const signedReturn = await editRecord({ devolutionDate: '18/11/2026' });
  assert.equal(signedReturn.status, 200, JSON.stringify(signedReturn.data));
  assert.equal(signedReturn.data.record.size, '42');
  assert.equal(signedReturn.data.record.quantity, 3);
  assert.equal(signedReturn.data.record.returnSourceRecordId, recordId);
  assert.equal(signedReturn.data.record.pendingReturn, true);
  assert.equal((await request(`/public-sign/${signedReturn.data.token}`)).data.records[0].size, '42');
});
