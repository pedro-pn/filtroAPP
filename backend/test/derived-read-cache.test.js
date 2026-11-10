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
  clearDerivedReadCaches(); assert.deepEqual(cache.stats(), { entries: 0, bytes: 0 });
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
