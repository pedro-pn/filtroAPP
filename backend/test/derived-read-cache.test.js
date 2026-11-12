import assert from 'node:assert/strict';
import test from 'node:test';
import { createDerivedReadCache, currentDerivedReadVersion, clearDerivedReadCaches, databaseReadVersion } from '../src/lib/operations/derived-read-cache.js';

test('derived responses share work per version/variant and give each caller an independent DTO', async () => {
  const cache = createDerivedReadCache();
  let calls = 0;
  const loader = async () => { calls++; assert.equal(currentDerivedReadVersion(), 'v1'); return { rows: [{ total: .3 }], date: new Date('2026-09-01') }; };
  const [first, second] = await Promise.all([cache.get('v1', ['admin', 'project'], loader), cache.get('v1', ['admin', 'project'], loader)]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  first.rows[0].total = 999;
  assert.equal((await cache.get('v1', ['admin', 'project'], loader)).rows[0].total, .3);
  assert.equal(second.date, '2026-09-01T00:00:00.000Z');
  assert.equal(currentDerivedReadVersion(), null);
  await cache.get('v1', ['viewer', 'project'], () => ({ visible: true }));
  assert.equal(cache.stats().entries, 2);
});

test('new revisions cannot reuse an old pending read and failures are retried', async () => {
  const cache = createDerivedReadCache();
  let finish;
  const old = cache.get('old', 'project', () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  assert.deepEqual(await cache.get('new', 'project', () => ({ value: 2 })), { value: 2 });
  finish({ value: 1 });
  assert.deepEqual(await old, { value: 1 });
  assert.deepEqual(await cache.get('new', 'project', () => { throw new Error('must reuse new'); }), { value: 2 });
  await assert.rejects(cache.get('failed', 'project', () => { throw new Error('unavailable'); }), /unavailable/);
  assert.deepEqual(await cache.get('failed', 'project', () => ({ value: 3 })), { value: 3 });
});

test('a slow pending calculation stays shared and its TTL starts after completion', async () => {
  let now = 0, calls = 0;
  const releases = [];
  const cache = createDerivedReadCache({ ttlMs: 15000, now: () => now });
  const loader = () => { calls++; return new Promise(resolve => releases.push(resolve)); };
  const first = cache.get('revision', 'cards', loader);
  await Promise.resolve();
  now = 15001;
  const second = cache.get('revision', 'cards', loader);
  await Promise.resolve();
  now = 30000;
  for (const release of releases) release({ rows: [{ total: 10 }] });
  const [left, right] = await Promise.all([first, second]);
  assert.equal(calls, 1, 'Passing the TTL cannot duplicate work that is still running');
  left.rows[0].total = 99;
  assert.equal(right.rows[0].total, 10);
  now = 44999;
  assert.equal((await cache.get('revision', 'cards', () => assert.fail('result is still fresh'))).rows[0].total, 10);
  now = 45000;
  assert.deepEqual(await cache.get('revision', 'cards', () => ({ fresh: true })), { fresh: true });
});

test('completed LRU pressure cannot discard another key that is still loading', async () => {
  const cache = createDerivedReadCache({ maxEntries: 1, maxPendingEntries: 2 });
  const releases = [], calls = new Map();
  const loader = key => () => {
    calls.set(key, (calls.get(key) || 0) + 1);
    return new Promise(resolve => releases.push(() => resolve({ key })));
  };
  const first = cache.get('v', 'pending-a', loader('a'));
  await Promise.resolve();
  const second = cache.get('v', 'pending-b', loader('b'));
  await Promise.resolve();
  releases[0](); await first;
  await cache.get('v', 'completed-c', () => ({ key: 'c' }));
  const joined = cache.get('v', 'pending-b', loader('b'));
  await Promise.resolve();
  for (const release of releases) release();
  assert.deepEqual(await second, await joined);
  assert.equal(calls.get('b'), 1);
  assert.equal(cache.stats().entries, 1);
});

test('pending admission is bounded without queuing new keys or losing admitted work', async () => {
  const cache = createDerivedReadCache({ maxPendingEntries: 1 });
  let release, calls = 0;
  const slow = cache.get('v', 'slow', () => { calls++; return new Promise(resolve => { release = resolve; }); });
  await Promise.resolve();
  const shared = cache.get('v', 'slow', () => assert.fail('admitted work must remain shared'));
  assert.equal(cache.stats().pendingEntries, 1);
  const fast = await cache.get('v', 'other', () => ({ nested: { total: 3 } }));
  assert.deepEqual(fast, { nested: { total: 3 } });
  assert.equal(cache.stats().pendingEntries, 1);
  assert.equal(cache.stats().entries, 0, 'Bypassed keys are not admitted later');
  await assert.rejects(cache.get('v', 'failed', () => { throw new Error('unavailable'); }), /unavailable/);
  release({ rows: [1] });
  const [left, right] = await Promise.all([slow, shared]);
  left.rows.push(2); assert.deepEqual(right.rows, [1]);
  assert.equal(calls, 1);
  assert.equal(cache.stats().pendingEntries, 0);
  assert.throws(() => createDerivedReadCache({ maxPendingEntries: 0 }), /Limites/);
});

test('clearing pending work cannot let an old completion replace or remove a newer calculation', async () => {
  const cache = createDerivedReadCache();
  let releaseOld, releaseNew;
  const old = cache.get('v', 'key', () => new Promise(resolve => { releaseOld = resolve; }));
  await Promise.resolve();
  cache.clear();
  const fresh = cache.get('v', 'key', () => new Promise(resolve => { releaseNew = resolve; }));
  await Promise.resolve();
  releaseOld({ value: 'old' });
  assert.deepEqual(await old, { value: 'old' });
  assert.equal(cache.stats().pendingEntries, 1);
  assert.equal(cache.stats().entries, 0);
  const joined = cache.get('v', 'key', () => assert.fail('new work must remain pending'));
  releaseNew({ value: 'new' });
  assert.deepEqual(await fresh, { value: 'new' });
  assert.deepEqual(await joined, { value: 'new' });
  assert.deepEqual(await cache.get('v', 'key', () => assert.fail('new result must remain cached')), { value: 'new' });
});

test('derived response storage respects bytes, entry count, expiry and explicit invalidation', async () => {
  let now = 0, calls = 0;
  const cache = createDerivedReadCache({ ttlMs: 10, maxEntries: 2, maxBytes: 24, maxEntryBytes: 20, now: () => now });
  const load = key => cache.get('v', key, () => { calls++; return { n: 1234 }; });
  await load('a'); await load('b'); await load('c');
  assert.ok(cache.stats().entries <= 2 && cache.stats().bytes <= 24);
  await load('b'); assert.equal(calls, 3);
  now = 11; await load('b'); assert.equal(calls, 4);
  const huge = () => { calls++; return { long: 'x'.repeat(100) }; };
  await cache.get('v', 'huge', huge); await cache.get('v', 'huge', huge);
  assert.equal(calls, 6, 'Oversized responses are returned but not retained');
  clearDerivedReadCaches(); assert.deepEqual(cache.stats(), { entries: 0, bytes: 0, pendingEntries: 0 });
  assert.throws(() => createDerivedReadCache({ maxEntries: 0 }), /Limites/);
});

test('database revisions include active writers and server/database identity and fail closed', async () => {
  let row = { revision: 'writer-vector-1', server: 'boot-1', database: 'db-1' };
  const database = { $queryRaw: async () => [row] };
  const initial = await databaseReadVersion(database);
  assert.equal(await databaseReadVersion(database), initial);
  for (const change of [{ revision: 'writer-vector-2' }, { server: 'boot-2' }, { database: 'db-2' }]) {
    row = { ...row, ...change };
    assert.notEqual(await databaseReadVersion(database), initial);
  }
  row = {};
  await assert.rejects(databaseReadVersion(database), /revisão/);
});
