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
  zapsignWebhookSecret: process.env.ZAPSIGN_WEBHOOK_SECRET || '',
  zapsignWebhookHeader: process.env.ZAPSIGN_WEBHOOK_HEADER || 'x-zapsign-webhook-secret',
  zapsignApiBaseUrl: process.env.ZAPSIGN_API_BASE_URL || 'https://api.zapsign.com.br/api/v1',
  zapsignSandbox: parseBoolean(process.env.ZAPSIGN_SANDBOX, false),
  nodeEnv: process.env.NODE_ENV || 'development'
};

export default env;
