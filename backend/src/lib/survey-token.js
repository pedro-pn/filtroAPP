import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import env from '../config/env.js';
import { hashToken } from './auth.js';

const ALGORITHM = 'aes-256-gcm';

function secretMaterial() {
  return env.surveyTokenSecret || env.databaseUrl || 'dev-survey-token-secret';
}

function key() {
  return createHash('sha256').update(secretMaterial()).digest();
}

export function createSurveyToken() {
  return randomBytes(32).toString('hex');
}

export function surveyTokenHash(token) {
  return hashToken(token);
}

export function encryptSurveyToken(token) {
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

export function decryptSurveyToken({ tokenEncrypted, tokenIv, tokenAuthTag }) {
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(tokenIv, 'base64'));
  decipher.setAuthTag(Buffer.from(tokenAuthTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(tokenEncrypted, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

export function surveyTokenData() {
  const token = createSurveyToken();
  return {
    token,
    tokenHash: surveyTokenHash(token),
    ...encryptSurveyToken(token)
  };
}
