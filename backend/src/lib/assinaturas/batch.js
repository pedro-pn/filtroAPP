import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { assertDocumentEditable } from './access.js';
import { recordDocumentEvent } from './audit.js';
import { sourcePdfBuffer } from './document.js';
import { resendGroupInviteEmail, sendGroupInviteEmail } from './group-notifications.js';
import { issueGroupedInvites } from './grouped-invites.js';
import { recoverInviteLink, renewInvite, revokeInvite } from './invites.js';
import { beginDocumentFinalization, scheduleDocumentFinalization } from './finalization.js';
import {
  fieldRowsForDocument,
  normalizeSignerInputs,
  ownerDocumentPayload,
  publicationExpiresAt,
  publishPreparedDocument,
  validatePublishableSnapshot
} from './service.js';

function httpError(message, statusCode = 400, issues) {
  return Object.assign(new Error(message), { statusCode, status: statusCode, ...(issues ? { issues } : {}) });
}

const batchInclude = {
  documents: {
    where: { deletedAt: null },
    orderBy: [{ batchPosition: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    include: {
      signers: { include: { fields: true, groupInvite: { select: { emailStatus: true, emailAttempts: true, emailSentAt: true } } }, orderBy: { position: 'asc' } },
      fields: { orderBy: [{ pageNumber: 'asc' }, { createdAt: 'asc' }] }
    }
  }
};

export async function createBatch(client, ownerUserId) {
  if (!ownerUserId) throw httpError('Usuário inválido.', 403);
  return client.signatureDocumentBatch.create({ data: { ownerUserId } });
}

async function loadBatch(client, id, ownerUserId, lock = false) {
  if (!ownerUserId) throw httpError('Lote não encontrado.', 404);
  if (lock) {
    const locked = await client.signatureDocumentBatch.updateMany({
      where: { id, ownerUserId }, data: { updatedAt: new Date() }
    });
    if (locked.count !== 1) throw httpError('Lote não encontrado.', 404);
  }
  const batch = await client.signatureDocumentBatch.findFirst({ where: { id, ownerUserId }, include: batchInclude });
  if (!batch) throw httpError('Lote não encontrado.', 404);
  // Documentos preservados após exclusão de conta nunca devem ser acessados por outro usuário.
  if (batch.documents.some(document => document.ownerUserId !== ownerUserId)) throw httpError('Lote não encontrado.', 404);
  return batch;
}

function batchPayload(batch) {
  const documents = batch.documents.map(ownerDocumentPayload);
  const grouped = new Map();
  for (const document of documents) for (const signer of document.signers) {
    const id = signer.batchSignerId || signer.id;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push({ document, signer });
  }
  const invitations = [...grouped.entries()].map(([id, members]) => {
    const active = members.filter(({ document, signer }) => !['CANCELADO', 'RASCUNHO'].includes(document.status) && signer.status !== 'REVOGADO');
    const pending = active.filter(({ signer }) => signer.status !== 'ASSINADO');
    const representative = pending[0] || active[0] || members[0];
    const status = pending.length
      ? pending.some(({ signer }) => signer.status === 'EXPIRADO') ? 'EXPIRADO'
        : pending.some(({ signer }) => signer.status === 'VISUALIZADO') ? 'VISUALIZADO' : 'PENDENTE'
      : active.length ? 'ASSINADO' : 'REVOGADO';
    return { ...representative.signer, id, status,
      signedAt: status === 'ASSINADO' ? active.map(({ signer }) => signer.signedAt).filter(Boolean).sort((a, b) => new Date(a) - new Date(b)).at(-1) : null,
      documents: members.map(({ document, signer }) => ({ id: document.id, title: document.title, status: document.status, signerStatus: signer.status }))
    };
  });
  return { id: batch.id, signers: batch.signers, documents, invitations };
}

export async function getBatch(client, id, ownerUserId) {
  return batchPayload(await loadBatch(client, id, ownerUserId));
}

const configurationSchema = z.strictObject({
  signers: z.array(z.strictObject({
    id: z.string().trim().min(1).max(100),
    name: z.string(), email: z.string().nullable().optional(), position: z.number()
  })),
  documents: z.array(z.strictObject({ id: z.string().min(1), fields: z.array(z.unknown()) }))
});

export async function saveBatch(client, id, ownerUserId, input) {
  const parsed = configurationSchema.parse(input);
  // Um rascunho vazio pode ser salvo; a publicação continua exigindo assinantes/campos.
  const signers = parsed.signers.length ? normalizeSignerInputs(parsed.signers) : [];
  if (new Set(signers.map(signer => signer.id)).size !== signers.length) throw httpError('Assinante repetido no lote.');
  return client.$transaction(async tx => {
    const batch = await loadBatch(tx, id, ownerUserId, true);
    const documents = batch.documents;
    const inputById = new Map(parsed.documents.map(document => [document.id, document]));
    const documentIds = new Set(documents.map(document => document.id));
    if (parsed.documents.length !== documents.length
      || inputById.size !== documents.length
      || parsed.documents.some(document => !documentIds.has(document.id))) {
      throw httpError('A lista de documentos do lote foi alterada. Atualize a página.', 409);
    }
    // Valida tudo antes de modificar qualquer documento.
    const prepared = documents.map(document => {
      assertDocumentEditable(document);
      const fields = inputById.get(document.id).fields;
      return { document, rows: fieldRowsForDocument({ ...document, signers }, fields) };
    });
    for (const { document, rows } of prepared) {
      await tx.signatureDocumentField.deleteMany({ where: { documentId: document.id } });
      await tx.signatureDocumentSigner.deleteMany({ where: { documentId: document.id } });
      const assigned = signers.filter(signer => rows.some(field => field.signerId === signer.id));
      const ids = new Map();
      for (const [index, signer] of assigned.entries()) {
        const created = await tx.signatureDocumentSigner.create({
          data: {
            id: randomUUID(), documentId: document.id, batchSignerId: signer.id,
            name: signer.name, email: signer.email, position: index + 1
          }
        });
        ids.set(signer.id, created.id);
      }
      if (rows.length) await tx.signatureDocumentField.createMany({
        data: rows.map(row => ({ ...row, signerId: ids.get(row.signerId) }))
      });
      await recordDocumentEvent(tx, {
        document, actorUserId: ownerUserId, action: 'CONFIGURACAO_ATUALIZADA',
        description: 'Assinantes e campos do lote atualizados.'
      });
    }
    await tx.signatureDocumentBatch.update({ where: { id }, data: { signers } });
    return batchPayload(await loadBatch(tx, id, ownerUserId));
  }, { timeout: 120_000 });
}

export async function publishBatch(client, id, ownerUserId, expiry, {
  now = new Date(), loadSource = sourcePdfBuffer, deliverInvites = sendGroupInviteEmail
} = {}) {
  const expiresAt = publicationExpiresAt(expiry, now);
  // Leitura dos arquivos fora da transação; revalida o estado ao obter o lock.
  const snapshot = await loadBatch(client, id, ownerUserId);
  const snapshotIds = new Set(snapshot.documents.map(document => document.id));
  for (const document of snapshot.documents) await loadSource(document);
  const result = await client.$transaction(async tx => {
    const batch = await loadBatch(tx, id, ownerUserId, true);
    if (!batch.documents.length) throw httpError('Adicione pelo menos um documento ao lote.');
    if (batch.documents.some(document => !snapshotIds.has(document.id))) {
      throw httpError('A lista de documentos do lote foi alterada. Atualize a página.', 409);
    }
    const issues = batch.documents.flatMap(document => validatePublishableSnapshot(document)
      .map(issue => `${document.title}: ${issue}`));
    const usedIds = new Set(batch.documents.flatMap(document => document.signers.map(signer => signer.batchSignerId)));
    for (const signer of batch.signers) {
      if (!usedIds.has(signer.id)) issues.push(`${signer.name} não tem campo de assinatura em nenhum documento.`);
    }
    if (issues.length) throw httpError('Corrija as pendências antes de publicar o lote.', 400, issues);
    const invites = await issueGroupedInvites(tx, batch.documents, expiresAt, ownerUserId);
    const published = [];
    for (const document of batch.documents) {
      published.push(await publishPreparedDocument(tx, document, expiresAt, ownerUserId, now, { grouped: true }));
    }
    return { id, documents: published.map(item => ({ id: item.document.id })), invites };
  }, { timeout: 120_000 });
  // Somente após o commit: um erro não deixa parte do lote com e-mails enviados.
  for (const invite of result.invites) {
    await deliverInvites(client, invite.id, { now }).catch(() => {});
  }
  return result;
}


// Consolida convites individuais de lotes publicados antes do convite agrupado.
// Os tokens antigos são mantidos como aliases até a próxima renovação.
async function consolidateInvite(tx, members, actorUserId) {
  const grouped = members.find(({ signer }) => signer.groupInviteId)?.signer;
  let group;
  if (grouped) group = await tx.signatureInviteGroup.findUnique({ where: { id: grouped.groupInviteId } });
  if (!group) {
    const credential = members.find(({ signer }) => signer.tokenEncrypted && signer.tokenHash)?.signer;
    if (!credential) throw httpError('Este convite não possui link recuperável.', 409);
    const expirations = members.map(({ signer }) => signer.tokenExpiresAt).filter(Boolean).map(value => new Date(value).getTime());
    group = await tx.signatureInviteGroup.create({ data: {
      tokenHash: credential.tokenHash, tokenEncrypted: credential.tokenEncrypted,
      tokenIv: credential.tokenIv, tokenAuthTag: credential.tokenAuthTag,
      tokenExpiresAt: new Date(Math.min(...expirations)),
      emailStatus: credential.emailStatus, emailAttempts: credential.emailAttempts || 0,
      emailSentAt: credential.emailSentAt || null
    } });
  }
  for (const { document, signer } of members) {
    if (signer.groupInviteId && signer.groupInviteId !== group.id) throw httpError('Os convites deste lote precisam ser atualizados.', 409);
    if (!signer.groupInviteId) {
      await tx.signatureDocumentSigner.update({ where: { id: signer.id }, data: {
        groupInviteId: group.id, emailStatus: 'NAO_APLICAVEL', emailClaimedAt: null
      } });
      await recordDocumentEvent(tx, { document, signer, actorUserId, action: 'CONFIGURACAO_ATUALIZADA', description: `Convite de ${signer.name} centralizado no lote, preservando os links existentes.` });
    }
    signer.groupInviteId = group.id;
  }
  return group;
}

export async function batchInviteAction(client, id, signerId, ownerUserId, action, expiry, dependencies = {}) {
  const now = dependencies.now || new Date();
  const result = await client.$transaction(async tx => {
    const batch = await loadBatch(tx, id, ownerUserId, true);
    const members = batch.documents.flatMap(document => document.signers
      .filter(signer => (signer.batchSignerId || signer.id) === signerId && signer.status !== 'REVOGADO'
        && ['AGUARDANDO_ASSINATURAS', 'FINALIZANDO', 'CONCLUIDO'].includes(document.status))
      .map(signer => ({ document, signer })));
    if (!members.length) throw httpError('Convite não encontrado.', 404);
    const pending = members.filter(({ signer }) => signer.status !== 'ASSINADO');
    const { document, signer } = pending[0] || members[0];
    const group = await consolidateInvite(tx, members, ownerUserId);
    // Compartilha o lock com confirmação e renovação do convite público.
    await tx.signatureInviteGroup.update({ where: { id: group.id }, data: { updatedAt: group.updatedAt } });
    if (action === 'link') return recoverInviteLink(tx, document, signer, ownerUserId);
    if (!pending.length) throw httpError('Este convite já foi assinado.', 409);
    if (action === 'renovar') {
      const renewed = await renewInvite(tx, document, signer, publicationExpiresAt(expiry, now), { actorUserId: ownerUserId, now });
      return { url: renewed.url, expiresAt: renewed.expiresAt, groupId: group.id, email: signer.email };
    }
    if (action === 'reenviar-email') {
      if (!signer.email || !['PENDENTE', 'VISUALIZADO'].includes(signer.status) || new Date(group.tokenExpiresAt) <= now) throw httpError('Renove o convite antes de solicitar o reenvio.', 409);
      return { groupId: group.id };
    }
    if (action !== 'revogar') throw httpError('Ação inválida.', 404);
    const finalizing = [];
    for (const member of pending) {
      await revokeInvite(tx, member.document, member.signer, { actorUserId: ownerUserId, now });
      if (await beginDocumentFinalization(tx, member.document, { actorUserId: ownerUserId, now })) finalizing.push(member.document.id);
    }
    return { status: 'REVOGADO', finalizing };
  }, { timeout: 120_000 });
  if (action === 'reenviar-email') return (dependencies.resendInvites || resendGroupInviteEmail)(client, result.groupId, dependencies);
  if (action === 'renovar' && result.email) await (dependencies.deliverInvites || sendGroupInviteEmail)(client, result.groupId, { now }).catch(() => {});
  for (const documentId of result.finalizing || []) (dependencies.scheduleFinalization || scheduleDocumentFinalization)(client, documentId, dependencies);
  const { groupId: _groupId, email: _email, finalizing: _finalizing, ...payload } = result;
  return payload;
}
