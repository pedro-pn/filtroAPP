import 'dotenv/config';
import path from 'node:path';

const reportsDir = process.env.REPORTS_DIR || process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'Relatórios');
const smtpPort = Number(process.env.SMTP_PORT || 587);

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

const env = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || '',
  assetsDir: process.env.ASSETS_DIR || path.resolve(process.cwd(), 'assets'),
  reportsDir,
  uploadDir: reportsDir,
  appUrl: process.env.APP_URL || '',
  allowedOrigin: process.env.ALLOWED_ORIGIN || '',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number.isFinite(smtpPort) ? smtpPort : 587,
  smtpSecure: parseBoolean(process.env.SMTP_SECURE, false),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || '',
  smtpTestDest: process.env.SMTP_TEST_DEST || '',
  zapsignApiToken: process.env.ZAPSIGN_API_TOKEN || '',
  zapsignRefreshToken: process.env.ZAPSIGN_REFRESH_TOKEN || process.env.APSIGN_REFRESH_TOKEN || '',
  zapsignUsername: process.env.ZAPSIGN_USERNAME || process.env.ZAPSIGN_LOGIN || process.env.ZAPSIGN_EMAIL || '',
  zapsignPassword: process.env.ZAPSIGN_PASSWORD || process.env.ZAPSIGN_SENHA || '',
  zapsignOrganizationId: process.env.ZAPSIGN_ORGANIZATION_ID || process.env.ZAPSIGN_ORG_ID || '',
  zapsignWebhookSecret: process.env.ZAPSIGN_WEBHOOK_SECRET || '',
  zapsignWebhookHeader: process.env.ZAPSIGN_WEBHOOK_HEADER || 'x-zapsign-webhook-secret',
  zapsignApiBaseUrl: process.env.ZAPSIGN_API_BASE_URL || 'https://api.zapsign.com.br/api/v1',
  zapsignSandbox: parseBoolean(process.env.ZAPSIGN_SANDBOX, false),
  libreOfficeBinary: process.env.LIBREOFFICE_BINARY || 'soffice',
  nodeEnv: process.env.NODE_ENV || 'development'
};

export default env;
