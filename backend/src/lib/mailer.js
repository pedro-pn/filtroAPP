import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

import env from '../config/env.js';
import { EMAIL_LOGO_CID } from './email-templates.js';

const commonRequiredConfig = ['smtpHost', 'smtpPort', 'smtpUser', 'smtpFrom'];
const authRequiredConfig = {
  password: ['smtpPass'],
  oauth2: ['microsoftTenantId', 'microsoftClientId', 'microsoftClientSecret']
};
const microsoftSmtpScope = 'https://outlook.office365.com/.default';
const tokenRefreshMarginMs = 5 * 60 * 1000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const emailLogoPath = path.resolve(__dirname, '../../assets/Logo/LOGO_BRANCA.png');
let microsoftTokenCache = null;
let microsoftTokenRequest = null;

function mailAuthMode(envConfig = env) {
  return envConfig.smtpAuthMode === 'oauth2' ? 'oauth2' : 'password';
}

export function getMissingMailerConfig(envConfig = env) {
  const requiredConfig = [
    ...commonRequiredConfig,
    ...(authRequiredConfig[mailAuthMode(envConfig)] || [])
  ];
  return requiredConfig.filter(key => !envConfig[key]);
}

export function assertMailerConfigured(envConfig = env) {
  const missing = getMissingMailerConfig(envConfig);
  if (!missing.length) return;
  throw new Error(`Configuração SMTP (${mailAuthMode(envConfig)}) ausente: ${missing.join(', ')}`);
}

function microsoftTokenCacheKey(envConfig) {
  return `${envConfig.microsoftTenantId}:${envConfig.microsoftClientId}`;
}

function microsoftTokenError(status, payload) {
  const details = [payload?.error, payload?.error_description].filter(Boolean).join(': ');
  const error = new Error(
    `Falha ao obter token OAuth2 da Microsoft (${status})${details ? `: ${details}` : '.'}`
  );
  error.code = 'EMICROSOFTOAUTH2';
  error.status = status;
  return error;
}

export async function requestMicrosoftSmtpAccessToken({
  envConfig = env,
  fetchImpl = globalThis.fetch,
  now = Date.now
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Este runtime não oferece fetch para solicitar o token OAuth2 da Microsoft.');
  }

  const endpoint = `https://login.microsoftonline.com/${encodeURIComponent(envConfig.microsoftTenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: envConfig.microsoftClientId,
    client_secret: envConfig.microsoftClientSecret,
    scope: microsoftSmtpScope,
    grant_type: 'client_credentials'
  });
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const responseText = await response.text();
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) throw microsoftTokenError(response.status, payload);
  if (!payload.access_token) throw microsoftTokenError(response.status, payload);

  const expiresInSeconds = Math.max(Number(payload.expires_in) || 0, 60);
  return {
    accessToken: payload.access_token,
    expiresAt: now() + expiresInSeconds * 1000
  };
}

export function clearMicrosoftSmtpTokenCache() {
  microsoftTokenCache = null;
  microsoftTokenRequest = null;
}

export async function getMicrosoftSmtpAccessToken({
  envConfig = env,
  fetchImpl = globalThis.fetch,
  forceRefresh = false,
  now = Date.now
} = {}) {
  const cacheKey = microsoftTokenCacheKey(envConfig);
  const currentTime = now();
  if (forceRefresh && microsoftTokenCache?.key === cacheKey) microsoftTokenCache = null;
  if (
    microsoftTokenCache?.key === cacheKey
    && microsoftTokenCache.expiresAt > currentTime + tokenRefreshMarginMs
  ) {
    return microsoftTokenCache;
  }
  if (microsoftTokenRequest?.key === cacheKey) return microsoftTokenRequest.promise;

  const promise = requestMicrosoftSmtpAccessToken({ envConfig, fetchImpl, now })
    .then(token => {
      microsoftTokenCache = { key: cacheKey, ...token };
      return microsoftTokenCache;
    })
    .finally(() => {
      if (microsoftTokenRequest?.promise === promise) microsoftTokenRequest = null;
    });
  microsoftTokenRequest = { key: cacheKey, promise };
  return promise;
}

export function createMailerTransport({ envConfig = env, fetchImpl = globalThis.fetch } = {}) {
  assertMailerConfigured(envConfig);
  const authMode = mailAuthMode(envConfig);

  const transporter = nodemailer.createTransport({
    host: envConfig.smtpHost,
    port: envConfig.smtpPort,
    secure: envConfig.smtpSecure,
    auth: authMode === 'oauth2'
      ? { type: 'OAuth2', user: envConfig.smtpUser }
      : { user: envConfig.smtpUser, pass: envConfig.smtpPass },
    tls: {
      // Tokens OAuth2 nunca devem ser enviados por uma conexão com certificado não confiável.
      rejectUnauthorized: authMode === 'oauth2'
    }
  });

  if (authMode === 'oauth2') {
    transporter.set('oauth2_provision_cb', (_user, renew, callback) => {
      getMicrosoftSmtpAccessToken({ envConfig, fetchImpl, forceRefresh: renew })
        .then(({ accessToken, expiresAt }) => callback(null, accessToken, expiresAt))
        .catch(callback);
    });
  }

  return transporter;
}

export async function verifyMailer() {
  const transporter = createMailerTransport();
  await transporter.verify();
  return transporter;
}

export async function sendMail(message) {
  if (!outboundEmailsEnabled()) {
    return outboundEmailDisabledResult();
  }

  const transporter = createMailerTransport();
  const attachments = Array.isArray(message.attachments) ? message.attachments.slice() : [];
  if (fs.existsSync(emailLogoPath) && !attachments.some(item => item && item.cid === EMAIL_LOGO_CID)) {
    attachments.push({
      filename: 'LOGO_BRANCA.png',
      path: emailLogoPath,
      cid: EMAIL_LOGO_CID
    });
  }
  return transporter.sendMail({
    from: env.smtpFrom,
    ...message,
    attachments
  });
}

export function clientEmailsEnabled(envConfig = env) {
  return outboundEmailsEnabled(envConfig);
}

export function outboundEmailsEnabled(envConfig = env) {
  return envConfig.sendClientEmails !== false;
}

export function outboundEmailDisabledResult() {
  return {
    skipped: true,
    reason: 'outbound_emails_disabled'
  };
}

export async function sendClientMail(message) {
  if (!clientEmailsEnabled()) {
    return {
      skipped: true,
      reason: 'client_emails_disabled'
    };
  }
  return sendMail(message);
}
