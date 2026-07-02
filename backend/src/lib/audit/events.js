export const AUDIT_MODULES = {
  RDO: 'rdo',
  EPI: 'epi'
};

export const AUDIT_ENTITY_TYPES = {
  REPORT: 'report',
  EPI_SIGNATURE_REQUEST: 'epi-signature-request'
};

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function evidenceValue(evidence, key) {
  return stringValue(evidence?.[key]) || null;
}

function required(value, name) {
  if (!stringValue(value)) {
    throw new TypeError(`${name} is required for audit events.`);
  }
  return stringValue(value);
}

export function normalizeAuditEvent(event) {
  const module = required(event?.module, 'module');
  const entityType = required(event?.entityType, 'entityType');
  const entityId = required(event?.entityId, 'entityId');
  const action = required(event?.action, 'action');
  const evidence = event?.evidence || {};

  return {
    module,
    entityType,
    entityId,
    relatedEntityId: stringValue(event?.relatedEntityId) || null,
    actorUserId: stringValue(event?.actorUserId) || null,
    action,
    description: stringValue(event?.description) || null,
    evidence: {
      ipAddress: evidenceValue(evidence, 'ipAddress'),
      userAgent: evidenceValue(evidence, 'userAgent')
    }
  };
}

export async function recordAuditEvent(client, event) {
  if (!client) throw new TypeError('Prisma client is required for audit events.');
  const normalized = normalizeAuditEvent(event);

  if (
    normalized.module === AUDIT_MODULES.RDO
    && normalized.entityType === AUDIT_ENTITY_TYPES.REPORT
  ) {
    return client.reportAuditLog.create({
      data: {
        reportId: normalized.entityId,
        versionId: normalized.relatedEntityId,
        userId: normalized.actorUserId,
        action: normalized.action,
        description: normalized.description,
        ipAddress: normalized.evidence.ipAddress,
        userAgent: normalized.evidence.userAgent
      }
    });
  }

  if (
    normalized.module === AUDIT_MODULES.EPI
    && normalized.entityType === AUDIT_ENTITY_TYPES.EPI_SIGNATURE_REQUEST
  ) {
    if (!client.epiSignatureRequestAuditLog?.create) return null;
    return client.epiSignatureRequestAuditLog.create({
      data: {
        requestId: normalized.entityId,
        action: normalized.action,
        ipAddress: normalized.evidence.ipAddress,
        userAgent: normalized.evidence.userAgent
      }
    });
  }

  throw new TypeError(`Unsupported audit target: ${normalized.module}/${normalized.entityType}.`);
}
