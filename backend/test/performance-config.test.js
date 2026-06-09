import assert from 'node:assert/strict';
import test from 'node:test';

import { logSlowOperation } from '../src/lib/performance-logging.js';
import { databaseUrlWithConnectionLimit } from '../src/lib/prisma-url.js';
import { createKeyedTtlCache } from '../src/lib/ttl-cache.js';

test('databaseUrlWithConnectionLimit appends Prisma connection_limit when absent', () => {
  const url = databaseUrlWithConnectionLimit('postgresql://user:pass@db.example.com:5432/app?schema=public', 5);
  assert.equal(url, 'postgresql://user:pass@db.example.com:5432/app?schema=public&connection_limit=5');
});

test('databaseUrlWithConnectionLimit preserves explicit connection_limit', () => {
  const url = databaseUrlWithConnectionLimit('postgresql://user:pass@db.example.com/app?connection_limit=9', 5);
  assert.equal(url, 'postgresql://user:pass@db.example.com/app?connection_limit=9');
});

test('logSlowOperation only logs when duration reaches threshold', () => {
  const originalWarn = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args);
  try {
    assert.equal(logSlowOperation('fast', 99, {}, { thresholdMs: 100 }), false);
    assert.equal(logSlowOperation('slow', 100, { count: 2 }, { thresholdMs: 100 }), true);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '[SLOW OPERATION]');
  assert.deepEqual(calls[0][1], { operation: 'slow', durationMs: 100, count: 2 });
});

test('createKeyedTtlCache caches independently by key and deduplicates concurrent loaders', async () => {
  const cache = createKeyedTtlCache(60_000);
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return { calls };
  };

  const [first, second] = await Promise.all([
    cache.get('a', loader),
    cache.get('a', loader)
  ]);
  const other = await cache.get('b', loader);

  assert.equal(calls, 2);
  assert.equal(first, second);
  assert.deepEqual(first, { calls: 1 });
  assert.deepEqual(other, { calls: 2 });
});
