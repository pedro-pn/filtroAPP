import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { PGlite } from '@electric-sql/pglite';
import { database } from './helpers/signature-batch-db.js';
import { publishBatch, saveBatch } from '../src/lib/assinaturas/batch.js';
import { decryptSignatureToken } from '../src/lib/signature-token.js';
import { recoverInviteLink, renewInvite, resolveInviteByToken, revokeInvite } from '../src/lib/assinaturas/invites.js';
import { confirmSignature, inviteDocumentOrThrow, loadInvite } from '../src/lib/assinaturas/signing.js';
import { sendGroupInviteEmail, processGroupInviteEmailQueue } from '../src/lib/assinaturas/group-notifications.js';
import { resendInviteEmail } from '../src/lib/assinaturas/notifications.js';
import { processDocumentFinalization } from '../src/lib/assinaturas/jobs.js';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const input = { signerName: 'Ana Souza', signatureImageDataUrl: image, privacyNoticeAccepted: true, privacyNoticeVersion: 'signature_avulsa_v1' };
const field = signerId => ({ signerId, pageNumber: 1, x: .1, y: .2, width: .2, height: .055 });
async function published({ extraSigner = false } = {}) {
  const db = database();
  const signers = [{ id: 'ana', name: 'Ana Souza', email: 'ana@example.com', position: 1 }];
  if (extraSigner) signers.push({ id: 'bia', name: 'Bia Souza', email: 'bia@example.com', position: 2 });
  await saveBatch(db.client, 'batch-1', 'owner', { signers, documents: [
    { id: 'doc-1', fields: [field('ana')] }, { id: 'doc-2', fields: [field('ana'), ...(extraSigner ? [field('bia')] : [])] }
  ] });
  await publishBatch(db.client, 'batch-1', 'owner', { expiresInDays: 15 }, { loadSource: async () => {}, deliverInvites: async () => {} });
  return { db, token: decryptSignatureToken(db.state.groups[0]) };
}

test('um link por pessoa reúne somente seus documentos, permite recuperar o mesmo link em cada PDF e bloqueia documento alheio', async () => {
  const { db, token } = await published({ extraSigner: true });
  assert.equal(db.state.groups.length, 2);
  const payload = await loadInvite(db.client, token);
  assert.deepEqual(payload.documents.map(document => document.id), ['doc-1', 'doc-2']);
  const other = await loadInvite(db.client, decryptSignatureToken(db.state.groups[1]));
  assert.deepEqual(other.documents.map(document => document.id), ['doc-2']);
  assert.equal(other.signer.name, 'Bia Souza');
  assert.ok(!JSON.stringify(payload).includes('bia@example.com'));
  const invite = await resolveInviteByToken(db.client, token);
  assert.throws(() => inviteDocumentOrThrow(invite, 'not-assigned'), error => error.statusCode === 404);
  assert.equal(inviteDocumentOrThrow(invite, 'doc-2').document.id, 'doc-2');
  const links = await Promise.all(db.state.documents.map(document => recoverInviteLink(db.client, document, document.signers[0], 'owner')));
  assert.equal(links[0].url, links[1].url);
  assert.equal(await resolveInviteByToken(db.client, 'f'.repeat(64)), null);
});

test('uma confirmação assina o conjunto atomicamente, preserva evidências e é idempotente', async () => {
  const { db, token } = await published();
  const scheduled = [];
  const now = new Date();
  const dependencies = { now, scheduleFinalization: callback => scheduled.push(callback) };
  const result = await confirmSignature(db.client, token, input, { ipAddress: '203.0.113.10', userAgent: 'Test' }, dependencies);
  assert.equal(result.documentStatus, 'FINALIZANDO');
  assert.ok(db.state.documents.every(document => document.status === 'FINALIZANDO'));
  for (const document of db.state.documents) {
    assert.equal(document.signers[0].status, 'ASSINADO');
    assert.equal(document.signers[0].signatureImageDataUrl, image);
    assert.equal(document.signers[0].signedAt.getTime(), now.getTime());
    assert.equal(document.signers[0].ipAddress, '203.0.113.10');
  }
  const audits = db.state.audits.length;
  await confirmSignature(db.client, token, input, {}, dependencies);
  assert.equal(db.state.audits.length, audits);
  assert.equal(scheduled.length, 2, 'cada PDF é finalizado de forma independente');
});

test('falha no segundo documento reverte assinaturas e finalizações de todo o conjunto', async () => {
  const { db, token } = await published();
  const update = db.client.signatureDocumentSigner.updateMany;
  db.client.signatureDocumentSigner.updateMany = args => {
    if (args.data.status === 'ASSINADO' && db.state.documents[1].signers.some(signer => signer.id === args.where.id)) throw new Error('Falha no segundo documento');
    return update(args);
  };
  let scheduled = false;
  await assert.rejects(() => confirmSignature(db.client, token, input, {}, { scheduleFinalization: () => { scheduled = true; } }), /Falha no segundo/);
  assert.ok(db.state.documents.every(document => document.status === 'AGUARDANDO_ASSINATURAS'));
  assert.ok(db.state.documents.every(document => document.signers[0].status === 'PENDENTE'));
  assert.equal(scheduled, false);
});

test('renovação substitui o link em todos os documentos; revogação retira somente o documento afetado', async () => {
  const { db, token } = await published();
  const signer = db.state.documents[1].signers[0];
  await db.client.$transaction(tx => renewInvite(tx, db.state.documents[1], signer, new Date(Date.now() + 86_400_000), { actorUserId: 'owner' }));
  assert.equal(await resolveInviteByToken(db.client, token), null);
  const renewedToken = decryptSignatureToken(db.state.groups[0]);
  assert.equal((await resolveInviteByToken(db.client, renewedToken)).members.length, 2);
  await revokeInvite(db.client, db.state.documents[1], signer);
  assert.deepEqual((await resolveInviteByToken(db.client, renewedToken)).members.map(member => member.documentId), ['doc-1']);
  await confirmSignature(db.client, renewedToken, input, {}, { scheduleFinalization() {} });
  assert.equal(db.state.documents[1].signers[0].status, 'REVOGADO');
});

test('convite expirado ou documento cancelado não recebe assinatura', async () => {
  const { db, token } = await published();
  db.state.groups[0].tokenExpiresAt = new Date(0);
  await assert.rejects(() => confirmSignature(db.client, token, input), error => error.statusCode === 410);
  db.state.groups[0].tokenExpiresAt = new Date(Date.now() + 86_400_000);
  db.state.documents[1].status = 'CANCELADO';
  assert.deepEqual((await loadInvite(db.client, token)).documents.map(document => document.id), ['doc-1']);
  assert.equal(db.state.documents[1].signers[0].status, 'PENDENTE');
});

test('e-mail agrupado envia uma vez, lista os documentos atribuídos e possui fila durável com revisão de claims antigos', async () => {
  const { db } = await published({ extraSigner: true });
  const messages = [];
  const dependencies = { mailer: async message => { messages.push(message); return { messageId: 'test' }; }, missingMailerConfig: [] };
  await Promise.all([sendGroupInviteEmail(db.client, db.state.groups[0].id, dependencies), sendGroupInviteEmail(db.client, db.state.groups[0].id, dependencies)]);
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /Contrato 1/);
  assert.match(messages[0].text, /Contrato 2/);
  assert.equal((messages[0].text.match(/#convite=/g) || []).length, 1);
  assert.ok(db.state.documents.every(document => document.signers[0].emailStatus === 'NAO_APLICAVEL'), 'a fila individual não envia duplicados');
  db.state.groups[1].emailStatus = 'EM_ENVIO';
  db.state.groups[1].emailClaimedAt = new Date(Date.now() - 3_600_000);
  await processGroupInviteEmailQueue(db.client, dependencies);
  assert.equal(db.state.groups[1].emailStatus, 'REVISAO_NECESSARIA');
  assert.equal(messages.length, 1);
});

test('reenvio a partir de qualquer documento reutiliza o link agrupado e falhas de entrega são retomadas', async () => {
  const { db, token } = await published();
  const document = db.state.documents[1];
  const group = db.state.groups[0];
  await sendGroupInviteEmail(db.client, group.id, { mailer: async () => { throw new Error('SMTP indisponível'); }, missingMailerConfig: [] });
  assert.equal(group.emailStatus, 'FALHOU');
  const messages = [];
  const dependencies = { mailer: async message => { messages.push(message); return { messageId: 'test' }; }, missingMailerConfig: [] };
  await processGroupInviteEmailQueue(db.client, { ...dependencies, now: new Date(Date.now() + 120_000) });
  assert.equal(group.emailStatus, 'ENVIADO');
  await resendInviteEmail(db.client, document, document.signers[0], dependencies);
  assert.equal(messages.length, 2);
  assert.ok(messages.every(message => message.text.includes(`#convite=${token}`)));
  assert.equal(db.state.groups.length, 1);
});

test('a assinatura única produz dois PDFs finais separados com validação própria', async t => {
  const { db, token } = await published();
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'group-signature-final-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  await confirmSignature(db.client, token, input, {}, { scheduleFinalization() {} });
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]); pdf.addPage([612, 792]);
  const bytes = Buffer.from(await pdf.save());
  for (const document of db.state.documents) {
    document.originalFileName = `${document.id}.pdf`;
    document.sourceDocumentHash = createHash('sha256').update(bytes).digest('hex');
    await processDocumentFinalization(db.client, document.id, { rootDir, loadSource: async () => bytes, deliverCompletion: async () => {} });
  }
  assert.ok(db.state.documents.every(document => document.status === 'CONCLUIDO'));
  assert.notEqual(db.state.documents[0].finalStoragePath, db.state.documents[1].finalStoragePath);
  assert.notEqual(db.state.documents[0].finalDocumentHash, db.state.documents[1].finalDocumentHash);
  assert.notEqual(db.state.documents[0].validationCode, db.state.documents[1].validationCode);
  for (const document of db.state.documents) assert.ok((await fs.readFile(path.join(rootDir, document.finalStoragePath))).length > bytes.length);
});

test('migração de convites agrupados mantém os convites individuais e as referências por documento', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE "User" ("id" TEXT PRIMARY KEY);');
    await db.exec(await fs.readFile(new URL('../prisma/migrations/20260828133000_add_assinaturas_tables/migration.sql', import.meta.url), 'utf8'));
    await db.exec(await fs.readFile(new URL('../prisma/migrations/20261016130000_grouped_signature_invites/migration.sql', import.meta.url), 'utf8'));
    const columns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'SignatureDocumentSigner'");
    assert.ok(columns.rows.some(row => row.column_name === 'tokenHash'));
    assert.ok(columns.rows.some(row => row.column_name === 'groupInviteId'));
  } finally { await db.close(); }
});
