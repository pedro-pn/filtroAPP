import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';

import app from '../src/app.js';
import env from '../src/config/env.js';
import prisma from '../src/lib/prisma.js';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';

test('compartilhamento por HTTP e PostgreSQL: seleção, visualização, edição, revogação e isolamento de lotes', async t => {
  const database = await apiSimulationDatabase();
  const { client, db } = database;
  t.after(() => database.close());
  // Exercita a migração efetivamente entregue, incluindo índices e cascatas.
  await db.exec('DROP TABLE "SignatureDocumentShare"; DROP TYPE "SignatureDocumentSharePermission";');
  await db.exec(await fs.readFile(new URL('../prisma/migrations/20261104120000_signature_document_sharing/migration.sql', import.meta.url), 'utf8'));

  const stub = (target, method, implementation) => {
    const previous = target[method];
    target[method] = implementation;
    t.after(() => { target[method] = previous; });
  };
  for (const model of ['user', 'userSession', 'signatureDocument', 'signatureDocumentShare', 'signatureDocumentSigner', 'signatureDocumentField', 'signatureDocumentAuditLog', 'signatureDocumentBatch']) {
    for (const method of ['findUnique', 'findFirst', 'findMany', 'create', 'update', 'upsert', 'delete', 'deleteMany', 'createMany', 'updateMany', 'count']) {
      stub(prisma[model], method, (...args) => client[model][method](...args));
    }
  }
  stub(prisma, '$transaction', (...args) => client.$transaction(...args));

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-sharing-'));
  const previousUploadDir = env.uploadDir;
  env.uploadDir = root;
  t.after(async () => { env.uploadDir = previousUploadDir; await fs.rm(root, { recursive: true, force: true }); });
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const bytes = Buffer.from(await pdf.save());
  const storagePath = 'Assinaturas/Documentos/source.pdf';
  await fs.mkdir(path.dirname(path.join(root, storagePath)), { recursive: true });
  await fs.writeFile(path.join(root, storagePath), bytes);
  const users = {};
  for (const name of ['owner', 'viewer', 'editor', 'outsider', 'without-module', 'inactive']) {
    users[name] = await client.user.create({ data: {
      username: name, name, email: `${name}@example.com`, passwordHash: 'test-only', role: 'COLLABORATOR',
      isActive: name !== 'inactive',
      ...(name !== 'without-module' ? { moduleRoles: { create: { module: 'ASSINATURAS', role: 'ASSINATURAS_USER' } } } : {})
    } });
    await client.userSession.create({ data: {
      userId: users[name].id, tokenHash: createHash('sha256').update(name).digest('hex'), expiresAt: new Date(Date.now() + 600_000)
    } });
  }
  const documentData = {
    ownerUserId: users.owner.id, requesterNameSnapshot: 'Proprietário', title: 'Contrato compartilhado',
    originalFileName: 'contrato.pdf', fileSizeBytes: bytes.length, pageCount: 1,
    pageDimensions: [{ page: 1, widthPt: 612, heightPt: 792, rotation: 0 }],
    sourceStoragePath: storagePath, sourceDocumentHash: createHash('sha256').update(bytes).digest('hex')
  };
  const document = await client.signatureDocument.create({ data: documentData });
  const batch = await client.signatureDocumentBatch.create({ data: { ownerUserId: users.owner.id } });
  const batchDocument = await client.signatureDocument.create({ data: { ...documentData, batchId: batch.id, title: 'PDF compartilhado do lote' } });
  const privateDocument = await client.signatureDocument.create({ data: { ...documentData, batchId: batch.id, title: 'PDF privado do lote' } });
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (suffix, actor = 'owner', method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assinaturas${suffix}`, {
      method, headers: { authorization: `Bearer ${actor}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, data };
  };
  const base = `/documentos/${document.id}`;
  const share = (actor, access, id = document.id) => request(`/documentos/${id}/compartilhamentos/${users[actor].id}`, 'owner', 'PUT', { permission: access });

  await t.test('só permite compartilhar com usuários ativos do módulo; busca é restrita ao proprietário', async () => {
    const candidates = await request(`${base}/usuarios-compartilhamento?q=editor`);
    assert.equal(candidates.status, 200);
    assert.deepEqual(candidates.data.map(user => user.id), [users.editor.id]);
    assert.deepEqual(Object.keys(candidates.data[0]).sort(), ['email', 'id', 'name', 'username']);
    const all = await request(`${base}/usuarios-compartilhamento`);
    assert.deepEqual(all.data.map(user => user.username).sort(), ['editor', 'outsider', 'viewer']);
    assert.equal((await request(`${base}/usuarios-compartilhamento`, 'outsider')).status, 404);
    for (const name of ['owner', 'inactive', 'without-module']) assert.equal((await share(name, 'VIEW')).status, 400);
    assert.equal((await share('viewer', 'ADMIN')).status, 400);
    assert.equal((await share('viewer', 'VIEW')).status, 200);
    assert.equal((await share('editor', 'EDIT')).status, 200);
    assert.equal((await client.signatureDocumentShare.count()), 2);
  });

  await t.test('visualizador lê detalhes, auditoria e PDF, sem executar nenhuma alteração ou obter links de assinatura', async () => {
    const detail = await request(base, 'viewer');
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.data.permissions, { isOwner: false, access: 'VIEW', canEdit: false });
    assert.equal(detail.data.shares, undefined);
    assert.equal((await request(`${base}/auditoria`, 'viewer')).status, 200);
    assert.deepEqual((await request(`${base}/pdf`, 'viewer')).data, bytes);
    for (const [suffix, method, body, expected] of [
      ['', 'PATCH', { title: 'Título indevido' }, 403],
      ['/assinantes', 'PUT', [{ name: 'Nome indevido', position: 1 }], 403],
      ['/campos', 'PUT', [], 403],
      ['/publicar', 'POST', { expiresInDays: 15 }, 404],
      ['/despublicar', 'POST', {}, 404],
      ['/cancelar', 'POST', {}, 404],
      ['/arquivar', 'POST', {}, 404],
      ['', 'DELETE', undefined, 404],
      ['/compartilhamentos', 'GET', undefined, 404],
      [`/compartilhamentos/${users.outsider.id}`, 'PUT', { permission: 'EDIT' }, 404],
      [`/compartilhamentos/${users.editor.id}`, 'DELETE', undefined, 404],
      ['/assinantes/fake/link', 'GET', undefined, 404]
    ]) assert.equal((await request(base + suffix, 'viewer', method, body)).status, expected, `${method} ${suffix}`);
    for (const suffix of ['', '/pdf', '/paginas/1.png', '/auditoria']) assert.equal((await request(base + suffix, 'outsider')).status, 404);
    assert.equal((await request(base, 'without-module')).status, 403);
  });

  await t.test('editor altera rascunho e campos; compartilhamentos e publicação permanecem com o dono', async () => {
    assert.equal((await request(base, 'editor', 'PATCH', { title: 'Contrato editado' })).status, 200);
    const signers = await request(`${base}/assinantes`, 'editor', 'PUT', [{ name: 'Ana Silva', position: 1 }]);
    assert.equal(signers.status, 200, JSON.stringify(signers.data));
    const signerId = signers.data.signers[0].id;
    const fields = [{ signerId, pageNumber: 1, x: .1, y: .2, width: .2, height: .055 }];
    assert.equal((await request(`${base}/campos`, 'editor', 'PUT', fields)).status, 200);
    assert.equal((await client.signatureDocumentField.count({ where: { documentId: document.id } })), 1);
    assert.equal((await request(`${base}/publicar`, 'editor', 'POST', { expiresInDays: 15 })).status, 404);
    assert.equal((await request(`${base}/compartilhamentos/${users.outsider.id}`, 'editor', 'PUT', { permission: 'VIEW' })).status, 404);
    const updated = await request(base, 'owner');
    assert.equal(updated.data.title, 'Contrato editado');
    assert.equal(updated.data.permissions.isOwner, true);
    await client.signatureDocument.update({ where: { id: document.id }, data: { status: 'CONCLUIDO', finalStoragePath: storagePath, finalDocumentHash: documentData.sourceDocumentHash } });
    assert.equal((await request(base, 'editor', 'PATCH', { title: 'Alteração depois de assinado' })).status, 409);
    assert.deepEqual((await request(`${base}/pdf-final`, 'viewer')).data, bytes);
    await client.signatureDocument.update({ where: { id: document.id }, data: { status: 'RASCUNHO' } });
  });

  await t.test('listagem e paginação mostram PDFs recebidos sem expor o lote ou outros documentos, mantendo filtros', async () => {
    assert.equal((await share('viewer', 'EDIT', batchDocument.id)).status, 200);
    const result = await request('/documentos?grouped=1', 'viewer');
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.deepEqual(new Set(result.data.items.map(item => item.id)), new Set([document.id, batchDocument.id]));
    assert.ok(result.data.items.every(item => !item.batchDocuments && item.permissions.isOwner === false));
    assert.equal((await request(`/lotes/${batch.id}`, 'viewer')).status, 404);
    assert.equal((await request(`/documentos/${privateDocument.id}`, 'viewer')).status, 404);
    assert.equal((await request(`/documentos/${batchDocument.id}`, 'viewer')).data.permissions.canEdit, true);
    assert.equal((await request(`/documentos/${batchDocument.id}/assinantes`, 'viewer', 'PUT', [{ name: 'Outro nome', position: 1 }])).status, 403);
    const ids = [];
    let cursor;
    do {
      const page = await request(`/documentos?grouped=1&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, 'viewer');
      assert.equal(page.status, 200);
      ids.push(...page.data.items.map(item => item.id));
      cursor = page.data.nextCursor;
    } while (cursor);
    assert.equal(ids.length, 2);
    assert.equal(new Set(ids).size, 2);
    assert.deepEqual((await request('/documentos?grouped=1&q=do%20lote', 'viewer')).data.items.map(item => item.id), [batchDocument.id]);
    assert.equal((await request('/documentos?grouped=1&q=privado', 'viewer')).data.items.length, 0);
    assert.equal((await request('/documentos?grouped=1&status=CONCLUIDO', 'viewer')).data.items.length, 0);
  });

  await t.test('mudança de permissão e revogação têm efeito na próxima requisição; documentos excluídos e órfãos ficam inacessíveis', async () => {
    assert.equal((await share('editor', 'VIEW')).status, 200);
    assert.equal((await request(base, 'editor', 'PATCH', { title: 'Tentativa' })).status, 403);
    assert.equal((await client.signatureDocumentShare.count({ where: { documentId: document.id } })), 2, 'upsert não duplica o compartilhamento');
    assert.equal((await request(`${base}/compartilhamentos/${users.viewer.id}`, 'owner', 'DELETE')).status, 204);
    for (const suffix of ['', '/pdf', '/pdf-final', '/paginas/1.png', '/auditoria']) assert.equal((await request(base + suffix, 'viewer')).status, 404);
    assert.equal((await request('/documentos?grouped=1', 'viewer')).data.items.length, 1);
    await client.moduleRole.deleteMany({ where: { userId: users.editor.id } });
    assert.equal((await request(base, 'editor')).status, 403);
    await client.moduleRole.create({ data: { userId: users.editor.id, module: 'ASSINATURAS', role: 'ASSINATURAS_USER' } });
    await client.user.update({ where: { id: users.editor.id }, data: { isActive: false } });
    assert.equal((await request(base, 'editor')).status, 401);
    await client.user.update({ where: { id: users.editor.id }, data: { isActive: true } });
    await client.signatureDocument.update({ where: { id: document.id }, data: { deletedAt: new Date() } });
    assert.equal((await request(base, 'editor')).status, 404);
    assert.equal((await request('/documentos', 'editor')).data.items.length, 0);
    await client.signatureDocument.update({ where: { id: document.id }, data: { deletedAt: null, ownerUserId: null } });
    assert.equal((await request(base, 'editor')).status, 404);
    assert.equal((await request('/documentos', 'editor')).data.items.length, 0);
    const audit = await client.signatureDocumentAuditLog.findMany({ where: { documentId: document.id } });
    assert.ok(audit.some(event => event.description?.includes('Compartilhamento com viewer')));
    assert.ok(audit.some(event => event.description?.includes('removido')));
    await client.user.delete({ where: { id: users.editor.id } });
    assert.equal(await client.signatureDocumentShare.count({ where: { userId: users.editor.id } }), 0);
    await client.signatureDocument.delete({ where: { id: batchDocument.id } });
    assert.equal(await client.signatureDocumentShare.count({ where: { documentId: batchDocument.id } }), 0);
  });
});
