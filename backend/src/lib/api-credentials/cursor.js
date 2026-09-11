import { createHmac, timingSafeEqual } from 'node:crypto';

export class ApiCursorError extends Error {
  constructor() {
    super('Cursor inválido ou incompatível com os filtros informados.');
    this.name = 'ApiCursorError';
    this.code = 'INVALID_CURSOR';
    this.statusCode = 400;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sign(encoded, key) {
  return createHmac('sha256', String(key || ''))
    .update(`filtrovali-integration-cursor:v1:${encoded}`)
    .digest('base64url');
}

function equalSignature(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  const paddedA = Buffer.alloc(43);
  const paddedB = Buffer.alloc(43);
  a.copy(paddedA, 0, 0, 43);
  b.copy(paddedB, 0, 0, 43);
  return timingSafeEqual(paddedA, paddedB) && a.length === b.length;
}

export function createSignedCursor({ payload, key }) {
  if (!key) throw new Error('Chave de cursor indisponível.');
  const encoded = Buffer.from(stableJson(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, key)}`;
}

export function readSignedCursor({ cursor, key, operationId, filters, positionKeys = ['updatedAt', 'id'] }) {
  try {
    const [encoded, signature, extra] = String(cursor || '').split('.');
    if (!encoded || !signature || extra || !equalSignature(signature, sign(encoded, key))) throw new Error();
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.version !== 1 || payload.operationId !== operationId) throw new Error();
    if (stableJson(payload.filters || {}) !== stableJson(filters || {})) throw new Error();
    if (!payload.snapshotAt || positionKeys.some(key => typeof payload.position?.[key] !== 'string' || !payload.position[key])) throw new Error();
    return payload;
  } catch {
    throw new ApiCursorError();
  }
}
