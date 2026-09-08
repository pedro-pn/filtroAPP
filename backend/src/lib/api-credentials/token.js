import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const API_TOKEN_PREFIX = 'fva';
export const API_TOKEN_DUMMY_VERIFIER = '0'.repeat(64);

const SELECTOR_PATTERN = /^[A-Za-z0-9_-]{16}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function verifierBuffer(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) return Buffer.alloc(32);
  return Buffer.from(value, 'hex');
}

export function computeTokenVerifier({ selector, secret, key }) {
  return createHmac('sha256', String(key || ''))
    .update(`filtrovali-api-token:v1:${selector}:${secret}`)
    .digest('hex');
}

export function createApiToken({ key, keyVersion = 1, randomBytesFn = randomBytes } = {}) {
  if (!key || String(key).length < 32) throw new Error('Chave HMAC de token inválida.');
  const selector = randomBytesFn(12).toString('base64url');
  const secret = randomBytesFn(32).toString('base64url');
  const token = `${API_TOKEN_PREFIX}_${selector}_${secret}`;
  return {
    token,
    selector,
    secret,
    secretLastFour: secret.slice(-4),
    verifier: computeTokenVerifier({ selector, secret, key }),
    keyVersion
  };
}

export function parseApiToken(value) {
  if (typeof value !== 'string' || value.trim() !== value) return null;
  const match = value.match(/^fva_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/);
  if (!match) return null;
  const [, selector, secret] = match;
  if (!SELECTOR_PATTERN.test(selector) || !SECRET_PATTERN.test(secret)) return null;
  return { selector, secret };
}

export function verifyApiToken({ rawToken, credential, keyResolver }) {
  const parsed = parseApiToken(rawToken);
  const version = credential?.hashKeyVersion ?? 1;
  const key = keyResolver?.(version) || 'dummy-api-token-key-that-is-at-least-32-characters';
  const selector = parsed?.selector || '0000000000000000';
  const secret = parsed?.secret || '0'.repeat(43);
  const actual = verifierBuffer(computeTokenVerifier({ selector, secret, key }));
  const expected = verifierBuffer(credential?.secretVerifier || API_TOKEN_DUMMY_VERIFIER);
  const equal = timingSafeEqual(actual, expected);
  return Boolean(parsed && credential && credential.selector === parsed.selector && keyResolver?.(version) && equal);
}

export function serializeCredentialPublic(credential) {
  if (!credential) return null;
  const {
    secretVerifier: _secretVerifier,
    hashKeyVersion: _hashKeyVersion,
    token: _token,
    selector,
    ...publicFields
  } = credential;
  return {
    ...publicFields,
    tokenPrefix: selector ? `${API_TOKEN_PREFIX}_${selector}` : null
  };
}
