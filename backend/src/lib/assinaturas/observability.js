const ALLOWED_FIELDS = new Set([
  'attempts',
  'cache',
  'completed',
  'documentId',
  'emailRecipients',
  'found',
  'operationKey',
  'outcome',
  'pageCount',
  'pageNumber',
  'purged',
  'recipients',
  'restored',
  'sizeBytes',
  'staleClaims',
  'status'
]);

function safeValue(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  const text = String(value || '');
  if (!text || text.length > 160 || text.includes('/') || text.includes('\\') || /^[a-f0-9]{32,}$/i.test(text)) return undefined;
  return text;
}

export function signatureOperationLog(event, details = {}, {
  level = 'info',
  logger = console,
  startedAt = Date.now()
} = {}) {
  const payload = {
    module: 'assinaturas',
    event: String(event || 'operation').slice(0, 80),
    durationMs: Math.max(0, Date.now() - Number(startedAt || Date.now()))
  };
  for (const [key, value] of Object.entries(details)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    const safe = safeValue(value);
    if (safe !== undefined) payload[key] = safe;
  }
  const writer = typeof logger?.[level] === 'function' ? logger[level].bind(logger) : logger?.info?.bind(logger);
  writer?.(payload);
  return payload;
}
