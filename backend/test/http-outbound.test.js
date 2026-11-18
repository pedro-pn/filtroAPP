import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchWithTimeout } from '../src/lib/http/outbound.js';

const noSleep = async () => {};

test('fetchWithTimeout passes a timeout signal to fetch', async () => {
  let received;
  const response = await fetchWithTimeout('https://api.example.test/x', { method: 'GET' }, {
    timeoutMs: 1000,
    fetchImpl: async (_url, init) => {
      received = init;
      return new Response('ok', { status: 200 });
    }
  });
  assert.equal(response.status, 200);
  assert.ok(received.signal instanceof AbortSignal);
  assert.equal(received.method, 'GET');
});

test('fetchWithTimeout aborts a hanging call and reports a timeout error', async () => {
  const hanging = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  // O timer de AbortSignal.timeout não segura o event loop; num servidor real
  // há outros handles abertos. No teste, um timer comum mantém o processo vivo.
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    await assert.rejects(
      fetchWithTimeout('https://slow.example.test/api', {}, { timeoutMs: 20, fetchImpl: hanging }),
      error => error.code === 'OUTBOUND_TIMEOUT' && /slow\.example\.test/.test(error.message)
    );
  } finally {
    clearTimeout(keepAlive);
  }
});

test('fetchWithTimeout retries network failures and 503 up to the limit', async () => {
  let calls = 0;
  const responses = [
    () => { throw new TypeError('fetch failed'); },
    () => new Response('busy', { status: 503 }),
    () => new Response('ok', { status: 200 })
  ];
  const response = await fetchWithTimeout('https://api.example.test', {}, {
    timeoutMs: 1000,
    retries: 2,
    sleep: noSleep,
    fetchImpl: async () => responses[calls++]()
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
});

test('fetchWithTimeout does not retry without retries and returns the last 5xx', async () => {
  let calls = 0;
  const response = await fetchWithTimeout('https://api.example.test', { method: 'POST' }, {
    timeoutMs: 1000,
    sleep: noSleep,
    fetchImpl: async () => {
      calls += 1;
      return new Response('busy', { status: 503 });
    }
  });
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
});

test('fetchWithTimeout does not retry business errors (HTTP 500)', async () => {
  let calls = 0;
  const response = await fetchWithTimeout('https://api.example.test', {}, {
    timeoutMs: 1000,
    retries: 2,
    sleep: noSleep,
    fetchImpl: async () => {
      calls += 1;
      return new Response('{"faultstring":"x"}', { status: 500 });
    }
  });
  assert.equal(response.status, 500);
  assert.equal(calls, 1);
});

test('fetchWithTimeout gives up after the last retry with the original error', async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithTimeout('https://api.example.test', {}, {
      timeoutMs: 1000,
      retries: 1,
      sleep: noSleep,
      fetchImpl: async () => {
        calls += 1;
        throw new TypeError('fetch failed');
      }
    }),
    /fetch failed/
  );
  assert.equal(calls, 2);
});

test('fetchWithTimeout requires a positive timeout', async () => {
  await assert.rejects(fetchWithTimeout('https://api.example.test', {}, {}), TypeError);
});
