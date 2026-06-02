import assert from 'node:assert/strict';
import test from 'node:test';

import env from '../src/config/env.js';
import { clientEmailsEnabled, sendClientMail } from '../src/lib/mailer.js';

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

