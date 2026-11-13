import assert from 'node:assert/strict';
import test from 'node:test';
import { readVerifiedProgressSources } from '../src/lib/acompanhamento/verified-progress-sources.js';
import { createDerivedReadCache, clearDerivedReadCaches } from '../src/lib/operations/derived-read-cache.js';
import { requestSourceContext } from '../src/lib/operations/request-sources.js';
import { withProjectAccess, withProjectChannel } from '../src/lib/projects/access-scope.js';

const envelope = createDerivedReadCache();
let sequence = 0;
const read = async (version, callback) => {
  let result;
  await requestSourceContext({ method: 'GET' }, null, () => envelope.get(version, ++sequence, async () => {
    result = await callback(); return true;
  }));
  return result;
};
const clean = t => { clearDerivedReadCaches(); t.after(clearDerivedReadCaches); };

test('overlapping verified reads load each missing project once in batches and own their Dates/JSON', async t => {
  clean(t);
  const client = {}, batches = [];
  const loader = async ids => {
    batches.push(ids);
    return new Map(ids.map(id => [id, [{ reportDate: new Date('2026-09-01'), extraData: { amount: .1 + .2 } }]]));
  };
  const [left, right] = await Promise.all([
    read('v1', () => readVerifiedProgressSources(client, ['p1','p2'], true, loader)),
    read('v1', () => readVerifiedProgressSources(client, ['p2','p3'], true, loader))
  ]);
  assert.deepEqual(batches, [['p1','p2'], ['p3']]);
  left.get('p2')[0].reportDate.setUTCFullYear(1900); left.get('p2')[0].extraData.amount = 99;
  assert.equal(right.get('p2')[0].reportDate.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(right.get('p2')[0].extraData.amount, .1 + .2);
  const cached = await read('v1', () => readVerifiedProgressSources(client, ['p2','p1'], true, loader));
  assert.equal(cached.get('p2')[0].extraData.amount, .1 + .2);
  assert.equal(batches.length, 2);
});

test('overlapping pages share pending projects beyond the completed cache capacity', async t => {
  clean(t);
  const client = {}, ids = Array.from({ length: 24 }, (_, index) => 'project-' + index), batches = [];
  let start, release;
  const started = new Promise(resolve => { start = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const loader = async selected => {
    batches.push(selected); start(); await gate;
    return new Map(selected.map(id => [id, [{ value: id }]]));
  };
  const first = read('v-large', () => readVerifiedProgressSources(client, ids, true, loader));
  await started;
  const second = read('v-large', () => readVerifiedProgressSources(client, ids.slice(0, 12), true, loader));
  release();
  const [cards, detail] = await Promise.all([first, second]);
  assert.deepEqual(batches, [ids], 'The completed eight-entry LRU cannot drop pending projects');
  assert.deepEqual([...cards.keys()], ids);
  assert.deepEqual([...detail.keys()], ids.slice(0, 12));
  cards.get(ids[0])[0].value = 'mutated';
  assert.equal(detail.get(ids[0])[0].value, ids[0]);
});

test('client, scope, channel, correction mode and source revision isolate progress sources', async t => {
  clean(t);
  const client = {}, other = {};
  let count = 0;
  const load = (owner = client, corrections = true) => readVerifiedProgressSources(owner, ['p'], corrections,
    async () => new Map([['p', [++count]]]));
  assert.deepEqual((await read('v1', load)).get('p'), [1]);
  assert.deepEqual((await read('v1', load)).get('p'), [1]);
  assert.deepEqual((await read('v1', () => load(other))).get('p'), [2]);
  assert.deepEqual((await read('v1', () => load(client, false))).get('p'), [3]);
  await withProjectAccess({ accountType: 'INTERNAL' }, () => read('v1', load));
  await withProjectChannel('omni', () => read('v1', load));
  assert.equal(count, 5);
  assert.deepEqual((await read('v2', load)).get('p'), [6]);
});

test('unverified reads and writes bypass sharing; missing entries retain the original map shape', async t => {
  clean(t);
  const client = {};
  let count = 0;
  const load = () => readVerifiedProgressSources(client, ['missing','empty'], true,
    async () => { count++; return new Map([['empty', []]]); });
  await load(); await load();
  await requestSourceContext({ method: 'GET' }, null, load);
  assert.equal(count, 3);
  const result = await read('v1', load);
  assert.deepEqual(result, new Map([['empty', []]]));
  await read('v1', async () => {
    await requestSourceContext({ method: 'POST' }, null, async () => { await load(); await load(); });
  });
  assert.equal(count, 6);
});

test('failed batches retry and a new revision never joins an old pending read', async t => {
  clean(t);
  const client = {};
  let calls = 0;
  const fail = () => readVerifiedProgressSources(client, ['p1','p2'], true, async () => { calls++; throw new Error('progress unavailable'); });
  await assert.rejects(read('v1', fail), /progress unavailable/);
  await assert.rejects(read('v1', fail), /progress unavailable/);
  assert.equal(calls, 2);
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const old = read('old', () => readVerifiedProgressSources(client, ['p'], true, () => new Promise(resolve => {
    release = () => resolve(new Map([['p', ['old']]])); started();
  })));
  await ready;
  const fresh = await read('new', () => readVerifiedProgressSources(client, ['p'], true, async () => new Map([['p', ['new']]])));
  assert.deepEqual(fresh.get('p'), ['new']);
  release(); assert.deepEqual((await old).get('p'), ['old']);
});

test('oversized sources are returned without retention and manual invalidation clears retained sources', async t => {
  clean(t);
  const client = {};
  let calls = 0;
  const load = id => read('v1', () => readVerifiedProgressSources(client, [id], true,
    async ids => { calls++; return new Map(ids.map(key => [key, [key === 'large' ? 'x'.repeat(2 * 1024 * 1024 + 1) : 'small']])); }));
  await load('large'); await load('large'); assert.equal(calls, 2);
  await load('small'); await load('small'); assert.equal(calls, 3);
  clearDerivedReadCaches(); await load('small'); assert.equal(calls, 4);
});
