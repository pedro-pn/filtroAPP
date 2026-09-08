import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import env from '../../config/env.js';
import { normalizeSignerEmail } from '../signatures/common.js';
import {
  assertDocumentEditable,
  assertDocumentDeletable,
  assertDocumentPublishable,
  documentForOwnerOrThrow,
  ownerListWhere
} from './access.js';
import { recordDocumentEvent } from './audit.js';
import { sourcePdfBuffer } from './document.js';
import {
  issueInvites,
  reissueInviteAfterDelete,
  revokeAllPending
} from './invites.js';
import { queueInviteEmails } from './notifications.js';
import { signatureOperationLog } from './observability.js';

function httpError(message, statusCode = 400, extra = {}) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

export function createStandaloneValidationCode() {
  return randomBytes(18).toString('base64url');
}

export async function userDeletionImpact(client, userId) {
  const ownerUserId = String(userId || '').trim();
  if (!ownerUserId) throw httpError('Conta inválida.', 404);
  const [toDelete, toPreserve, finalizing] = await Promise.all([
    client.signatureDocument.count({
      where: {
        ownerUserId,
        status: { in: ['RASCUNHO', 'AGUARDANDO_ASSINATURAS', 'CANCELADO'] }
      }
    }),
    client.signatureDocument.count({ where: { ownerUserId, status: 'CONCLUIDO' } }),
    client.signatureDocument.count({ where: { ownerUserId, status: 'FINALIZANDO' } })
  ]);
  return { toDelete, toPreserve, finalizing };
}

export function assertUserDeletionImpactReady(impact) {
  if (Number(impact?.finalizing || 0) > 0) {
    throw httpError(
      'A conta possui documentos em finalização. Aguarde a conclusão antes de excluí-la.',
      409,
      { code: 'SIGNATURE_DOCUMENTS_FINALIZING', assinaturas: impact }
    );
  }
  return impact;
}

const signerInputSchema = z.strictObject({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(2, 'Informe o nome completo do assinante.').max(160),
  email: z.string().trim().email('Informe um e-mail válido.').optional().nullable().or(z.literal('')),
  position: z.number().int().positive()
});

const fieldInputSchema = z.strictObject({
  signerId: z.string().trim().min(1),
  pageNumber: z.number().int().positive(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.02).max(1),
  height: z.number().min(0.02).max(1)
}).superRefine((field, ctx) => {
  if (field.x + field.width > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['width'], message: 'O campo ultrapassa a largura da página.' });
  }
  if (field.y + field.height > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['height'], message: 'O campo ultrapassa a altura da página.' });
  }
});

export function normalizeSignerInputs(signers) {
  if (!Array.isArray(signers) || signers.length < 1) {
    throw httpError('Adicione pelo menos um assinante.');
  }
  if (signers.length > env.assinaturasMaxSigners) {
    throw httpError(`Adicione no máximo ${env.assinaturasMaxSigners} assinantes.`);
  }
  const parsed = signers.map((signer, index) => {
    const value = signerInputSchema.parse(signer);
    if (value.position !== index + 1) {
      throw httpError('A posição dos assinantes deve ser sequencial a partir de 1.');
    }
    return {
      ...(value.id ? { id: value.id } : {}),
      name: value.name,
      email: normalizeSignerEmail(value.email) || null,
      position: value.position
    };
  });
  const emails = parsed.map(item => item.email).filter(Boolean);
  if (new Set(emails).size !== emails.length) {
    throw httpError('Há e-mail repetido entre os assinantes.');
  }
  return parsed;
}

function pageGeometry(document, pageNumber) {
  const dimensions = Array.isArray(document?.pageDimensions) ? document.pageDimensions : [];
  return dimensions.find(item => Number(item?.page) === pageNumber) || dimensions[pageNumber - 1] || null;
}

export function fieldRowsForDocument(document, fields) {
  const parsed = z.array(fieldInputSchema).max(1000).parse(fields);
  const signerIds = new Set((document?.signers || []).map(signer => signer.id));
  return parsed.map(field => {
    if (!signerIds.has(field.signerId)) {
      throw httpError('Assinante não encontrado neste documento.', 404);
    }
    if (field.pageNumber > Number(document.pageCount || 0)) {
      throw httpError('Página do campo de assinatura inválida.');
    }
    const geometry = pageGeometry(document, field.pageNumber);
    if (!geometry) throw httpError('Geometria da página não encontrada.');
    return {
      documentId: document.id,
      signerId: field.signerId,
      pageNumber: field.pageNumber,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
      pageWidthPt: Number(geometry.widthPt),
      pageHeightPt: Number(geometry.heightPt),
      pageRotation: Number(geometry.rotation || 0)
    };
  });
}

export function publicationExpiresAt(payload, now = new Date()) {
  const hasDays = payload?.expiresInDays !== undefined;
  const hasDate = payload?.expiresAt !== undefined;
  if (hasDays === hasDate) {
    throw httpError('Informe a validade em dias ou uma data de expiração.');
  }
  let expiresAt;
  if (hasDays) {
    const days = Number(payload.expiresInDays);
    if (!Number.isInteger(days) || days < 1 || days > env.assinaturasTokenMaxDays) {
      throw httpError(`A validade deve ser de 1 a ${env.assinaturasTokenMaxDays} dias.`);
    }
    expiresAt = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));
  } else {
    expiresAt = new Date(payload.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) throw httpError('Data de expiração inválida.');
  }
  if (expiresAt.getTime() <= now.getTime() + (60 * 60 * 1000)) {
    throw httpError('A validade precisa ser de pelo menos uma hora.');
  }
  if (expiresAt.getTime() > now.getTime() + (env.assinaturasTokenMaxDays * 24 * 60 * 60 * 1000)) {
    throw httpError(`A validade não pode ultrapassar ${env.assinaturasTokenMaxDays} dias.`);
  }
  return expiresAt;
}

export function validatePublishableSnapshot(document) {
  const issues = [];
  if (document?.status !== 'RASCUNHO' || document?.archivedAt || document?.deletedAt) {
    issues.push('O documento precisa estar em rascunho, ativo e não excluído.');
  }
  const signers = Array.isArray(document?.signers) ? document.signers : [];
  if (!signers.length) issues.push('Adicione pelo menos um assinante.');
  if (signers.length > env.assinaturasMaxSigners) issues.push(`Use no máximo ${env.assinaturasMaxSigners} assinantes.`);
  const emails = [];
  for (const signer of signers) {
    if (String(signer.name || '').trim().length < 2) issues.push('Todo assinante precisa ter um nome válido.');
    const email = normalizeSignerEmail(signer.email);
    if (email) emails.push(email);
    if (!Array.isArray(signer.fields) || !signer.fields.length) {
      issues.push(`${String(signer.name || 'Assinante').trim()} não tem campo de assinatura.`);
    }
  }
  if (new Set(emails).size !== emails.length) issues.push('Os e-mails dos assinantes não podem se repetir.');
  return Array.from(new Set(issues));
}

export function documentProgress(document) {
  const signers = Array.isArray(document?.signers) ? document.signers : [];
  const signed = signers.filter(signer => signer.status === 'ASSINADO').length;
  return { signed, total: signers.length };
}

function ownerSignerPayload(signer) {
  return {
    id: signer.id,
    name: signer.name,
    email: signer.email,
    position: signer.position,
    status: signer.status,
    isRequired: signer.isRequired,
    tokenExpiresAt: signer.tokenExpiresAt,
    renewalCount: signer.renewalCount,
    emailStatus: signer.emailStatus,
    emailAttempts: signer.emailAttempts,
    emailSentAt: signer.emailSentAt,
    viewedAt: signer.viewedAt,
    signedAt: signer.signedAt,
    revokedAt: signer.revokedAt,
    expiredAt: signer.expiredAt
  };
}

function ownerDocumentPayload(document) {
  return {
    ...document,
    signers: (document.signers || []).map(ownerSignerPayload),
    progress: documentProgress(document)
  };
}

function documentCard(document) {
  const progress = documentProgress(document);
  return {
    id: document.id,
    title: document.title,
    originalFileName: document.originalFileName,
    status: document.status,
    pageCount: document.pageCount,
    signerCount: progress.total,
    signedCount: progress.signed,
    progressLabel: `${progress.signed} de ${progress.total} assinaturas`,
    hasExpiredInvites: (document.signers || []).some(signer => signer.status === 'EXPIRADO'),
    isArchived: Boolean(document.archivedAt),
    createdAt: document.createdAt,
    completedAt: document.completedAt
  };
}

export async function listDocuments(client, ownerUserId, filters = {}) {
  const limit = Math.min(50, Math.max(1, Number(filters.limit) || 20));
  const where = {
    ...ownerListWhere(ownerUserId),
    archivedAt: filters.archived ? { not: null } : null,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.q ? {
      OR: [
        { title: { contains: String(filters.q), mode: 'insensitive' } },
        { originalFileName: { contains: String(filters.q), mode: 'insensitive' } }
      ]
    } : {})
  };
  const items = await client.signatureDocument.findMany({
    where,
    include: { signers: { select: { status: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})
  });
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return {
    items: page.map(documentCard),
    nextCursor: hasMore ? page.at(-1)?.id || null : null
  };
}

export async function getDocument(client, id, ownerUserId, options = {}) {
  const document = await documentForOwnerOrThrow(client, id, ownerUserId, {
    include: {
      signers: { orderBy: { position: 'asc' } },
      fields: { orderBy: [{ pageNumber: 'asc' }, { createdAt: 'asc' }] }
    },
    ...options
  });
  return ownerDocumentPayload(document);
}

export async function renameDocument(client, document, title, actorUserId) {
  assertDocumentEditable(document);
  const value = String(title || '').trim();
  if (!value || value.length > 180) throw httpError('O título deve ter entre 1 e 180 caracteres.');
  const updated = await client.signatureDocument.update({ where: { id: document.id }, data: { title: value } });
  await recordDocumentEvent(client, {
    document,
    actorUserId,
    action: 'CONFIGURACAO_ATUALIZADA',
    description: 'Título do documento atualizado.'
  });
  return updated;
}

export async function replaceSigners(client, document, signers, actorUserId) {
  assertDocumentEditable(document);
  const normalized = normalizeSignerInputs(signers);
  const operation = async tx => {
    await tx.signatureDocumentField.deleteMany({ where: { documentId: document.id } });
    await tx.signatureDocumentSigner.deleteMany({ where: { documentId: document.id } });
    for (const signer of normalized) {
      await tx.signatureDocumentSigner.create({ data: { ...signer, documentId: document.id } });
    }
    await recordDocumentEvent(tx, {
      document,
      actorUserId,
      action: 'CONFIGURACAO_ATUALIZADA',
      description: 'Lista de assinantes atualizada.'
    });
    const updated = await tx.signatureDocument.findUnique({
      where: { id: document.id },
      include: { signers: { orderBy: { position: 'asc' } }, fields: true }
    });
    return ownerDocumentPayload(updated);
  };
  return client.$transaction ? client.$transaction(operation) : operation(client);
}

export async function replaceFields(client, document, fields, actorUserId) {
  assertDocumentEditable(document);
  const rows = fieldRowsForDocument(document, fields);
  const operation = async tx => {
    await tx.signatureDocumentField.deleteMany({ where: { documentId: document.id } });
    if (rows.length) await tx.signatureDocumentField.createMany({ data: rows });
    await recordDocumentEvent(tx, {
      document,
      actorUserId,
      action: 'CONFIGURACAO_ATUALIZADA',
      description: 'Campos de assinatura atualizados.'
    });
    const updated = await tx.signatureDocument.findUnique({
      where: { id: document.id },
      include: { signers: { orderBy: { position: 'asc' } }, fields: true }
    });
    return ownerDocumentPayload(updated);
  };
  return client.$transaction ? client.$transaction(operation) : operation(client);
}

export async function publishDocument(client, id, ownerUserId, payload, {
  now = new Date(),
  loadSource = sourcePdfBuffer,
  deliverInvites = queueInviteEmails
} = {}) {
  const startedAt = Date.now();
  const operation = async tx => {
    const document = await documentForOwnerOrThrow(tx, id, ownerUserId, {
      include: {
        signers: { include: { fields: true }, orderBy: { position: 'asc' } },
        fields: true
      },
      allowArchived: false
    });
    assertDocumentPublishable(document);
    await loadSource(document);
    const issues = validatePublishableSnapshot(document);
    if (issues.length) throw httpError('Corrija as pendências antes de publicar.', 400, { issues });
    const expiresAt = publicationExpiresAt(payload, now);
    const invites = await issueInvites(tx, document, expiresAt, { actorUserId: ownerUserId });
    const updated = await tx.signatureDocument.update({
      where: { id: document.id },
      data: {
        status: 'AGUARDANDO_ASSINATURAS',
        validationCode: createStandaloneValidationCode(),
        tokenExpiresAt: expiresAt,
        publishedAt: now
      }
    });
    await recordDocumentEvent(tx, {
      document,
      actorUserId: ownerUserId,
      action: 'DOCUMENTO_PUBLICADO',
      description: 'Documento publicado para assinatura.'
    });
    return {
      document: updated,
      invites: invites.map(item => ({
        signerId: item.signer.id,
        name: item.signer.name,
        hasEmail: Boolean(item.signer.email),
        expiresAt
      })),
      emailSummary: { pending: invites.filter(item => item.signer.email).length, notApplicable: invites.filter(item => !item.signer.email).length }
    };
  };
  const result = await client.$transaction(operation);
  await deliverInvites(client, result.document.id, { now }).catch(() => {
    // O job durável retoma o envio; a publicação e os tokens já foram commitados.
  });
  signatureOperationLog('invites.issue', {
    documentId: result.document.id,
    recipients: result.invites.length,
    emailRecipients: result.emailSummary.pending,
    outcome: 'completed'
  }, { startedAt });
  return result;
}

export async function unpublishDocument(client, id, ownerUserId) {
  return client.$transaction(async tx => {
    const document = await documentForOwnerOrThrow(tx, id, ownerUserId, {
      include: { signers: true }
    });
    if (document.status !== 'AGUARDANDO_ASSINATURAS') {
      throw httpError('Somente documentos aguardando assinaturas podem voltar a rascunho.', 409);
    }
    if (document.signers.some(signer => signer.status === 'ASSINADO')) {
      throw httpError('Não é possível despublicar um documento que já possui assinatura.', 409);
    }
    await tx.signatureDocumentSigner.updateMany({
      where: { documentId: document.id },
      data: {
        status: 'PENDENTE',
        tokenHash: null,
        tokenEncrypted: null,
        tokenIv: null,
        tokenAuthTag: null,
        tokenExpiresAt: null,
        emailStatus: 'NAO_APLICAVEL'
      }
    });
    const updated = await tx.signatureDocument.update({
      where: { id: document.id },
      data: { status: 'RASCUNHO', publishedAt: null, tokenExpiresAt: null }
    });
    await recordDocumentEvent(tx, {
      document,
      actorUserId: ownerUserId,
      action: 'DOCUMENTO_DESPUBLICADO',
      description: 'Publicação desfeita antes da primeira assinatura.'
    });
    return updated;
  });
}

export async function listAudit(client, id, ownerUserId, { cursor, limit = 30 } = {}) {
  const document = await documentForOwnerOrThrow(client, id, ownerUserId);
  const take = Math.min(100, Math.max(1, Number(limit) || 30));
  const rows = await client.signatureDocumentAuditLog.findMany({
    where: { documentId: document.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return {
    items,
    nextCursor: hasMore ? items.at(-1)?.id || null : null
  };
}

export async function archiveDocument(client, id, ownerUserId, { now = new Date() } = {}) {
  return client.$transaction(async tx => {
    const document = await documentForOwnerOrThrow(tx, id, ownerUserId);
    if (document.status === 'FINALIZANDO') throw httpError('Aguarde a finalização antes de arquivar.', 409);
    if (document.archivedAt) return document;
    const updated = await tx.signatureDocument.update({ where: { id: document.id }, data: { archivedAt: now } });
    await recordDocumentEvent(tx, {
      document,
      actorUserId: ownerUserId,
      action: 'DOCUMENTO_ARQUIVADO',
      description: 'Documento arquivado.'
    });
    return updated;
  });
}

export async function restoreArchivedDocument(client, id, ownerUserId) {
  return client.$transaction(async tx => {
    const document = await documentForOwnerOrThrow(tx, id, ownerUserId);
    if (!document.archivedAt) return document;
    const updated = await tx.signatureDocument.update({ where: { id: document.id }, data: { archivedAt: null } });
    await recordDocumentEvent(tx, {
      document,
      actorUserId: ownerUserId,
      action: 'DOCUMENTO_RESTAURADO',
      description: 'Documento restaurado para o acervo ativo.'
    });
    return updated;
  });
}

export async function cancelDocument(client, id, ownerUserId, reason, { now = new Date() } = {}) {
  return client.$transaction(async tx => {
    const document = await documentForOwnerOrThrow(tx, id, ownerUserId, { include: { signers: true } });
    if (document.status !== 'AGUARDANDO_ASSINATURAS') {
      throw httpError('Somente documentos aguardando assinaturas podem ser cancelados.', 409);
    }
    await revokeAllPending(tx, document, 'DOCUMENTO_CANCELADO', { actorUserId: ownerUserId, now });
    const cancelReason = String(reason || '').trim().slice(0, 500) || null;
    const updated = await tx.signatureDocument.update({
      where: { id: document.id },
      data: { status: 'CANCELADO', canceledAt: now, cancelReason, tokenExpiresAt: null }
    });
    await recordDocumentEvent(tx, {
      document,
      actorUserId: ownerUserId,
      action: 'DOCUMENTO_CANCELADO',
      description: cancelReason ? `Documento cancelado: ${cancelReason}` : 'Documento cancelado.'
    });
    return updated;
  });
}

export async function softDeleteDocument(client, id, ownerUserId, { now = new Date() } = {}) {
  return client.$transaction(async tx => {
    const document = await documentForOwnerOrThrow(tx, id, ownerUserId, { include: { signers: true } });
    assertDocumentDeletable(document);
    await revokeAllPending(tx, document, 'DOCUMENTO_EXCLUIDO', { actorUserId: ownerUserId, now });
    await tx.signatureDocumentSigner.updateMany({
      where: { documentId: document.id, status: 'ASSINADO', tokenHash: { not: null } },
      data: {
        tokenHash: null,
        tokenEncrypted: null,
        tokenIv: null,
        tokenAuthTag: null,
        tokenExpiresAt: null
      }
    });
    const updated = await tx.signatureDocument.update({ where: { id: document.id }, data: { deletedAt: now } });
    await recordDocumentEvent(tx, {
      document,
      actorUserId: ownerUserId,
      action: 'DOCUMENTO_EXCLUIDO',
      description: 'Documento excluído logicamente; links ativos foram invalidados.'
    });
    return updated;
  });
}

export async function restoreDeletedDocument(client, id, ownerUserId, {
  now = new Date(),
  deliverInvites = queueInviteEmails
} = {}) {
  const operation = async tx => {
    const document = await documentForOwnerOrThrow(tx, id, ownerUserId, {
      include: { signers: { orderBy: { position: 'asc' } } },
      allowDeleted: true
    });
    if (!document.deletedAt) throw httpError('O documento não está excluído.', 409);
    const retentionEnd = new Date(document.deletedAt).getTime() + (env.assinaturasDeletedRetentionDays * 24 * 60 * 60_000);
    if (document.filesPurgedAt || retentionEnd <= now.getTime()) {
      throw httpError('O prazo para desfazer a exclusão terminou e os arquivos já podem ter sido removidos.', 410);
    }
    const expiresAt = new Date(Math.min(
      now.getTime() + (15 * 24 * 60 * 60_000),
      now.getTime() + (env.assinaturasTokenMaxDays * 24 * 60 * 60_000)
    ));
    const reissuedInvites = [];
    for (const signer of document.signers) {
      if (signer.status !== 'REVOGADO' || signer.invalidationReason !== 'DOCUMENTO_EXCLUIDO') continue;
      const issued = await reissueInviteAfterDelete(tx, document, signer, expiresAt, { actorUserId: ownerUserId });
      if (issued) reissuedInvites.push({
        signerId: issued.signerId,
        expiresAt: issued.expiresAt,
        hasEmail: issued.hasEmail
      });
    }
    const updated = await tx.signatureDocument.update({ where: { id: document.id }, data: { deletedAt: null } });
    await recordDocumentEvent(tx, {
      document,
      actorUserId: ownerUserId,
      action: 'DOCUMENTO_EXCLUSAO_DESFEITA',
      description: 'Exclusão desfeita; convites elegíveis receberam novos links.'
    });
    return { document: updated, reissuedInvites };
  };
  const result = await client.$transaction(operation);
  await deliverInvites(client, result.document.id, { now }).catch(() => {});
  return result;
}

export async function validateByCode(client, code) {
  const value = String(code || '').trim();
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(value)) return null;
  const document = await client.signatureDocument.findUnique({
    where: { validationCode: value },
    include: { signers: { orderBy: { position: 'asc' } } }
  });
  if (!document || document.status !== 'CONCLUIDO' || !document.finalDocumentHash) return null;
  return {
    status: 'VALID',
    validationCode: document.validationCode,
    sourceDocumentHash: document.sourceDocumentHash,
    finalDocumentHash: document.finalDocumentHash,
    completedAt: document.completedAt,
    document: {
      id: document.id,
      title: document.title,
      originalFileName: document.originalFileName,
      requesterNameSnapshot: document.requesterNameSnapshot,
      status: document.status
    },
    signers: document.signers.map(signer => ({
      name: signer.name,
      declaredName: signer.declaredSignerName,
      status: signer.status,
      signedAt: signer.signedAt
    }))
  };
}
