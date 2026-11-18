import assert from 'node:assert/strict';
import test from 'node:test';

import env from '../src/config/env.js';
import {
  clearMicrosoftSmtpTokenCache,
  clientEmailsEnabled,
  createMailerTransport,
  getMicrosoftSmtpAccessToken,
  getMissingMailerConfig,
  sendClientMail,
  sendMail
} from '../src/lib/mailer.js';

const oauthConfig = {
  smtpHost: 'smtp.office365.com',
  smtpPort: 587,
  smtpSecure: false,
  smtpAuthMode: 'oauth2',
  smtpUser: 'mailer@example.com',
  smtpPass: '',
  smtpFrom: 'Filtrovali <mailer@example.com>',
  microsoftTenantId: 'tenant-id',
  microsoftClientId: 'client-id',
  microsoftClientSecret: 'client-secret'
};

test('client email feature flag disables client mail delivery before SMTP transport', async t => {
  const original = env.sendClientEmails;
  t.after(() => {
    env.sendClientEmails = original;
  });

  env.sendClientEmails = false;

  assert.equal(clientEmailsEnabled(), false);
  assert.deepEqual(
    await sendClientMail({ to: 'cliente@example.com', subject: 'Teste', text: 'Teste' }),
    { skipped: true, reason: 'client_emails_disabled' }
  );
});

test('client email feature flag disables all operational mail delivery before SMTP transport', async t => {
  const original = {
    sendClientEmails: env.sendClientEmails,
    smtpTestDest: env.smtpTestDest,
    smtpHost: env.smtpHost,
    smtpUser: env.smtpUser,
    smtpPass: env.smtpPass,
    smtpFrom: env.smtpFrom
  };
  t.after(() => {
    Object.assign(env, original);
  });

  env.sendClientEmails = false;
  env.smtpTestDest = 'teste@example.com';
  env.smtpHost = '';
  env.smtpUser = '';
  env.smtpPass = '';
  env.smtpFrom = '';

  assert.deepEqual(
    await sendMail({ to: 'gestor@example.com', subject: 'Calibração expirada', text: 'Teste' }),
    { skipped: true, reason: 'outbound_emails_disabled' }
  );
});

test('OAuth2 mail configuration requires app credentials instead of an SMTP password', () => {
  assert.deepEqual(getMissingMailerConfig(oauthConfig), []);
  assert.deepEqual(
    getMissingMailerConfig({ ...oauthConfig, microsoftClientSecret: '' }),
    ['microsoftClientSecret']
  );
  assert.deepEqual(
    getMissingMailerConfig({ ...oauthConfig, smtpAuthMode: 'password' }),
    ['smtpPass']
  );
});

test('Microsoft SMTP token uses client credentials, the Outlook scope and a shared cache', async t => {
  clearMicrosoftSmtpTokenCache();
  t.after(clearMicrosoftSmtpTokenCache);
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'access-token', expires_in: 3600 })
    };
  };
  const now = () => 1_000_000;

  const [first, second] = await Promise.all([
    getMicrosoftSmtpAccessToken({ envConfig: oauthConfig, fetchImpl, now }),
    getMicrosoftSmtpAccessToken({ envConfig: oauthConfig, fetchImpl, now })
  ]);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.body.get('client_id'), 'client-id');
  assert.equal(requests[0].options.body.get('client_secret'), 'client-secret');
  assert.equal(requests[0].options.body.get('scope'), 'https://outlook.office365.com/.default');
  assert.equal(requests[0].options.body.get('grant_type'), 'client_credentials');
  assert.equal(first.accessToken, 'access-token');
  assert.equal(first.expiresAt, 4_600_000);
  assert.deepEqual(second, first);
});

test('OAuth2 transport provisions the Microsoft access token for Nodemailer', async t => {
  clearMicrosoftSmtpTokenCache();
  t.after(clearMicrosoftSmtpTokenCache);
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ access_token: 'smtp-oauth-token', expires_in: 3600 })
  });
  const transporter = createMailerTransport({ envConfig: oauthConfig, fetchImpl });
  const oauth2 = transporter.transporter.getAuth().oauth2;

  const token = await new Promise((resolve, reject) => {
    oauth2.getToken(false, (error, accessToken) => {
      if (error) reject(error);
      else resolve(accessToken);
    });
  });

  assert.equal(transporter.transporter.options.auth.type, 'OAuth2');
  assert.equal(transporter.transporter.options.tls.rejectUnauthorized, true);
  assert.equal(token, 'smtp-oauth-token');
});

test('Microsoft token errors include the Entra response without exposing the configured secret', async t => {
  clearMicrosoftSmtpTokenCache();
  t.after(clearMicrosoftSmtpTokenCache);
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({
      error: 'invalid_client',
      error_description: 'Application credentials are invalid.'
    })
  });

  await assert.rejects(
    getMicrosoftSmtpAccessToken({ envConfig: oauthConfig, fetchImpl }),
    error => {
      assert.match(error.message, /invalid_client/);
      assert.doesNotMatch(error.message, /client-secret/);
      assert.equal(error.code, 'EMICROSOFTOAUTH2');
      return true;
    }
  );
});
