import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  documentForOwnerOrThrow,
  ownerListWhere,
  requireAssinaturasAccess
} from '../src/lib/assinaturas/access.js';

function invokeAccess(user) {
  let nextCalled = false;
  let statusCode = null;
  let body = null;
  const req = { auth: { user } };
  const res = {
    status(value) {
      statusCode = value;
      return this;
    },
    json(value) {
      body = value;
      return this;
    }
  };

  requireAssinaturasAccess(req, res, () => {
    nextCalled = true;
  });

  return { nextCalled, statusCode, body };
}

test('usuário sem assinaturas:user recebe 403', () => {
  const result = invokeAccess({ accountType: 'INTERNAL', moduleRoles: [] });

  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 403);
  assert.deepEqual(result.body, { error: 'Acesso restrito ao módulo de Assinaturas.' });
});

test('usuário com assinaturas:user segue para a rota', () => {
  const result = invokeAccess({ accountType: 'INTERNAL', moduleRoles: ['assinaturas:user'] });

  assert.equal(result.nextCalled, true);
  assert.equal(result.statusCode, null);
  assert.equal(result.body, null);
});

test('conta ADMIN sem assinaturas:user não recebe bypass', () => {
  const result = invokeAccess({ accountType: 'ADMIN', role: 'MANAGER', moduleRoles: [] });

  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 403);
});

test('ownerListWhere sempre restringe proprietário e documentos excluídos', () => {
  assert.deepEqual(ownerListWhere(' user-1 '), {
    ownerUserId: 'user-1',
    deletedAt: null
  });
});

test('owner helpers lançam quando o proprietário está ausente', async () => {
  assert.throws(() => ownerListWhere(undefined), TypeError);
  await assert.rejects(
    () => documentForOwnerOrThrow({ signatureDocument: {} }, 'document-1', null),
    TypeError
  );
});

test('documento órfão ou de outro proprietário responde como não encontrado', async () => {
  const calls = [];
  const client = {
    signatureDocument: {
      async findFirst(args) {
        calls.push(args);
        return null;
      }
    }
  };

  await assert.rejects(
    () => documentForOwnerOrThrow(client, 'document-1', 'user-1'),
    error => error?.statusCode === 404 && error?.message === 'Documento não encontrado.'
  );
  assert.deepEqual(calls[0].where, {
    id: 'document-1',
    ownerUserId: 'user-1',
    deletedAt: null
  });
});

test('dono diferente recebe 404 e a consulta nunca busca apenas pelo id', async () => {
  const documentA = { id: 'document-1', ownerUserId: 'user-a', deletedAt: null };
  const calls = [];
  const client = {
    signatureDocument: {
      async findFirst(args) {
        calls.push(args);
        return args.where.ownerUserId === documentA.ownerUserId ? documentA : null;
      }
    }
  };

  await assert.rejects(
    () => documentForOwnerOrThrow(client, documentA.id, 'user-b'),
    error => error?.statusCode === 404 && error?.statusCode !== 403
  );
  assert.deepEqual(calls[0].where, {
    id: documentA.id,
    ownerUserId: 'user-b',
    deletedAt: null
  });
});

test('matriz de rotas por documento aplica owner check inclusive em preview e downloads', async () => {
  const source = await fs.readFile(new URL('../src/routes/resources/assinaturas.js', import.meta.url), 'utf8');
  const routePatterns = [
    /router\.get\('\/documentos\/:id'.*?getDocument\(prisma, req\.params\.id, ownerId\(req\)\)/s,
    /router\.get\('\/documentos\/:id\/pdf'.*?documentForOwnerOrThrow\(prisma, req\.params\.id, ownerId\(req\)\)/s,
    /router\.get\('\/documentos\/:id\/pdf-final'.*?documentForOwnerOrThrow\(prisma, req\.params\.id, ownerId\(req\)\)/s,
    /router\.get\('\/documentos\/:id\/paginas\/:n\.png'.*?documentForOwnerOrThrow\(prisma, req\.params\.id, ownerId\(req\)\)/s,
    /router\.patch\('\/documentos\/:id'.*?documentForOwnerOrThrow\(prisma, req\.params\.id, ownerId\(req\)\)/s,
    /router\.put\('\/documentos\/:id\/assinantes'.*?documentForOwnerOrThrow\(prisma, req\.params\.id, ownerId\(req\)\)/s,
    /router\.put\('\/documentos\/:id\/campos'.*?documentForOwnerOrThrow\(prisma, req\.params\.id, ownerId\(req\), \{/s,
    /router\.post\('\/documentos\/:id\/publicar'.*?publishDocument\(prisma, req\.params\.id, ownerId\(req\)/s,
    /router\.post\('\/documentos\/:id\/despublicar'.*?unpublishDocument\(prisma, req\.params\.id, ownerId\(req\)/s,
    /router\.get\('\/documentos\/:id\/assinantes\/:signerId\/link'.*?documentForOwnerOrThrow\(prisma, req\.params\.id, ownerId\(req\), \{/s
  ];

  for (const pattern of routePatterns) assert.match(source, pattern);
  assert.match(source, /document\.signers\.find\(item => item\.id === req\.params\.signerId\)/);
});
