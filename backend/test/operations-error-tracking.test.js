import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureOperationalError,
  errorTrackingStatus,
  operationalErrorPayload
} from '../src/lib/operations/error-tracking.js';

test('operationalErrorPayload normalizes errors and context', () => {
  const error = new Error('Falha crítica');
  const payload = operationalErrorPayload(error, {
    source: 'backend.test',
    context: { id: 123n },
    now: new Date('2026-07-02T12:00:00.000Z')
  });

  assert.equal(payload.source, 'backend.test');
  assert.equal(payload.message, 'Falha crítica');
  assert.deepEqual(payload.context, { id: '123' });
  assert.equal(payload.occurredAt, '2026-07-02T12:00:00.000Z');
});

test('captureOperationalError skips when webhook is not configured', async () => {
  const result = await captureOperationalError(new Error('skip'), {
    webhookUrl: '',
    fetchFn: async () => {
      throw new Error('should not be called');
    }
  });

  assert.equal(result.sent, false);
  assert.equal(result.reason, 'not-configured');
});

test('captureOperationalError posts payload to webhook', async () => {
  const calls = [];
  const result = await captureOperationalError(new Error('boom'), {
    webhookUrl: 'https://example.test/errors',
    source: 'backend.test',
    fetchFn: async (...args) => {
      calls.push(args);
      return { ok: true };
    }
  });

  assert.equal(result.sent, true);
  assert.equal(calls[0][0], 'https://example.test/errors');
  assert.equal(JSON.parse(calls[0][1].body).message, 'boom');
});

test('errorTrackingStatus exposes enabled flag and provider', () => {
  assert.deepEqual(
    errorTrackingStatus({
      errorTrackingWebhookUrl: 'https://example.test/errors',
      errorTrackingProvider: 'webhook'
    }),
    {
      enabled: true,
      provider: 'webhook'
    }
  );
});
