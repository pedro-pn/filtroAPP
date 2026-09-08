import {
  AUDIT_ENTITY_TYPES,
  AUDIT_MODULES,
  recordAuditEvent
} from '../audit/events.js';

export function recordDocumentEvent(client, {
  document,
  signer = null,
  actorUserId = null,
  action,
  description = null,
  evidence = null
}) {
  if (!document?.id) throw new TypeError('Document is required for signature audit events.');
  return recordAuditEvent(client, {
    module: AUDIT_MODULES.ASSINATURAS,
    entityType: AUDIT_ENTITY_TYPES.SIGNATURE_DOCUMENT,
    entityId: document.id,
    relatedEntityId: signer?.id,
    actorUserId,
    action,
    description,
    evidence
  });
}

export async function anonymizeDocumentAccessEvidence(client, {
  documentId,
  cutoff,
  actorUserId = null
}) {
  const id = String(documentId || '').trim();
  if (!id) throw new TypeError('documentId is required to anonymize signature audit evidence.');
  if (!(cutoff instanceof Date) || Number.isNaN(cutoff.getTime())) {
    throw new TypeError('A valid cutoff is required to anonymize signature audit evidence.');
  }

  const result = await client.signatureDocumentAuditLog.updateMany({
    where: {
      documentId: id,
      createdAt: { lt: cutoff },
      OR: [
        { ipAddress: { not: null } },
        { userAgent: { not: null } }
      ]
    },
    data: { ipAddress: null, userAgent: null }
  });
  if (result.count > 0) {
    await recordDocumentEvent(client, {
      document: { id },
      actorUserId,
      action: 'DADOS_ACESSO_ANONIMIZADOS',
      description: `${result.count} evento(s) tiveram dados de acesso anonimizados.`
    });
  }
  return result.count;
}
