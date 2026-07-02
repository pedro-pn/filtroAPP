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
  assert.equal(env.sendClientEmails, true);
  assert.equal(env.trustProxy, false);
  assert.deepEqual(env.allowedOrigins, []);
  assert.equal(env.operationsBackupStatusFile, '');
  assert.equal(env.operationsRequireBackupStatus, false);
  assert.equal(env.operationsBackupMaxAgeHours, 26);
  assert.equal(env.operationsAlertJobEnabled, false);
  assert.equal(env.errorTrackingWebhookUrl, '');
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
