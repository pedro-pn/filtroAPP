import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import express from 'express';
import { z } from 'zod';

import { receiveConectaEvent } from '../src/lib/conecta-rh/service.js';
import prisma from '../src/lib/prisma.js';
import epiRouter from '../src/routes/resources/epis.js';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';

test('EPI HTTP + Conecta: ativos e pré-admitidos de qualquer setor', { timeout: 120_000 }, async t => {
  const database = await apiSimulationDatabase();
  const { client } = database;
  t.after(() => database.close());
  for (const [model, methods] of Object.entries({
    userSession: ['findUnique'],
    collaborator: ['findUnique', 'findMany'],
    epiRecord: ['findMany']
  })) {
    for (const method of methods) {
      const previous = prisma[model][method];
      prisma[model][method] = (...args) => client[model][method](...args);
      t.after(() => { prisma[model][method] = previous; });
    }
  }
  const previousTransaction = prisma.$transaction;
  prisma.$transaction = (...args) => client.$transaction(...args);
  t.after(() => { prisma.$transaction = previousTransaction; });

  const companyId = randomUUID();
  const event = (aggregateType, data, revision = 1) => ({
    schemaVersion: '1.0', companyId, eventId: randomUUID(),
    eventType: `${aggregateType}.upserted`, aggregateType,
    aggregateId: aggregateType === 'employment' ? data.employmentId : data.id,
    revision, occurredAt: '2026-11-17T12:00:00Z', data
  });
  const receive = input => receiveConectaEvent(client, input, { companyId, idempotencyKey: input.eventId });
  const imported = [];
  for (const [sector, status] of [
    ['Administrativo', 'ACTIVE'], ['Financeiro', 'PRE_ADMISSION'], ['Operacional', 'ACTIVE']
  ]) {
    const roleId = randomUUID();
    const isOperational = sector === 'Operacional';
    assert.equal((await receive(event('job_role', {
      id: roleId, name: `Cargo ${sector}`, cbo: null, isActive: true, isOperational
    }))).status, 'APPLIED');
    const employment = {
      personId: randomUUID(), employmentId: randomUUID(), name: `Pessoa ${sector}`,
      cpf: null, registrationNumber: null, email: null, isOperational, status,
      admissionDate: status === 'ACTIVE' ? '2026-11-01' : null,
      terminationDate: null, currentJobRoleId: roleId
    };
    const input = event('employment', employment);
    assert.equal((await receive(input)).status, 'APPLIED');
    assert.equal((await receive(input)).status, 'APPLIED');
    const mapping = await client.conectaRhPerson.findUniqueOrThrow({
      where: { companyId_personId: { companyId, personId: employment.personId } }
    });
    imported.push({ id: mapping.collaboratorId, employment });
  }

  // O EPI também deve aceitar um cargo local que continue não operacional.
  const localRole = await client.jobRole.create({ data: {
    name: 'Assistente administrativo local', normalizedKey: 'assistente administrativo local', isOperational: false
  } });
  const localActive = await client.collaborator.create({ data: {
    code: 'local-active', name: 'Assistente local', jobRoleId: localRole.id
  } });
  await client.collaborator.create({ data: {
    code: 'local-inactive', name: 'Inativo local', jobRoleId: localRole.id, isActive: false
  } });

  const session = async (username, role, collaboratorId = null) => {
    const user = await client.user.create({ data: {
      username, name: username, passwordHash: 'synthetic', role: 'COLLABORATOR', accountType: 'INTERNAL',
      collaboratorId, moduleRoles: { create: { module: 'EPI', role } }
    } });
    const token = `${username}-test-token`;
    await client.userSession.create({ data: {
      userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 600_000)
    } });
    return token;
  };
  const technicianToken = await session('epi-all-sectors-technician', 'EPI_TECHNICIAN');
  const collaboratorToken = await session('epi-all-sectors-collaborator', 'EPI_COLLABORATOR', imported[0].id);
  const unlinkedToken = await session('epi-all-sectors-unlinked', 'EPI_COLLABORATOR');
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
  const request = async (path = '/collaborators', body, token = technicianToken) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/epi${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  };

  await t.test('lista todos os setores, sem exigir EPI prévio nem duplicar reenvios', async () => {
    const result = await request();
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.deepEqual(new Set(result.data.map(item => item.id)), new Set([...imported.map(item => item.id), localActive.id]));
    assert.deepEqual(result.data.map(item => item.name), ['Assistente local', 'Pessoa Administrativo', 'Pessoa Financeiro', 'Pessoa Operacional']);
    for (const item of result.data) {
      assert.equal(item.isActive, true);
      assert.deepEqual(item.epiRecords, []);
    }
    assert.equal(result.data.find(item => item.id === imported[1].id).rhStatus, 'PRE_ADMISSION');
    assert.equal(result.data.find(item => item.id === localActive.id).jobRole.isOperational, false);
    const source = await client.conectaRhAggregate.findFirstOrThrow({
      where: { aggregateType: 'employment', localId: imported[0].id }
    });
    assert.equal(source.data.isOperational, false);
  });

  await t.test('permite entrega e assinatura para ativo e pré-admitido fora do operacional', async () => {
    for (const { id } of [imported[0], imported[1], localActive]) {
      const delivered = await request(`/collaborators/${id}/records`, {
        epiName: 'Óculos de proteção', quantity: 1, lendDate: '17/11/2026'
      });
      assert.equal(delivered.status, 201, JSON.stringify(delivered.data));
      const signature = await request(`/collaborators/${id}/signature-requests`, { recordIds: [delivered.data.id] });
      assert.equal(signature.status, 201, JSON.stringify(signature.data));
      const listed = (await request()).data.find(item => item.id === id);
      assert.equal(listed.epiRecords[0].id, delivered.data.id);
      assert.equal(listed.epiRecords[0].signatureRequest.status, 'PENDING');
    }
    assert.equal((await client.jobRole.findUniqueOrThrow({ where: { id: localRole.id } })).isOperational, false);
  });

  await t.test('o perfil de colaborador continua vendo somente sua própria ficha', async () => {
    const result = await request('/collaborators', undefined, collaboratorToken);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.map(item => item.id), [imported[0].id]);
    assert.deepEqual((await request('/collaborators', undefined, unlinkedToken)).data, []);
    assert.equal((await request('/collaborators', undefined, '')).status, 401);
  });

  await t.test('desligamento e cancelamento retiram da listagem e preservam as entregas', async () => {
    await receive(event('employment', {
      ...imported[0].employment, status: 'TERMINATED', terminationDate: '2026-11-17'
    }, 2));
    await receive(event('employment', { ...imported[1].employment, status: 'CANCELLED' }, 2));
    const result = await request();
    assert.equal(result.status, 200);
    assert.deepEqual(new Set(result.data.map(item => item.id)), new Set([imported[2].id, localActive.id]));
    assert.deepEqual((await request('/collaborators', undefined, collaboratorToken)).data, []);
    assert.equal(await client.epiRecord.count({ where: { collaboratorId: { in: [imported[0].id, imported[1].id] } } }), 2);
  });

  await t.test('recontratação recupera a ficha da mesma pessoa sem duplicar o cadastro', async () => {
    await receive(event('employment', {
      ...imported[0].employment, employmentId: randomUUID(), admissionDate: '2026-11-17'
    }));
    const result = await request();
    assert.equal(result.status, 200);
    const rehired = result.data.filter(item => item.id === imported[0].id);
    assert.equal(rehired.length, 1);
    assert.equal(rehired[0].rhStatus, 'ACTIVE');
    assert.equal(rehired[0].epiRecords.length, 1);
    assert.equal(await client.conectaRhPerson.count(), 3);
  });
});
