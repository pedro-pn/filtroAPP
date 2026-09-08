import { randomUUID } from 'node:crypto';

import { getApiOperation, getApiScope } from './catalog.js';

const ADMIN_EVENT_FIELDS = ['credentialId', 'actorUserId', 'type', 'reason', 'summary', 'requestId', 'actorIp', 'actorUserAgent'];
const REQUEST_LOG_FIELDS = [
  'credentialId', 'requestId', 'operationId', 'scopeCode', 'pathTemplate', 'statusCode', 'outcomeCode',
  'responseRows', 'responseBytes', 'durationMs', 'clientIp', 'userAgent', 'filterSummary'
];

function pickDefined(input, fields) {
  return Object.fromEntries(fields.filter(field => input?.[field] !== undefined).map(field => [field, input[field]]));
}

const EVENT_SUMMARY_FIELDS = new Set([
  'scopeCount', 'projectCount', 'projectAccessMode', 'replacementId', 'revokePreviousAt',
  'rotatedFromId', 'operationId', 'rows'
]);
const FILTER_SUMMARY_FIELDS = new Set([
  'projectId', 'natureId', 'updatedSince', 'updatedUntil', 'eventDateFrom', 'eventDateTo',
  'status', 'type', 'includeDeleted', 'active'
]);

const SENSITIVE_TEXT = /fva_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{20,}|\bBearer\s+\S+|\b(?:hmac|secret|password|authorization)\b|\b[a-f0-9]{64}\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:^|\D)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?:\D|$)|(?:^|\s)(?:\/home\/|\/var\/|\/tmp\/|[A-Za-z]:\\)/i;

function sanitizeText(value, { fallback = '[REDACTED]', maxLength = 500 } = {}) {
  if (typeof value !== 'string') return value;
  return SENSITIVE_TEXT.test(value) ? fallback : value.slice(0, maxLength);
}

function sanitizeSummary(value, allowedFields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => allowedFields.has(key) && ['string', 'number', 'boolean'].includes(typeof item))
    .map(([key, item]) => [key, sanitizeText(item, { maxLength: 200 })]));
}

export function sanitizeAdminEvent(input) {
  const result = pickDefined(input, ADMIN_EVENT_FIELDS);
  if ('summary' in result) result.summary = sanitizeSummary(result.summary, EVENT_SUMMARY_FIELDS);
  if ('reason' in result) result.reason = sanitizeText(result.reason);
  if ('requestId' in result) result.requestId = sanitizeText(result.requestId, { fallback: null, maxLength: 128 });
  if ('actorUserAgent' in result) result.actorUserAgent = sanitizeText(result.actorUserAgent, { fallback: null, maxLength: 255 });
  if ('actorIp' in result && typeof result.actorIp === 'string') result.actorIp = result.actorIp.slice(0, 64);
  return result;
}

export function sanitizeRequestLog(input) {
  const result = pickDefined(input, REQUEST_LOG_FIELDS);
  if ('filterSummary' in result) result.filterSummary = sanitizeSummary(result.filterSummary, FILTER_SUMMARY_FIELDS);
  const operation = getApiOperation(result.operationId);
  result.pathTemplate = operation?.path || 'unknown';
  result.scopeCode = getApiScope(result.scopeCode)?.code || operation?.requiredScopes?.[0] || 'unknown';
  if ('requestId' in result) result.requestId = sanitizeText(result.requestId, { fallback: `redacted-${randomUUID()}`, maxLength: 128 });
  if ('userAgent' in result) result.userAgent = sanitizeText(result.userAgent, { fallback: null, maxLength: 255 });
  if ('clientIp' in result && typeof result.clientIp === 'string') result.clientIp = result.clientIp.slice(0, 64);
  return result;
}

export async function recordCredentialEvent(prisma, input) {
  return prisma.apiCredentialEvent.create({ data: sanitizeAdminEvent(input) });
}

export async function recordApiRequest(prisma, input) {
  const data = sanitizeRequestLog(input);
  const minuteStart = new Date();
  minuteStart.setUTCSeconds(0, 0);
  const [log] = await prisma.$transaction([
    prisma.apiRequestLog.create({ data }),
    prisma.apiCredential.updateMany({
      where: {
        id: data.credentialId,
        revokedAt: null,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: minuteStart } }]
      },
      data: { lastUsedAt: new Date() }
    })
  ]);
  return log;
}
