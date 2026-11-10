import assert from 'node:assert/strict';
import test from 'node:test';
import { requestSourceContext, loadRequestSource } from '../src/lib/operations/request-sources.js';
import { withProjectAccess, withProjectChannel, projectAccessCacheKey } from '../src/lib/projects/access-scope.js';

const read = next => requestSourceContext({ method: 'GET' }, null, next);

test('read requests share pending catalog work but new requests and unscoped calls reload it', async () => {
  const database = {};
  let calls = 0;
  const load = () => loadRequestSource(database, 'catalog', async () => ({ revision: ++calls }));
  await read(async () => {
    const first = load(), second = load();
    assert.equal(first, second);
    assert.deepEqual(await Promise.all([first, second]), [{ revision: 1 }, { revision: 1 }]);
  });
  assert.deepEqual(await read(load), { revision: 2 });
  assert.deepEqual(await load(), { revision: 3 });
  assert.deepEqual(await load(), { revision: 4 });
  await read(async () => {
    await load();
    await requestSourceContext({ method: 'POST' }, null, async () => { await load(); await load(); });
  });
  assert.equal(calls, 7, 'Write operations cannot inherit a surrounding read cache');
});

test('concurrent requests, database clients, permissions, channels and options have isolated sources', async () => {
  const database = {}, otherDatabase = {};
  let calls = 0;
  const load = (owner = database, key = ['catalog', true]) => loadRequestSource(owner, key, async () => ({ call: ++calls, scope: projectAccessCacheKey() }));
  const [left, right] = await Promise.all([read(() => load()), read(() => load())]);
  assert.notEqual(left.call, right.call);
  await read(async () => {
    const initial = await load();
    assert.notEqual((await load(otherDatabase)).call, initial.call);
    assert.notEqual((await load(database, ['catalog', false])).call, initial.call);
    const restricted = await withProjectAccess({ accountType: 'INTERNAL' }, () => load());
    assert.notEqual(restricted.call, initial.call);
    assert.equal(restricted.scope, 'non-admin:app');
    const channel = await withProjectChannel('efetivo', () => load());
    assert.notEqual(channel.call, initial.call);
    assert.equal(channel.scope, 'admin:efetivo');
    assert.equal(await load(), initial);
  });
});

test('a shared source failure rejects all consumers and a later request retries', async () => {
  const database = {};
  let calls = 0;
  const load = () => loadRequestSource(database, 'catalog', async () => { calls++; throw new Error('source unavailable'); });
  await read(async () => {
    const result = await Promise.allSettled([load(), load()]);
    assert.ok(result.every(row => row.status === 'rejected' && row.reason.message === 'source unavailable'));
    assert.equal(calls, 1);
  });
  await assert.rejects(read(load), /source unavailable/);
  assert.equal(calls, 2);
});
