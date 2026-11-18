import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAlertThrottle,
  errorFingerprint,
  operationalErrorEmailMessage,
  redactPersonalData,
  sendOperationalErrorEmail
} from '../src/lib/operations/alert-email.js';
import { captureOperationalError } from '../src/lib/operations/error-tracking.js';

const config = { nodeEnv: 'production', operationsAlertEmailThrottleMs: 30 * 60 * 1000 };

function payload(overrides = {}) {
  return {
    source: 'backend.http',
    name: 'TypeError',
    message: 'Cannot read properties of undefined (reading \'id\')',
    stack: 'TypeError: Cannot read properties of undefined\n    at handler (/app/src/routes/reports.js:10:5)\n    at next (/app/node_modules/express/router.js:1:1)',
    context: { method: 'GET', path: '/api/reports/123', statusCode: 500, requestId: 'req-1', userId: 42 },
    version: 'abc1234',
    occurredAt: '2026-11-18T12:00:00.000Z',
    ...overrides
  };
}

test('errorFingerprint groups the same error on different record ids', () => {
  const first = errorFingerprint(payload());
  const second = errorFingerprint(payload({ context: { path: '/api/reports/987' } }));
  const otherRoute = errorFingerprint(payload({ context: { path: '/api/projects/1' } }));
  assert.equal(first, second);
  assert.notEqual(first, otherRoute);
});

test('createAlertThrottle allows one send per window and counts suppressed occurrences', () => {
  let now = 0;
  const throttle = createAlertThrottle({ windowMs: 1000, nowFn: () => now });
  assert.deepEqual(throttle.take('a'), { send: true, suppressed: 0 });
  assert.equal(throttle.take('a').send, false);
  assert.equal(throttle.take('a').suppressed, 2);
  assert.equal(throttle.take('b').send, true);
  now = 1000;
  assert.deepEqual(throttle.take('a'), { send: true, suppressed: 2 });
});

test('createAlertThrottle caps the number of tracked fingerprints', () => {
  const throttle = createAlertThrottle({ windowMs: 1000, nowFn: () => 0, maxEntries: 3 });
  for (const key of ['a', 'b', 'c', 'd']) throttle.take(key);
  assert.equal(throttle.size(), 3);
  assert.equal(throttle.take('a').send, true);
});

test('operationalErrorEmailMessage keeps only safe fields and redacts personal data', () => {
  const message = operationalErrorEmailMessage(payload({
    message: 'Invalid `prisma.collaborator.create()` invocation for joao@example.com cpf 123.456.789-09\n{ data: { cpf: "12345678909", name: "João" } }',
    context: { path: '/api/collaborators', userId: 7, body: { cpf: '12345678909' } }
  }), { suppressed: 3, config });

  assert.match(message.subject, /^\[filtroAPP production\] Erro: TypeError:/);
  assert.match(message.text, /Rota: \/api\/collaborators/);
  assert.match(message.text, /Usuário \(id\): 7/);
  assert.match(message.text, /Versão: abc1234/);
  assert.match(message.text, /suprimidas desde o último e-mail: 3 \(janela de 30 min\)/);
  assert.match(message.text, /at handler/);
  assert.doesNotMatch(message.text, /joao@example\.com/);
  assert.doesNotMatch(message.text, /123\.456\.789-09/);
  assert.doesNotMatch(message.text, /12345678909/);
  assert.doesNotMatch(message.text, /João/);
});

test('redactPersonalData masks e-mails and CPFs', () => {
  assert.equal(redactPersonalData('a@b.com 111.222.333-44'), '[email] [cpf]');
});

test('sendOperationalErrorEmail skips without recipients', async () => {
  const result = await sendOperationalErrorEmail(payload(), {
    recipients: [],
    sendMailFn: async () => {
      throw new Error('should not send');
    }
  });
  assert.deepEqual(result, { sent: false, reason: 'not-configured' });
});

test('sendOperationalErrorEmail throttles repeated errors and reports suppressed count later', async () => {
  let now = 0;
  const throttle = createAlertThrottle({ windowMs: 1000, nowFn: () => now });
  const sent = [];
  const options = {
    recipients: ['ops@example.test', 'dev@example.test'],
    throttle,
    config,
    sendMailFn: async message => {
      sent.push(message);
      return { messageId: 'x' };
    }
  };

  assert.equal((await sendOperationalErrorEmail(payload(), options)).sent, true);
  const throttled = await sendOperationalErrorEmail(payload(), options);
  assert.equal(throttled.reason, 'throttled');
  now = 1000;
  assert.equal((await sendOperationalErrorEmail(payload(), options)).sent, true);

  assert.equal(sent.length, 2);
  assert.equal(sent[0].to, 'ops@example.test, dev@example.test');
  assert.match(sent[1].text, /suprimidas desde o último e-mail: 1/);
});

test('sendOperationalErrorEmail releases the fingerprint when delivery fails', async () => {
  const throttle = createAlertThrottle({ windowMs: 60_000, nowFn: () => 0 });
  const failing = await sendOperationalErrorEmail(payload(), {
    recipients: ['ops@example.test'],
    throttle,
    logger: { warn() {} },
    sendMailFn: async () => {
      throw new Error('smtp down');
    }
  });
  assert.equal(failing.reason, 'send-error');
  assert.equal(throttle.take(errorFingerprint(payload())).send, true);
});

test('sendOperationalErrorEmail reports outbound-disabled when the mailer skips', async () => {
  const result = await sendOperationalErrorEmail(payload(), {
    recipients: ['ops@example.test'],
    throttle: createAlertThrottle({ windowMs: 1000 }),
    sendMailFn: async () => ({ skipped: true, reason: 'outbound_emails_disabled' })
  });
  assert.deepEqual(result, { sent: false, reason: 'outbound-disabled' });
});

test('captureOperationalError sends e-mail even without webhook', async () => {
  const emails = [];
  const result = await captureOperationalError(new Error('boom'), {
    webhookUrl: '',
    source: 'job.omie-sync',
    context: { job: 'omie-sync' },
    emailSender: async message => {
      emails.push(message);
      return { sent: true };
    }
  });
  assert.equal(result.sent, true);
  assert.equal(result.webhook.reason, 'not-configured');
  assert.equal(emails[0].source, 'job.omie-sync');
  assert.equal(typeof emails[0].version, 'string');
});

test('captureOperationalError with email:false never calls the e-mail channel', async () => {
  const result = await captureOperationalError(new Error('client'), {
    webhookUrl: '',
    email: false,
    emailSender: async () => {
      throw new Error('should not e-mail');
    }
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'not-configured');
  assert.equal(result.email.reason, 'disabled');
});
