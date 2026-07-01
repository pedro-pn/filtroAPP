import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

function emptyToUndefined(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

function requiredString(name) {
  return z.preprocess(
    emptyToUndefined,
    z.string({
      required_error: `${name} deve ser configurado.`,
      invalid_type_error: `${name} deve ser texto.`
    }).min(1, `${name} deve ser configurado.`)
  );
}

function stringWithDefault(defaultValue = '') {
  return z.preprocess(emptyToUndefined, z.string().default(defaultValue));
}

function integerWithDefault(name, defaultValue, { min, max } = {}) {
  let schema = z.number({
    invalid_type_error: `${name} deve ser numerico.`
  }).int(`${name} deve ser inteiro.`);
  if (min !== undefined) schema = schema.min(min, `${name} deve ser maior ou igual a ${min}.`);
  if (max !== undefined) schema = schema.max(max, `${name} deve ser menor ou igual a ${max}.`);

  return z.preprocess(value => {
    const normalized = emptyToUndefined(value);
    return normalized === undefined ? defaultValue : Number(normalized);
  }, schema);
}

function booleanWithDefault(name, defaultValue) {
  return z.preprocess(value => {
    const normalized = emptyToUndefined(value);
    if (normalized === undefined) return defaultValue;
    const lower = String(normalized).toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(lower)) return true;
    if (['0', 'false', 'no', 'off'].includes(lower)) return false;
    return normalized;
  }, z.boolean({ invalid_type_error: `${name} deve ser booleano (true/false).` }));
}

function parseOrigins(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function parseTrustProxy(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(lower)) return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (['true', 'yes', 'on'].includes(lower)) return true;
  return raw;
}

export function assertProductionTrustProxyConfigured({ nodeEnv, trustProxyConfigured, trustProxy = false }) {
  if (nodeEnv !== 'production') return;
  if (!trustProxyConfigured) {
    throw new Error('TRUST_PROXY deve ser configurado explicitamente em produção. Use false apenas se o backend não estiver atrás de proxy.');
  }
  if (trustProxy === true) {
    throw new Error('TRUST_PROXY=true é inseguro em produção. Configure false, um hop count numérico ou uma lista explícita de proxies/CIDRs.');
  }
}

export function assertProductionSignatureTokenSecretConfigured({ nodeEnv, signatureTokenSecret }) {
  if (nodeEnv !== 'production') return;
  if (!signatureTokenSecret) {
    throw new Error('SIGNATURE_TOKEN_SECRET deve ser configurado explicitamente em produção.');
  }
}

export function assertProductionSurveyTokenSecretConfigured({ nodeEnv, surveyTokenSecret }) {
  if (nodeEnv !== 'production') return;
  if (!surveyTokenSecret) {
    throw new Error('SURVEY_TOKEN_SECRET deve ser configurado explicitamente em produção.');
  }
}

const rawEnvSchema = z.object({
  NODE_ENV: stringWithDefault('development'),
  PORT: integerWithDefault('PORT', 4000, { min: 1, max: 65535 }),
  DATABASE_URL: requiredString('DATABASE_URL'),
  DATABASE_CONNECTION_LIMIT: integerWithDefault('DATABASE_CONNECTION_LIMIT', 0, { min: 0 }),
  RESOURCE_LIST_CACHE_TTL_MS: integerWithDefault('RESOURCE_LIST_CACHE_TTL_MS', 60000, { min: 0 }),
  DASHBOARD_CACHE_TTL_MS: integerWithDefault('DASHBOARD_CACHE_TTL_MS', 60000, { min: 0 }),
  ASSETS_DIR: stringWithDefault(path.resolve(process.cwd(), 'assets')),
  REPORTS_DIR: stringWithDefault(''),
  UPLOAD_DIR: stringWithDefault(''),
  APP_URL: stringWithDefault(''),
  ALLOWED_ORIGIN: stringWithDefault(''),
  TRUST_PROXY: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_HOST: stringWithDefault(''),
  SMTP_PORT: integerWithDefault('SMTP_PORT', 587, { min: 1, max: 65535 }),
  SMTP_SECURE: booleanWithDefault('SMTP_SECURE', false),
  SMTP_USER: stringWithDefault(''),
  SMTP_PASS: stringWithDefault(''),
  SMTP_FROM: stringWithDefault(''),
  SMTP_TEST_DEST: stringWithDefault(''),
  SEND_CLIENT_EMAILS: booleanWithDefault('SEND_CLIENT_EMAILS', true),
  PRIVACY_NOTIFICATION_EMAIL: stringWithDefault(''),
  LGPD_NOTIFICATION_EMAIL: stringWithDefault(''),
  ZAPSIGN_API_TOKEN: stringWithDefault(''),
  ZAPSIGN_REFRESH_TOKEN: stringWithDefault(''),
  APSIGN_REFRESH_TOKEN: stringWithDefault(''),
  ZAPSIGN_USERNAME: stringWithDefault(''),
  ZAPSIGN_LOGIN: stringWithDefault(''),
  ZAPSIGN_EMAIL: stringWithDefault(''),
  ZAPSIGN_PASSWORD: stringWithDefault(''),
  ZAPSIGN_SENHA: stringWithDefault(''),
  ZAPSIGN_ORGANIZATION_ID: stringWithDefault(''),
  ZAPSIGN_ORG_ID: stringWithDefault(''),
  SURVEY_TOKEN_SECRET: stringWithDefault(''),
  SIGNATURE_TOKEN_SECRET: stringWithDefault(''),
  SIGNATURE_TOKEN_SECRET_PREVIOUS: stringWithDefault(''),
  DATA_RETENTION_JOB_ENABLED: booleanWithDefault('DATA_RETENTION_JOB_ENABLED', false),
  ZAPSIGN_API_BASE_URL: stringWithDefault('https://api.zapsign.com.br/api/v1'),
  LIBREOFFICE_BINARY: stringWithDefault('soffice'),
  DOCX_TO_PDF_TIMEOUT_MS: integerWithDefault('DOCX_TO_PDF_TIMEOUT_MS', 60000, { min: 1 }),
  PRISMA_SLOW_QUERY_MS: integerWithDefault('PRISMA_SLOW_QUERY_MS', 0, { min: 0 }),
  SLOW_OPERATION_LOG_MS: integerWithDefault('SLOW_OPERATION_LOG_MS', 0, { min: 0 })
}).passthrough().superRefine((value, ctx) => {
  const trustProxyConfigured = value.TRUST_PROXY !== undefined && String(value.TRUST_PROXY).trim() !== '';
  const trustProxy = parseTrustProxy(value.TRUST_PROXY);

  for (const check of [
    () => assertProductionTrustProxyConfigured({ nodeEnv: value.NODE_ENV, trustProxyConfigured, trustProxy }),
    () => assertProductionSignatureTokenSecretConfigured({
      nodeEnv: value.NODE_ENV,
      signatureTokenSecret: value.SIGNATURE_TOKEN_SECRET
    }),
    () => assertProductionSurveyTokenSecretConfigured({
      nodeEnv: value.NODE_ENV,
      surveyTokenSecret: value.SURVEY_TOKEN_SECRET
    })
  ]) {
    try {
      check();
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
});

function formatEnvIssues(error) {
  return error.issues
    .map(issue => {
      const pathName = issue.path.length ? issue.path.join('.') : 'ambiente';
      return `- ${pathName}: ${issue.message}`;
    })
    .join('\n');
}

export function loadEnv(source = process.env) {
  const result = rawEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Configuração de ambiente inválida:\n${formatEnvIssues(result.error)}`);
  }

  const raw = result.data;
  const reportsDir = raw.REPORTS_DIR || raw.UPLOAD_DIR || path.resolve(process.cwd(), 'Relatórios');
  const trustProxyConfigured = raw.TRUST_PROXY !== undefined && String(raw.TRUST_PROXY).trim() !== '';
  const trustProxy = parseTrustProxy(raw.TRUST_PROXY);

  return {
    port: raw.PORT,
    databaseUrl: raw.DATABASE_URL,
    databaseConnectionLimit: raw.DATABASE_CONNECTION_LIMIT,
    resourceListCacheTtlMs: raw.RESOURCE_LIST_CACHE_TTL_MS,
    dashboardCacheTtlMs: raw.DASHBOARD_CACHE_TTL_MS,
    assetsDir: raw.ASSETS_DIR,
    reportsDir,
    uploadDir: reportsDir,
    appUrl: raw.APP_URL,
    allowedOrigin: raw.ALLOWED_ORIGIN,
    allowedOrigins: parseOrigins(raw.ALLOWED_ORIGIN),
    trustProxy,
    trustProxyConfigured,
    smtpHost: raw.SMTP_HOST,
    smtpPort: raw.SMTP_PORT,
    smtpSecure: raw.SMTP_SECURE,
    smtpUser: raw.SMTP_USER,
    smtpPass: raw.SMTP_PASS,
    smtpFrom: raw.SMTP_FROM,
    smtpTestDest: raw.SMTP_TEST_DEST,
    sendClientEmails: raw.SEND_CLIENT_EMAILS,
    privacyNotificationEmail: raw.PRIVACY_NOTIFICATION_EMAIL || raw.LGPD_NOTIFICATION_EMAIL,
    zapsignApiToken: raw.ZAPSIGN_API_TOKEN,
    zapsignRefreshToken: raw.ZAPSIGN_REFRESH_TOKEN || raw.APSIGN_REFRESH_TOKEN,
    zapsignUsername: raw.ZAPSIGN_USERNAME || raw.ZAPSIGN_LOGIN || raw.ZAPSIGN_EMAIL,
    zapsignPassword: raw.ZAPSIGN_PASSWORD || raw.ZAPSIGN_SENHA,
    zapsignOrganizationId: raw.ZAPSIGN_ORGANIZATION_ID || raw.ZAPSIGN_ORG_ID,
    surveyTokenSecret: raw.SURVEY_TOKEN_SECRET,
    signatureTokenSecret: raw.SIGNATURE_TOKEN_SECRET,
    previousSignatureTokenSecrets: parseList(raw.SIGNATURE_TOKEN_SECRET_PREVIOUS),
    dataRetentionJobEnabled: raw.DATA_RETENTION_JOB_ENABLED,
    zapsignApiBaseUrl: raw.ZAPSIGN_API_BASE_URL,
    libreOfficeBinary: raw.LIBREOFFICE_BINARY,
    docxToPdfTimeoutMs: raw.DOCX_TO_PDF_TIMEOUT_MS,
    prismaSlowQueryMs: raw.PRISMA_SLOW_QUERY_MS,
    slowOperationLogMs: raw.SLOW_OPERATION_LOG_MS,
    nodeEnv: raw.NODE_ENV
  };
}

const env = loadEnv();

export default env;
