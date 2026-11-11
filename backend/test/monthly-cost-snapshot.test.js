import assert from 'node:assert/strict';
import test from 'node:test';
import { serialize, deserialize } from 'node:v8';
import { readMonthlyCostSnapshot } from '../src/lib/acompanhamento/monthly-cost-snapshot.js';
import { clearDerivedReadCaches, createDerivedReadCache } from '../src/lib/operations/derived-read-cache.js';
import { withProjectAccess, withProjectChannel } from '../src/lib/projects/access-scope.js';
import { requestSourceContext } from '../src/lib/operations/request-sources.js';

const readContext = loader => requestSourceContext({ method: 'GET' }, null, loader);

const snapshot = total => {
  const person = { id: 'c', total, months: [{ value: .1 + .2 }] };
  return { periodStart: new Date('2026-09-01'), rates: [person], byCollaboratorId: new Map([['c', person]]),
    ignoredExternalEmployees: [{ externalName: 'Pessoa ignorada' }] };
};

test('unversioned callers retain their options and recompute every time', async () => {
  let calls = 0;
  const options = { includeIgnoredNames: false };
  const load = received => { assert.equal(received, options); return snapshot(++calls); };
  assert.equal((await readMonthlyCostSnapshot(null, options, load)).rates[0].total, 1);
  assert.equal((await readMonthlyCostSnapshot(null, options, load)).rates[0].total, 2);
});

test('verified cost and point readers share pending work but receive separate Maps/Dates and metadata', async t => {
  clearDerivedReadCaches(); t.after(clearDerivedReadCaches);
  const request = createDerivedReadCache();
  let reads = 0, release;
  await readContext(() => request.get('v1', 'pending', async () => {
    const load = options => {
      reads++; assert.deepEqual(options, { includeIgnoredNames: true });
      return new Promise(resolve => { release = () => resolve(snapshot(10)); });
    };
    const cost = readMonthlyCostSnapshot(null, { includeIgnoredNames: false }, load);
    const point = readMonthlyCostSnapshot(null, { includeIgnoredNames: true }, load);
    await Promise.resolve();
    release();
    const [left, right] = await Promise.all([cost, point]);
    assert.equal(reads, 1);
    assert.equal(Object.hasOwn(left, 'ignoredExternalEmployees'), false);
    assert.deepEqual(right.ignoredExternalEmployees, [{ externalName: 'Pessoa ignorada' }]);
    assert.ok(left.byCollaboratorId instanceof Map && left.periodStart instanceof Date);
    assert.equal(left.rates[0], left.byCollaboratorId.get('c'), 'Preserve aliases within each returned graph');
    left.byCollaboratorId.get('c').months[0].value = 999;
    left.periodStart.setUTCFullYear(1900);
    assert.equal(right.rates[0].months[0].value, .1 + .2);
    assert.equal(right.periodStart.toISOString(), '2026-09-01T00:00:00.000Z');
    const fresh = await readMonthlyCostSnapshot(null, {}, () => { throw new Error('must reuse'); });
    assert.equal(fresh.rates[0].months[0].value, .1 + .2);
    assert.equal(fresh.periodStart.getUTCFullYear(), 2026);
    return true;
  }));
});

test('revisions, imports, project access/channel, failures and invalidation isolate monthly snapshots', async t => {
  clearDerivedReadCaches(); t.after(clearDerivedReadCaches);
  const request = createDerivedReadCache();
  let reads = 0;
  const load = () => snapshot(++reads);
  const read = (id = null) => readMonthlyCostSnapshot(id, {}, load);
  await readContext(() => request.get('v1', 'contexts', async () => {
    assert.equal((await read()).rates[0].total, 1);
    assert.equal((await read()).rates[0].total, 1);
    assert.equal((await read('explicit')).rates[0].total, 2);
    assert.equal((await withProjectAccess({ accountType: 'INTERNAL' }, read)).rates[0].total, 3);
    assert.equal((await withProjectChannel('efetivo', read)).rates[0].total, 4);
    assert.equal((await read()).rates[0].total, 1);
    await assert.rejects(readMonthlyCostSnapshot('failed', {}, () => { throw new Error('source unavailable'); }), /source unavailable/);
    assert.equal((await read('failed')).rates[0].total, 5);
    clearDerivedReadCaches();
    assert.equal((await read()).rates[0].total, 6);
    return true;
  }));
  await readContext(() => request.get('v2', 'changed', async () => {
    assert.equal((await read()).rates[0].total, 7);
    return true;
  }));
});

test('writes and non-request calculations cannot inherit the read snapshot cache', async () => {
  const request = createDerivedReadCache();
  let reads = 0;
  const load = () => snapshot(++reads);
  await request.get('v-outside', 'outside', async () => {
    await readMonthlyCostSnapshot(null, {}, load); await readMonthlyCostSnapshot(null, {}, load);
    assert.equal(reads, 2);
    return true;
  });
  await readContext(() => request.get('v-write', 'write', async () => {
    await readMonthlyCostSnapshot(null, {}, load);
    await requestSourceContext({ method: 'POST' }, null, async () => {
      await readMonthlyCostSnapshot(null, {}, load); await readMonthlyCostSnapshot(null, {}, load);
    });
    assert.equal(reads, 5);
    assert.equal((await readMonthlyCostSnapshot(null, {}, load)).rates[0].total, 3);
    return true;
  }));
});

test('binary snapshots respect storage bounds and retry an unsuccessful decode', async () => {
  const bounded = createDerivedReadCache({ encode: serialize, decode: deserialize, maxBytes: 200, maxEntryBytes: 150 });
  let calls = 0;
  const huge = () => { calls++; return { data: 'x'.repeat(300), map: new Map() }; };
  assert.ok((await bounded.get('v', 'huge', huge)).map instanceof Map);
  await bounded.get('v', 'huge', huge);
  assert.equal(calls, 2); assert.equal(bounded.stats().entries, 0);
  let fail = true;
  const retry = createDerivedReadCache({ encode: serialize, decode: value => {
    if (fail) throw new Error('decode failed');
    return deserialize(value);
  } });
  await assert.rejects(retry.get('v', 'x', () => ({ value: 1 })), /decode failed/);
  assert.equal(retry.stats().entries, 0);
  fail = false;
  assert.deepEqual(await retry.get('v', 'x', () => ({ value: 2 })), { value: 2 });
});

test('typed-array views returned by a binary decoder cannot mutate another reader or cache storage', async () => {
  const cache = createDerivedReadCache({ encode: serialize, decode: deserialize });
  let calls = 0;
  const load = () => { calls++; return { buffer: Buffer.from([1, 2]), bytes: new Uint8Array([3, 4]) }; };
  const first = await cache.get('v', 'bytes', load), second = await cache.get('v', 'bytes', load);
  first.buffer[0] = 99; first.bytes[0] = 98;
  const third = await cache.get('v', 'bytes', load);
  assert.deepEqual([...second.buffer], [1, 2]); assert.deepEqual([...second.bytes], [3, 4]);
  assert.deepEqual([...third.buffer], [1, 2]); assert.deepEqual([...third.bytes], [3, 4]);
  assert.equal(calls, 1);
});
