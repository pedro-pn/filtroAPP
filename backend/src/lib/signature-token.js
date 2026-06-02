import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import env from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';

function secretMaterial() {
  if (env.signatureTokenSecret) return env.signatureTokenSecret;
  if (env.nodeEnv === 'production') {
    throw new Error('SIGNATURE_TOKEN_SECRET deve ser configurado explicitamente em produção.');
  }
  return env.surveyTokenSecret || 'dev-signature-token-secret';
}

function key(material = secretMaterial()) {
  return createHash('sha256').update(material).digest();
}

function decryptionSecrets() {
  return [
    secretMaterial(),
    ...(Array.isArray(env.previousSignatureTokenSecrets) ? env.previousSignatureTokenSecrets : [])
  ].filter(Boolean);
}

export function createSignatureToken() {
  return randomBytes(32).toString('hex');
}

export function signatureTokenHash(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

export function encryptSignatureToken(token) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    tokenEncrypted: encrypted.toString('base64'),
    tokenIv: iv.toString('base64'),
    tokenAuthTag: authTag.toString('base64')
  };
}

export function decryptSignatureToken({ tokenEncrypted, tokenIv, tokenAuthTag }) {
  let lastError = null;
  for (const material of decryptionSecrets()) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key(material), Buffer.from(tokenIv, 'base64'));
      decipher.setAuthTag(Buffer.from(tokenAuthTag, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(tokenEncrypted, 'base64')),
        decipher.final()
      ]);
      return decrypted.toString('utf8');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Token de assinatura indecifrável.');
}

export function signatureTokenData() {
  const token = createSignatureToken();
  return {
    token,
    tokenHash: signatureTokenHash(token),
    ...encryptSignatureToken(token)
  };
}
