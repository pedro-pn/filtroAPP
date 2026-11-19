import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import express from 'express';
import { z } from 'zod';
import epiRouter, { removeUnsignedEpiRecord } from '../src/routes/resources/epis.js';
import prisma from '../src/lib/prisma.js';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';

test('EPI cancellation: HTTP, link revocation and rollback with PostgreSQL', { timeout: 120_000 }, async t => {
  const database = await apiSimulationDatabase();
  const { client } = database;
  t.after(() => database.close());
  const stub = (target, method, implementation) => {
    const previous = target[method];
    target[method] = implementation;
    t.after(() => { target[method] = previous; });
  };
  for (const model of ['userSession', 'collaborator', 'epiRecord', 'epiSignatureRequest', 'epiSignatureRequestAuditLog']) {
    for (const method of ['findUnique', 'findUniqueOrThrow', 'findMany', 'create', 'updateMany', 'deleteMany']) {
      stub(prisma[model], method, (...args) => client[model][method](...args));
    }
  }
  stub(prisma, '$transaction', (...args) => client.$transaction(...args));

  const role = await client.jobRole.create({ data: { name: 'Operador', normalizedKey: 'operador' } });
  const collaborator = await client.collaborator.create({ data: {
    code: 'epi-cancellation', name: 'Colaborador', jobRoleId: role.id
  } });
  const user = await client.user.create({ data: {
    username: 'epi-cancellation', name: 'Técnico', passwordHash: 'synthetic', role: 'COLLABORATOR', accountType: 'INTERNAL',
    moduleRoles: { create: { module: 'EPI', role: 'EPI_TECHNICIAN' } }
  } });
  const token = 'epi-cancellation-test-token';
  await client.userSession.create({ data: {
    userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 600_000)
  } });

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
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  };
  const delivery = overrides => client.epiRecord.create({ data: {
    collaboratorId: collaborator.id, epiName: 'Luva', ca: '123', size: 'G', quantity: 2,
    lendDate: new Date('2026-11-18T12:00:00Z'), ...overrides
  } });
  const sign = records => request(`/collaborators/${collaborator.id}/signature-requests`, { recordIds: records.map(record => record.id) });
  const remove = record => request(`/records/${record.id}`, undefined, 'DELETE');

  await t.test('an unsigned delivery without a signature request can still be removed', async () => {
    const record = await delivery();
    assert.equal((await remove(record)).status, 204);
    assert.equal(await client.epiRecord.findUnique({ where: { id: record.id } }), null);
  });

  await t.test('cancelling one delivery revokes the entire link and preserves the other deliveries', async () => {
    const cancelled = await delivery();
    const remaining = await delivery({ epiName: 'Botina', size: '42' });
    const signature = await sign([cancelled, remaining]);
    assert.equal(signature.status, 201, JSON.stringify(signature.data));
    const publicPath = `/public-sign/${signature.data.token}`;
    assert.equal((await request(publicPath)).data.status, 'ACTIVE');

    assert.equal((await remove(cancelled)).status, 204);
    assert.equal(await client.epiRecord.findUnique({ where: { id: cancelled.id } }), null);
    const preserved = await client.epiRecord.findUniqueOrThrow({ where: { id: remaining.id } });
    assert.deepEqual(preserved, {
      ...remaining, signatureRequestId: signature.data.request.id,
      updatedAt: preserved.updatedAt
    });
    const expired = await request(publicPath);
    assert.equal(expired.data.status, 'EXPIRED');
    assert.deepEqual(expired.data.records, []);
    assert.equal((await request(`${publicPath}/pdf`)).status, 410);
    assert.equal((await request(`${publicPath}/confirm`, {})).status, 410);
    assert.equal((await client.epiSignatureRequest.findUniqueOrThrow({ where: { id: signature.data.request.id } })).status, 'EXPIRED');
    assert.ok(await client.epiSignatureRequestAuditLog.findFirst({ where: { requestId: signature.data.request.id, action: 'EXPIRED' } }));

    const replacement = await sign([remaining]);
    assert.equal(replacement.status, 201, JSON.stringify(replacement.data));
    assert.deepEqual((await request(`/public-sign/${replacement.data.token}`)).data.records.map(record => record.id), [remaining.id]);
  });

  await t.test('the last delivery and deliveries with expired requests can be cancelled', async () => {
    for (const status of ['ACTIVE', 'PENDING', 'EXPIRED']) {
      const record = await delivery();
      const signature = await sign([record]);
      if (status !== 'ACTIVE') {
        await client.epiSignatureRequest.update({ where: { id: signature.data.request.id }, data: {
          status, expiresAt: new Date(Date.now() - 60_000)
        } });
      }
      assert.equal((await remove(record)).status, 204);
      assert.equal((await request(`/public-sign/${signature.data.token}`)).data.status, 'EXPIRED');
    }
  });

  await t.test('signed evidence, signed requests and pending return revisions remain protected', async () => {
    for (const evidence of [{ signedAt: new Date() }, { signatureImageDataUrl: 'data:image/png;base64,evidence' }, { pendingReturn: true }]) {
      const record = await delivery(evidence);
      assert.equal((await remove(record)).status, 409);
      assert.deepEqual(await client.epiRecord.findUnique({ where: { id: record.id } }), record);
    }
    const record = await delivery();
    const signature = await sign([record]);
    await client.epiSignatureRequest.update({ where: { id: signature.data.request.id }, data: { status: 'SIGNED' } });
    assert.equal((await remove(record)).status, 409);
    assert.ok(await client.epiRecord.findUnique({ where: { id: record.id } }));
    assert.equal((await client.epiSignatureRequest.findUniqueOrThrow({ where: { id: signature.data.request.id } })).status, 'SIGNED');
  });

  await t.test('a changed signature request rolls back the deletion', async () => {
    const record = await delivery();
    const signature = await sign([record]);
    const auditCount = await client.epiSignatureRequestAuditLog.count();
    const racingClient = {
      $transaction: callback => client.$transaction(tx => callback({
        ...tx,
        epiSignatureRequest: { ...tx.epiSignatureRequest, updateMany: async () => ({ count: 0 }) }
      }))
    };
    await assert.rejects(removeUnsignedEpiRecord({ recordId: record.id, client: racingClient }), error => error.statusCode === 409);
    assert.ok(await client.epiRecord.findUnique({ where: { id: record.id } }));
    assert.equal((await client.epiSignatureRequest.findUniqueOrThrow({ where: { id: signature.data.request.id } })).status, 'PENDING');
    assert.equal(await client.epiSignatureRequestAuditLog.count(), auditCount);
  });
});

test('a concurrent signature or replacement request prevents EPI deletion', async () => {
  let revoked = false;
  const client = {
    $transaction: callback => callback({
      $queryRaw: async () => [],
      epiRecord: {
        findFirst: async () => null,
        findUniqueOrThrow: async () => ({ id: 'record', signedAt: null, signatureImageDataUrl: null, signatureRequestId: 'request' }),
        deleteMany: async ({ where }) => {
          assert.deepEqual(where, { id: 'record', signedAt: null, signatureImageDataUrl: null, signatureRequestId: 'request', pendingReturn: false });
          return { count: 0 };
        }
      },
      epiSignatureRequest: { updateMany: async () => { revoked = true; } }
    })
  };
  await assert.rejects(removeUnsignedEpiRecord({ recordId: 'record', client }), error => error.statusCode === 409);
  assert.equal(revoked, false);
});
