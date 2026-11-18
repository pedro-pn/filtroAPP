import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideOperationalAlert,
  operationalAlertMessage,
  operationalAlertSignature,
  runOperationalAlertCheck,
  sendOperationalAlert
} from '../src/lib/operations/alerts.js';

test('operationalAlertMessage summarizes current problems', () => {
  const message = operationalAlertMessage({
    ok: false,
    generatedAt: '2026-07-02T12:00:00.000Z',
    problems: [
      { message: 'Backup está velho demais.', backup: { status: 'STALE' } },
      { message: 'Job recorrente sem execução recente.', job: 'survey-reminders' }
    ]
  });

  assert.match(message, /Alerta operacional Filtrovali/);
  assert.match(message, /backup=STALE/);
  assert.match(message, /job=survey-reminders/);
});

test('sendOperationalAlert posts status to configured webhook', async () => {
  const calls = [];
  const result = await sendOperationalAlert({
    ok: false,
    generatedAt: '2026-07-02T12:00:00.000Z',
    problems: [{ message: 'Falha.' }]
  }, {
    webhookUrl: 'https://example.test/webhook',
    recipients: [],
    fetchFn: async (...args) => {
      calls.push(args);
      return { ok: true };
    }
  });

  assert.equal(result.sent, true);
  assert.equal(calls[0][0], 'https://example.test/webhook');
  assert.equal(JSON.parse(calls[0][1].body).status.ok, false);
});

test('runOperationalAlertCheck does not send alert when status is ok', async () => {
  let sent = false;
  const result = await runOperationalAlertCheck({
    statusProvider: async () => ({ ok: true, problems: [] }),
    previousStateProvider: async () => null,
    alertSender: async () => {
      sent = true;
      return { sent: true };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.sent, false);
  assert.equal(sent, false);
});

const failingStatus = (problems = [{ message: 'Backup falhou na última execução.', backup: { status: 'FAILURE' } }]) => ({
  ok: false,
  generatedAt: '2026-11-18T12:00:00.000Z',
  problems
});

test('operationalAlertSignature ignores ages and counters', () => {
  const first = operationalAlertSignature(failingStatus([{ message: 'Job recorrente sem execução recente.', job: 'omie-sync', ageMs: 1 }]));
  const second = operationalAlertSignature(failingStatus([{ message: 'Job recorrente sem execução recente.', job: 'omie-sync', ageMs: 999 }]));
  const other = operationalAlertSignature(failingStatus([{ message: 'Job recorrente sem execução recente.', job: 'conecta-rh' }]));
  assert.equal(first, second);
  assert.notEqual(first, other);
});

test('decideOperationalAlert sends once, repeats after repeatMs, and announces recovery', () => {
  const repeatMs = 6 * 60 * 60 * 1000;
  const t0 = new Date('2026-11-18T12:00:00.000Z');
  const first = decideOperationalAlert({ status: failingStatus(), previous: null, now: t0, repeatMs });
  assert.equal(first.action, 'alert');

  const oneHourLater = new Date(t0.getTime() + 60 * 60 * 1000);
  const same = decideOperationalAlert({ status: failingStatus(), previous: first.state, now: oneHourLater, repeatMs });
  assert.equal(same.action, 'none');

  const changed = decideOperationalAlert({
    status: failingStatus([{ message: 'Backup está velho demais.', backup: { status: 'STALE' } }]),
    previous: first.state,
    now: oneHourLater,
    repeatMs
  });
  assert.equal(changed.action, 'alert');

  const later = new Date(t0.getTime() + repeatMs);
  assert.equal(decideOperationalAlert({ status: failingStatus(), previous: first.state, now: later, repeatMs }).action, 'alert');

  const recovered = decideOperationalAlert({ status: { ok: true, problems: [] }, previous: first.state, now: later, repeatMs });
  assert.equal(recovered.action, 'recovered');
  assert.equal(recovered.state.alerting, false);
  assert.equal(decideOperationalAlert({ status: { ok: true, problems: [] }, previous: recovered.state, now: later, repeatMs }).action, 'none');
});

test('runOperationalAlertCheck keeps previous state when delivery fails so the next run retries', async () => {
  const result = await runOperationalAlertCheck({
    statusProvider: async () => failingStatus(),
    previousStateProvider: async () => null,
    alertSender: async () => ({ sent: false, reason: 'send-error' })
  });
  assert.equal(result.sent, false);
  assert.equal(result.alertState.alerting, false);

  const retry = decideOperationalAlert({ status: failingStatus(), previous: result.alertState });
  assert.equal(retry.action, 'alert');
});

test('runOperationalAlertCheck does not resend a persisting alert', async () => {
  let calls = 0;
  const status = failingStatus();
  const previous = { alerting: true, signature: operationalAlertSignature(status), lastSentAt: new Date().toISOString() };
  const result = await runOperationalAlertCheck({
    statusProvider: async () => status,
    previousStateProvider: async () => previous,
    alertSender: async () => {
      calls += 1;
      return { sent: true };
    }
  });
  assert.equal(calls, 0);
  assert.equal(result.sent, false);
  assert.deepEqual(result.alertState, previous);
});

test('sendOperationalAlert e-mails recipients with environment and panel link', async () => {
  const emails = [];
  const result = await sendOperationalAlert(failingStatus(), {
    webhookUrl: '',
    recipients: ['ops@example.test'],
    emailSender: async (message, options) => {
      emails.push({ message, options });
      return { sent: true };
    },
    config: { nodeEnv: 'production', appUrl: 'https://app.example.test/' }
  });
  assert.equal(result.sent, true);
  assert.equal(result.webhook.reason, 'not-configured');
  assert.match(emails[0].message.subject, /\[filtroAPP production\] Alerta operacional: 1 problema/);
  assert.match(emails[0].message.text, /backup=FAILURE/);
  assert.match(emails[0].message.text, /Painel: https:\/\/app\.example\.test\/operacoes/);
  assert.deepEqual(emails[0].options.recipients, ['ops@example.test']);
});

test('sendOperationalAlert reports not-configured when no channel exists', async () => {
  const result = await sendOperationalAlert(failingStatus(), { webhookUrl: '', recipients: [] });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'not-configured');
});
