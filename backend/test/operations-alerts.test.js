import assert from 'node:assert/strict';
import test from 'node:test';

import {
  operationalAlertMessage,
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
    alertSender: async () => {
      sent = true;
      return { sent: true };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.sent, false);
  assert.equal(sent, false);
});
