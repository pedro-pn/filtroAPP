function sanitizeSnapshot(value) {
  if (value == null) return null;
  const blocked = /password|token|secret|cookie|authorization/i;
  const visit = input => {
    if (Array.isArray(input)) return input.map(visit).filter(item => item !== undefined);
    if (input instanceof Date) return input.toISOString();
    if (typeof input === 'bigint') return input.toString();
    if (['function', 'symbol', 'undefined'].includes(typeof input)) return undefined;
    if (!input || typeof input !== 'object') return input;
    if (typeof input.toJSON === 'function') {
      const serialized = input.toJSON();
      if (serialized !== input) return visit(serialized);
    }
    const result = {};
    for (const [key, child] of Object.entries(input)) {
      if (blocked.test(key)) continue;
      const sanitized = visit(child);
      if (sanitized !== undefined) result[key] = sanitized;
    }
    return result;
  };
  return visit(value);
}

export async function recordEfetivoAudit(tx, {
  planId = null,
  actorUserId = null,
  action,
  entityType,
  entityId,
  summary,
  beforeData = null,
  afterData = null,
  evidence = {}
}) {
  return tx.efetivoAuditEvent.create({
    data: {
      planId,
      actorUserId,
      action,
      entityType,
      entityId,
      summary,
      beforeData: sanitizeSnapshot(beforeData),
      afterData: sanitizeSnapshot(afterData),
      ipAddress: evidence.ipAddress || null,
      userAgent: evidence.userAgent || null
    }
  });
}

export { sanitizeSnapshot };
