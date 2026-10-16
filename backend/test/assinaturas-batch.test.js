import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { database } from './helpers/signature-batch-db.js';

import { getBatch, saveBatch, publishBatch } from '../src/lib/assinaturas/batch.js';
import { createDocument } from '../src/lib/assinaturas/document.js';
import { PDFDocument } from 'pdf-lib';

const signers = [
  { id: 'ana', name: 'Ana Souza', email: 'ana@example.com', position: 1 },
  { id: 'bia', name: 'Bia Souza', email: 'bia@example.com', position: 2 },
  { id: 'caio', name: 'Caio Souza', email: null, position: 3 }
];
const field = (signerId, pageNumber = 1) => ({ signerId, pageNumber, x: .1, y: .2, width: .2, height: .055 });
const configuration = () => ({ signers, documents: [
  { id: 'doc-1', fields: [field('ana'), field('caio')] },
  { id: 'doc-2', fields: [field('bia'), field('ana', 2)] }
] });


test('lote persiste apenas assinantes posicionados por documento e publica um convite por pessoa após commit', async () => {
  const db = database();
  const saved = await saveBatch(db.client, 'batch-1', 'owner', configuration());
  assert.deepEqual(saved.documents.map(document => document.signers.map(signer => signer.batchSignerId)), [['ana', 'caio'], ['ana', 'bia']]);
  assert.deepEqual(saved.documents[1].signers.map(signer => signer.position), [1, 2]);
  assert.equal(saved.documents[1].fields.find(row => row.pageNumber === 2).pageWidthPt, 612);
  const queued = [];
  await publishBatch(db.client, 'batch-1', 'owner', { expiresInDays: 15 }, {
    loadSource: async () => {}, deliverInvites: async (_client, groupId) => {
      assert.equal(db.inTransaction, false);
      const members = db.state.documents.flatMap(document => document.signers.filter(signer => signer.groupInviteId === groupId).map(signer => ({ signer, document })));
      if (members[0].signer.email) queued.push([members[0].signer.email, members.map(member => member.document.id)]);
    }
  });
  assert.deepEqual(queued, [['ana@example.com', ['doc-1', 'doc-2']], ['bia@example.com', ['doc-2']]]);
  const persisted = db.state.documents.flatMap(document => document.signers);
  assert.equal(db.state.groups.length, 3);
  assert.equal(new Set(db.state.groups.map(group => group.tokenHash)).size, 3);
  assert.ok(persisted.every(signer => signer.tokenHash === null));
  assert.equal(persisted[0].groupInviteId, persisted[2].groupInviteId);
  assert.equal(persisted.find(signer => !signer.email).emailStatus, 'NAO_APLICAVEL');
  const loaded = await getBatch(db.client, 'batch-1', 'owner');
  assert.equal(loaded.documents[0].signers[0].tokenHash, undefined, 'segredos não saem no payload do proprietário');
});

test('lote valida todas as páginas, documentos e assinantes antes de salvar', async () => {
  for (const invalid of [
    { ...configuration(), documents: [{ id: 'doc-1', fields: [] }, { id: 'foreign', fields: [] }] },
    { ...configuration(), documents: [{ id: 'doc-1', fields: [] }, { id: 'doc-1', fields: [] }] },
    { ...configuration(), documents: [{ id: 'doc-1', fields: [] }, { id: 'doc-2', fields: [field('outsider')] }] },
    { ...configuration(), documents: [{ id: 'doc-1', fields: [] }, { id: 'doc-2', fields: [field('ana', 3)] }] },
    { ...configuration(), signers: [signers[0], { ...signers[1], email: 'ANA@example.com' }] }
  ]) {
    const db = database();
    await assert.rejects(() => saveBatch(db.client, 'batch-1', 'owner', invalid));
    assert.equal(db.state.audits.length, 0);
    assert.deepEqual(db.state.documents.map(document => document.signers), [[], []]);
  }
});

test('assinante sem campo em todo o lote ou documento vazio impede qualquer publicação e e-mail', async () => {
  for (const input of [
    { ...configuration(), signers: [...signers, { id: 'unused', name: 'Sem campo', email: null, position: 4 }] },
    { ...configuration(), documents: [{ id: 'doc-1', fields: [field('ana'), field('bia'), field('caio')] }, { id: 'doc-2', fields: [] }] }
  ]) {
    const db = database();
    await saveBatch(db.client, 'batch-1', 'owner', input);
    let queued = false;
    await assert.rejects(() => publishBatch(db.client, 'batch-1', 'owner', { expiresInDays: 15 }, { loadSource: async () => {}, deliverInvites: async () => { queued = true; } }), error => error.statusCode === 400 && error.issues.length > 0);
    assert.equal(queued, false);
    assert.ok(db.state.documents.every(document => document.status === 'RASCUNHO'));
    assert.ok(db.state.documents.flatMap(document => document.signers).every(signer => !signer.tokenHash));
  }
});

test('edição de lote mantém campos de outros assinantes e permite remover o último assinante', async () => {
  const db = database();
  await saveBatch(db.client, 'batch-1', 'owner', configuration());
  const next = configuration();
  next.signers = signers.slice(0, 2);
  next.documents[0].fields = [field('ana')];
  await saveBatch(db.client, 'batch-1', 'owner', next);
  assert.equal(db.state.documents[1].fields.length, 2);
  await saveBatch(db.client, 'batch-1', 'owner', { signers: [], documents: next.documents.map(document => ({ id: document.id, fields: [] })) });
  assert.deepEqual(db.state.batch.signers, []);
  assert.ok(db.state.documents.every(document => document.signers.length === 0));
});

test('falha ao emitir convites no segundo documento reverte todo o lote sem enviar e-mails', async () => {
  const db = database();
  await saveBatch(db.client, 'batch-1', 'owner', configuration());
  const update = db.client.signatureDocumentSigner.update;
  db.client.signatureDocumentSigner.update = async args => {
    if (db.state.documents[1].signers.some(signer => signer.id === args.where.id)) throw new Error('Falha no banco');
    return update(args);
  };
  let sent = false;
  await assert.rejects(() => publishBatch(db.client, 'batch-1', 'owner', { expiresInDays: 15 }, {
    loadSource: async () => {}, deliverInvites: async () => { sent = true; }
  }), /Falha no banco/);
  assert.equal(sent, false);
  assert.ok(db.state.documents.every(document => document.status === 'RASCUNHO'));
  assert.ok(db.state.documents.flatMap(document => document.signers).every(signer => !signer.tokenHash));
});

test('PDF ilegível impede publicação; falha de e-mail após commit preserva convites para o job', async () => {
  const db = database();
  await saveBatch(db.client, 'batch-1', 'owner', configuration());
  await assert.rejects(() => publishBatch(db.client, 'batch-1', 'owner', { expiresInDays: 15 }, {
    loadSource: async document => { if (document.id === 'doc-2') throw new Error('Integridade inválida'); }
  }), /Integridade inválida/);
  assert.ok(db.state.documents.every(document => document.status === 'RASCUNHO'));
  await publishBatch(db.client, 'batch-1', 'owner', { expiresInDays: 15 }, {
    loadSource: async () => {}, deliverInvites: async () => { throw new Error('SMTP indisponível'); }
  });
  assert.ok(db.state.documents.every(document => document.status === 'AGUARDANDO_ASSINATURAS'));
  assert.equal(db.state.groups.filter(group => group.emailStatus === 'PENDENTE').length, 2);
});

test('consulta, configuração, publicação e upload negam lote de outro proprietário', async () => {
  const db = database();
  await assert.rejects(() => getBatch(db.client, 'batch-1', 'other'), error => error.statusCode === 404);
  await assert.rejects(() => saveBatch(db.client, 'batch-1', 'other', configuration()), error => error.statusCode === 404);
  await assert.rejects(() => publishBatch(db.client, 'batch-1', 'other', { expiresInDays: 15 }), error => error.statusCode === 404);
  const pdf = await PDFDocument.create(); pdf.addPage();
  const pdfBytes = Buffer.from(await pdf.save());
  let removed = false;
  await assert.rejects(() => createDocument(db.client, { ownerUserId: 'other', requesterNameSnapshot: 'Outro', fileName: 'teste.pdf', pdfBytes, batchId: 'batch-1' }, {
    storeSourcePdf: async () => 'Assinaturas/Documentos/teste.pdf', removeStoredPdf: async () => { removed = true; }
  }), error => error.statusCode === 404);
  assert.equal(removed, true);
});

test('upload mantém a ordem do lote e recusa inclusão após publicação', async () => {
  const db = database();
  const pdf = await PDFDocument.create(); pdf.addPage();
  const input = { ownerUserId: 'owner', requesterNameSnapshot: 'Dono', fileName: 'teste.pdf', pdfBytes: Buffer.from(await pdf.save()), batchId: 'batch-1' };
  const dependencies = { storeSourcePdf: async () => 'Assinaturas/Documentos/teste.pdf', removeStoredPdf: async () => {} };
  const uploaded = await createDocument(db.client, input, dependencies);
  assert.equal(uploaded.batchPosition, 2);
  db.state.documents[0].status = 'AGUARDANDO_ASSINATURAS';
  await assert.rejects(() => createDocument(db.client, input, dependencies), error => error.statusCode === 409);
});

test('migração preserva documentos existentes e remove lotes ao excluir o proprietário', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE "User" ("id" TEXT PRIMARY KEY); CREATE TABLE "SignatureDocument" ("id" TEXT PRIMARY KEY); CREATE TABLE "SignatureDocumentSigner" ("id" TEXT PRIMARY KEY); INSERT INTO "User" VALUES (\'owner\'); INSERT INTO "SignatureDocument" VALUES (\'existing\');');
    await db.exec(await fs.readFile(new URL('../prisma/migrations/20261016120000_signature_document_batches/migration.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await db.query('SELECT "batchId" FROM "SignatureDocument"')).rows, [{ batchId: null }]);
    await db.exec('INSERT INTO "SignatureDocumentBatch" ("id", "ownerUserId", "updatedAt") VALUES (\'batch\', \'owner\', NOW()); UPDATE "SignatureDocument" SET "batchId" = \'batch\'; DELETE FROM "User" WHERE "id" = \'owner\';');
    assert.equal((await db.query('SELECT * FROM "SignatureDocumentBatch"')).rows.length, 0);
    assert.deepEqual((await db.query('SELECT "batchId" FROM "SignatureDocument"')).rows, [{ batchId: null }]);
  } finally { await db.close(); }
});
