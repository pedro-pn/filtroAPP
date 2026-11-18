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
