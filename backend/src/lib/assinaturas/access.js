import { hasModuleRole } from '../module-roles.js';

export function requireAssinaturasAccess(req, res, next) {
  if (hasModuleRole(req.auth?.user, 'assinaturas:user')) {
    return next();
  }
  return res.status(403).json({ error: 'Acesso restrito ao módulo de Assinaturas.' });
}

function requiredOwnerUserId(ownerUserId) {
  const value = String(ownerUserId || '').trim();
  if (!value) throw new TypeError('ownerUserId is required for signature document access.');
  return value;
}

function httpError(message, statusCode, code) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

export function ownerListWhere(ownerUserId) {
  return {
    ownerUserId: requiredOwnerUserId(ownerUserId),
    deletedAt: null
  };
}

export function accessibleListWhere(userId) {
  const id = requiredOwnerUserId(userId);
  return {
    deletedAt: null,
    AND: [{ OR: [
      { ownerUserId: id },
      { ownerUserId: { not: null }, shares: { some: { userId: id } } }
    ] }]
  };
}

export function documentPermissions(document, userId) {
  const isOwner = document.ownerUserId === userId;
  const permission = isOwner ? 'OWNER' : document.shares?.find(share => share.userId === userId)?.permission;
  return {
    isOwner,
    access: permission || 'VIEW',
    canEdit: (isOwner || permission === 'EDIT') && document.status === 'RASCUNHO' && !document.archivedAt && !document.deletedAt
  };
}

// Compartilhar um PDF de um lote nunca concede acesso aos demais PDFs do lote.
export async function documentForAccessOrThrow(client, id, userId, { edit = false, include, ...options } = {}) {
  const actorId = requiredOwnerUserId(userId);
  let document;
  try {
    document = await documentForOwnerOrThrow(client, id, actorId, { include, ...options });
  } catch (error) {
    if (error.statusCode !== 404) throw error;
    document = await client.signatureDocument.findFirst({
      where: {
        id: String(id || '').trim(),
        ownerUserId: { not: null },
        deletedAt: null,
        ...(options.allowArchived === false ? { archivedAt: null } : {}),
        shares: { some: { userId: actorId } }
      },
      include: { ...include, shares: { where: { userId: actorId }, select: { userId: true, permission: true } } }
    });
    if (!document) throw httpError('Documento não encontrado.', 404);
  }
  const permissions = documentPermissions(document, actorId);
  if (edit && !permissions.isOwner && permissions.access !== 'EDIT') {
    throw httpError('Você tem permissão apenas para visualizar este documento.', 403);
  }
  const { shares: _shares, ...result } = document;
  return { ...result, permissions };
}

export async function documentForOwnerOrThrow(client, id, ownerUserId, {
  include,
  allowArchived = true,
  allowDeleted = false
} = {}) {
  const ownerId = requiredOwnerUserId(ownerUserId);
  const where = {
    id: String(id || '').trim(),
    ownerUserId: ownerId,
    ...(allowDeleted ? {} : { deletedAt: null }),
    ...(allowArchived ? {} : { archivedAt: null })
  };
  const document = await client.signatureDocument.findFirst({
    where,
    ...(include ? { include } : {})
  });
  if (!document) throw httpError('Documento não encontrado.', 404);
  return document;
}

export function assertDocumentEditable(document) {
  if (document?.permissions && !document.permissions.isOwner && document.permissions.access !== 'EDIT') {
    throw httpError('Você tem permissão apenas para visualizar este documento.', 403);
  }
  if (!document || document.deletedAt || document.archivedAt || document.status !== 'RASCUNHO') {
    throw httpError('Somente documentos em rascunho podem ser alterados.', 409);
  }
  return document;
}

export function assertDocumentPublishable(document) {
  return assertDocumentEditable(document);
}

export function assertDocumentDeletable(document) {
  if (document?.status === 'FINALIZANDO') {
    throw httpError('Aguarde a finalização do documento antes de excluí-lo.', 409, 'DOCUMENT_FINALIZING');
  }
  return document;
}

export function assertAccountDeletionReady(impact) {
  const finalizing = Number(typeof impact === 'number' ? impact : impact?.finalizing || 0);
  if (finalizing > 0) {
    throw httpError(
      'A conta possui documentos de assinatura em finalização. Aguarde a conclusão antes de excluí-la.',
      409,
      'ACCOUNT_SIGNATURES_FINALIZING'
    );
  }
  return impact;
}
