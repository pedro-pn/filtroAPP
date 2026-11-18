import assert from 'node:assert/strict';
import test from 'node:test';

import { loadEnv } from '../src/config/env.js';

const databaseUrl = 'postgresql://postgres:postgres@localhost:5432/filtrovali?schema=public';

test('loadEnv parses defaults from a minimal valid environment', () => {
  const env = loadEnv({ DATABASE_URL: databaseUrl });

  assert.equal(env.nodeEnv, 'development');
  assert.equal(env.port, 4000);
  assert.equal(env.databaseUrl, databaseUrl);
  assert.equal(env.databaseConnectionLimit, 0);
  assert.equal(env.smtpPort, 587);
  assert.equal(env.smtpSecure, false);
  assert.equal(env.smtpAuthMode, 'password');
  assert.equal(env.microsoftTenantId, '');
  assert.equal(env.microsoftClientId, '');
  assert.equal(env.microsoftClientSecret, '');
  assert.equal(env.sendClientEmails, true);
  assert.equal(env.trustProxy, false);
  assert.deepEqual(env.allowedOrigins, []);
  assert.equal(env.operationsBackupStatusFile, '');
  assert.equal(env.operationsRequireBackupStatus, false);
  assert.equal(env.operationsBackupMaxAgeHours, 26);
  assert.equal(env.operationsAlertJobEnabled, false);
  assert.equal(env.errorTrackingWebhookUrl, '');
  assert.equal(env.projectIntakeWebhookToken, '');
  assert.equal(env.pontomaisApiToken, '');
  assert.equal(env.assinaturasMaxPdfMb, 20);
  assert.equal(env.assinaturasMaxPages, 50);
  assert.equal(env.assinaturasMaxSigners, 20);
  assert.equal(env.assinaturasTokenMaxDays, 90);
  assert.equal(env.assinaturasDeletedRetentionDays, 90);
  assert.equal(env.assinaturasPreviewScale, 1.5);
});

test('loadEnv selects and parses Microsoft OAuth2 application authentication', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl,
    MICROSOFT_TENANT_ID: ' tenant-id ',
    MICROSOFT_CLIENT_ID: ' client-id ',
    MICROSOFT_CLIENT_SECRET: ' client-secret '
  });

  assert.equal(env.smtpAuthMode, 'oauth2');
  assert.equal(env.microsoftTenantId, 'tenant-id');
  assert.equal(env.microsoftClientId, 'client-id');
  assert.equal(env.microsoftClientSecret, 'client-secret');

  const partial = loadEnv({ DATABASE_URL: databaseUrl, MICROSOFT_CLIENT_ID: 'client-id' });
  assert.equal(partial.smtpAuthMode, 'oauth2');
});

test('loadEnv accepts only the supported SMTP authentication modes', () => {
  assert.throws(
    () => loadEnv({ DATABASE_URL: databaseUrl, SMTP_AUTH_MODE: 'basic' }),
    /SMTP_AUTH_MODE/
  );
});

test('loadEnv mantém o token do Ponto Mais opcional e normalizado', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl,
    PONTOMAIS_API_TOKEN: '  integration-secret  '
  });

  assert.equal(env.pontomaisApiToken, 'integration-secret');
});

test('loadEnv parses the project intake webhook token without making it mandatory', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl,
    PROJECT_INTAKE_WEBHOOK_TOKEN: '  intake-secret  '
  });

  assert.equal(env.projectIntakeWebhookToken, 'intake-secret');
});

test('loadEnv fails fast when DATABASE_URL is missing', () => {
  assert.throws(
    () => loadEnv({}),
    /DATABASE_URL/
  );
});

test('loadEnv rejects invalid numeric and boolean values', () => {
  assert.throws(
    () => loadEnv({ DATABASE_URL: databaseUrl, PORT: 'abc' }),
    /PORT/
  );
  assert.throws(
    () => loadEnv({ DATABASE_URL: databaseUrl, SEND_CLIENT_EMAILS: 'maybe' }),
    /SEND_CLIENT_EMAILS/
  );
  for (const [name, value] of [
    ['ASSINATURAS_MAX_PDF_MB', '0'],
    ['ASSINATURAS_MAX_PAGES', '0'],
    ['ASSINATURAS_MAX_SIGNERS', '0'],
    ['ASSINATURAS_TOKEN_MAX_DAYS', '0'],
    ['ASSINATURAS_DELETED_RETENTION_DAYS', '-1'],
    ['ASSINATURAS_PREVIEW_SCALE', '0']
  ]) {
    assert.throws(
      () => loadEnv({ DATABASE_URL: databaseUrl, [name]: value }),
      new RegExp(name)
    );
  }
});

test('loadEnv enforces production security variables', () => {
  assert.throws(
    () => loadEnv({ DATABASE_URL: databaseUrl, NODE_ENV: 'production' }),
    /TRUST_PROXY/
  );
  assert.throws(
    () => loadEnv({
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production',
      TRUST_PROXY: 'true',
      SIGNATURE_TOKEN_SECRET: 'signature-secret',
      SURVEY_TOKEN_SECRET: 'survey-secret'
    }),
    /TRUST_PROXY=true/
  );
  assert.throws(
    () => loadEnv({
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production',
      TRUST_PROXY: '1',
      SURVEY_TOKEN_SECRET: 'survey-secret'
    }),
    /SIGNATURE_TOKEN_SECRET/
  );
  assert.throws(
    () => loadEnv({
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production',
      TRUST_PROXY: '1',
      SIGNATURE_TOKEN_SECRET: 'signature-secret'
    }),
    /SURVEY_TOKEN_SECRET/
  );
  assert.doesNotThrow(() => loadEnv({
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'production',
    TRUST_PROXY: '1',
    SIGNATURE_TOKEN_SECRET: 'signature-secret',
    SURVEY_TOKEN_SECRET: 'survey-secret'
  }));
});
