import assert from 'node:assert/strict';
import test from 'node:test';
import { database } from './helpers/signature-batch-db.js';
import { batchInviteAction, getBatch, publishBatch, saveBatch } from '../src/lib/assinaturas/batch.js';
import { issueInvites, recoverInviteLink, resolveInviteByToken } from '../src/lib/assinaturas/invites.js';
import { assertInviteUsable, confirmSignature } from '../src/lib/assinaturas/signing.js';

const field = signerId => ({ signerId, pageNumber: 1, x: .1, y: .2, width: .2, height: .055 });
async function prepared() {
  const db = database();
  await saveBatch(db.client, 'batch-1', 'owner', { signers: [
    { id: 'ana', name: 'Ana Souza', email: 'ana@example.com', position: 1 },
    { id: 'bia', name: 'Bia Souza', email: 'bia@example.com', position: 2 }
  ], documents: [{ id: 'doc-1', fields: [field('ana'), field('bia')] }, { id: 'doc-2', fields: [field('ana')] }] });
  return db;
}

test('acompanhamento centraliza pessoas e mantém a participação e o status de cada documento', async () => {
  const db = await prepared();
  await publishBatch(db.client, 'batch-1', 'owner', { expiresInDays: 15 }, { loadSource: async () => {}, deliverInvites: async () => {} });
  db.state.documents[1].signers[0].status = 'ASSINADO';
  db.state.documents[1].signers[0].signedAt = new Date();
  db.state.documents[1].status = 'CONCLUIDO';
  const batch = await getBatch(db.client, 'batch-1', 'owner');
  assert.equal(batch.documents.length, 2);
  assert.equal(batch.invitations.length, 2);
  assert.deepEqual(batch.invitations[0].documents.map(document => document.id), ['doc-1', 'doc-2']);
  assert.deepEqual(batch.invitations[1].documents.map(document => document.id), ['doc-1']);
  assert.equal(batch.invitations[0].status, 'PENDENTE');
  assert.equal(batch.invitations[0].signedAt, null);
  assert.ok(!JSON.stringify(batch).includes('tokenEncrypted'));
  const copied = await batchInviteAction(db.client, 'batch-1', 'ana', 'owner', 'link');
  assert.equal(copied.url, (await recoverInviteLink(db.client, db.state.documents[1], db.state.documents[1].signers[0], 'owner')).url);
  await assert.rejects(() => batchInviteAction(db.client, 'batch-1', 'ana', 'other', 'link'), error => error.statusCode === 404);
  db.state.documents[0].signers[0].status = 'ASSINADO';
  db.state.documents[0].signers[0].signedAt = new Date('2026-10-14T15:00:00Z');
  db.state.documents[1].signers[0].signedAt = new Date('2026-10-16T15:00:00Z');
  assert.equal((await getBatch(db.client, 'batch-1', 'owner')).invitations[0].signedAt.toISOString(), '2026-10-16T15:00:00.000Z');
});

test('lotes antigos consolidam links sem perder aliases, assinaturas ou a restrição de documentos', async () => {
  const db = await prepared();
  const old = [];
  for (const document of db.state.documents) {
    old.push(await issueInvites(db.client, document, new Date(Date.now() + 86_400_000)));
    document.status = 'AGUARDANDO_ASSINATURAS';
  }
  assert.notEqual(old[0][0].url, old[1][0].url);
  db.state.documents[1].signers[0].status = 'ASSINADO';
  db.state.documents[1].signers[0].signatureImageDataUrl = 'preservar';
  const canonical = await batchInviteAction(db.client, 'batch-1', 'ana', 'owner', 'link');
  assert.equal(canonical.url, old[0][0].url);
  assert.equal(db.state.groups.length, 1);
  assert.equal(db.state.documents[1].signers[0].signatureImageDataUrl, 'preservar');
  for (const token of [old[0][0].token, old[1][0].token]) {
    const invite = await resolveInviteByToken(db.client, token);
    assert.deepEqual(invite.members.map(member => member.documentId), ['doc-1', 'doc-2']);
    assert.equal(invite.name, 'Ana Souza');
  }
  assert.ok(!db.state.documents[0].signers[1].groupInviteId, 'outra pessoa não pertence ao grupo de Ana');
  const copied = await batchInviteAction(db.client, 'batch-1', 'ana', 'owner', 'link');
  assert.equal(copied.url, canonical.url);
  assert.equal(db.state.groups.length, 1, 'copiar novamente não cria outro link');
  let sent = 0;
  const renewed = await batchInviteAction(db.client, 'batch-1', 'ana', 'owner', 'renovar', { expiresInDays: 15 }, { deliverInvites: async () => sent++ });
  assert.notEqual(renewed.url, canonical.url);
  assert.equal(sent, 1);
  assert.equal(await resolveInviteByToken(db.client, old[0][0].token), null);
  assert.equal(await resolveInviteByToken(db.client, old[1][0].token), null);
  assert.equal(db.state.documents[1].signers[0].status, 'ASSINADO');
  db.state.documents[1].signers[0].tokenExpiresAt = new Date(Date.now() - 86_400_000);
  assertInviteUsable(await resolveInviteByToken(db.client, renewed.url.split('#convite=')[1]));
});

test('link antigo consolidado permite uma confirmação para os dois PDFs e continua idempotente', async () => {
  const db = await prepared();
  const tokens = [];
  for (const document of db.state.documents) {
    tokens.push((await issueInvites(db.client, document, new Date(Date.now() + 86_400_000)))[0].token);
    document.status = 'AGUARDANDO_ASSINATURAS';
  }
  await batchInviteAction(db.client, 'batch-1', 'ana', 'owner', 'link');
  const input = { signerName: 'Ana Souza', signatureImageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', privacyNoticeAccepted: true, privacyNoticeVersion: 'signature_avulsa_v1' };
  await confirmSignature(db.client, tokens[1], input, {}, { scheduleFinalization: () => {} });
  assert.ok(db.state.documents.every(document => document.signers[0].status === 'ASSINADO'));
  assert.equal(db.state.documents[0].signers[1].status, 'PENDENTE');
  await confirmSignature(db.client, tokens[0], input, {}, { scheduleFinalization: () => {} });
  assert.equal(db.state.documents[1].status, 'FINALIZANDO');
  assert.equal(db.state.documents[0].status, 'AGUARDANDO_ASSINATURAS');
});

test('reenvio e revogação do lote operam uma vez por pessoa e preservam outros assinantes', async () => {
  const db = await prepared();
  await publishBatch(db.client, 'batch-1', 'owner', { expiresInDays: 15 }, { loadSource: async () => {}, deliverInvites: async () => {} });
  let sends = 0;
  await batchInviteAction(db.client, 'batch-1', 'ana', 'owner', 'reenviar-email', undefined, { resendInvites: async (_client, id) => { sends++; assert.equal(id, db.state.groups[0].id); return { status: 'ENVIADO' }; } });
  assert.equal(sends, 1);
  db.state.documents[1].signers[0].status = 'ASSINADO';
  db.state.documents[1].status = 'CONCLUIDO';
  await batchInviteAction(db.client, 'batch-1', 'ana', 'owner', 'revogar', undefined, { scheduleFinalization: () => {} });
  assert.equal(db.state.documents[0].signers[0].status, 'REVOGADO');
  assert.equal(db.state.documents[1].signers[0].status, 'ASSINADO');
  assert.equal(db.state.documents[0].signers[1].status, 'PENDENTE');
});


test('revogar um documento antigo não inutiliza o convite central dos documentos restantes', async () => {
  const db = await prepared();
  const tokens = [];
  for (const document of db.state.documents) {
    tokens.push((await issueInvites(db.client, document, new Date(Date.now() + 86_400_000)))[0].token);
    document.status = 'AGUARDANDO_ASSINATURAS';
  }
  await batchInviteAction(db.client, 'batch-1', 'ana', 'owner', 'link');
  db.state.documents[0].signers[0].status = 'REVOGADO';
  const invite = await resolveInviteByToken(db.client, tokens[0]);
  assertInviteUsable(invite);
  assert.deepEqual(invite.members.map(member => member.documentId), ['doc-2']);
});
