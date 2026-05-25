import 'dotenv/config';
import path from 'node:path';

const reportsDir = process.env.REPORTS_DIR || process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'Relatórios');
const smtpPort = Number(process.env.SMTP_PORT || 587);

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseOrigins(value) {
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

const nodeEnv = process.env.NODE_ENV || 'development';
const trustProxyConfigured = process.env.TRUST_PROXY !== undefined && String(process.env.TRUST_PROXY).trim() !== '';
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
assertProductionTrustProxyConfigured({ nodeEnv, trustProxyConfigured, trustProxy });

const env = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || '',
  assetsDir: process.env.ASSETS_DIR || path.resolve(process.cwd(), 'assets'),
  reportsDir,
  uploadDir: reportsDir,
  appUrl: process.env.APP_URL || '',
  allowedOrigin: process.env.ALLOWED_ORIGIN || '',
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGIN),
  trustProxy,
  trustProxyConfigured,
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number.isFinite(smtpPort) ? smtpPort : 587,
  smtpSecure: parseBoolean(process.env.SMTP_SECURE, false),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || '',
  smtpTestDest: process.env.SMTP_TEST_DEST || '',
  privacyNotificationEmail: process.env.PRIVACY_NOTIFICATION_EMAIL || process.env.LGPD_NOTIFICATION_EMAIL || '',
  zapsignApiToken: process.env.ZAPSIGN_API_TOKEN || '',
  zapsignRefreshToken: process.env.ZAPSIGN_REFRESH_TOKEN || process.env.APSIGN_REFRESH_TOKEN || '',
  zapsignUsername: process.env.ZAPSIGN_USERNAME || process.env.ZAPSIGN_LOGIN || process.env.ZAPSIGN_EMAIL || '',
  zapsignPassword: process.env.ZAPSIGN_PASSWORD || process.env.ZAPSIGN_SENHA || '',
  zapsignOrganizationId: process.env.ZAPSIGN_ORGANIZATION_ID || process.env.ZAPSIGN_ORG_ID || '',
  surveyTokenSecret: process.env.SURVEY_TOKEN_SECRET || '',
  dataRetentionJobEnabled: parseBoolean(process.env.DATA_RETENTION_JOB_ENABLED, false),
  zapsignApiBaseUrl: process.env.ZAPSIGN_API_BASE_URL || 'https://api.zapsign.com.br/api/v1',
  libreOfficeBinary: process.env.LIBREOFFICE_BINARY || 'soffice',
  nodeEnv
};

export default env;
