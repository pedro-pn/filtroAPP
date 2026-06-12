import assert from 'node:assert/strict';
import test from 'node:test';

import env from '../src/config/env.js';
import { clientEmailsEnabled, sendClientMail, sendMail } from '../src/lib/mailer.js';

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
