import assert from 'node:assert/strict';
import test from 'node:test';
import { createAcompanhamentoReader } from '../src/lib/acompanhamento/read-cache.js';
import { currentDerivedReadVersion, clearDerivedReadCaches } from '../src/lib/operations/derived-read-cache.js';
import { requestSourceContext } from '../src/lib/operations/request-sources.js';

const config = overrides => ({ acompanhamentoReadCacheEnabled: true,
  acompanhamentoResponseCacheEnabled: false, acompanhamentoMonthlyCacheEnabled: false,
  acompanhamentoReferenceCacheEnabled: false, acompanhamentoProgressCacheEnabled: false, ...overrides });
const req = { method: 'GET', auth: { user: { id: 'private-user' } } };
const request = callback => requestSourceContext(req, null, callback);
const clean = t => { clearDerivedReadCaches(); t.after(clearDerivedReadCaches); };

test('the master switch and all-disabled layers bypass source verification and shared responses', async () => {
  const database = { $queryRaw: () => assert.fail('disabled cache must not query revisions') };
  for (const settings of [config({}), config({ acompanhamentoReadCacheEnabled: false, acompanhamentoResponseCacheEnabled: true })]) {
    const reader = createAcompanhamentoReader({ database, config: settings });
    let calls = 0;
    const load = () => { assert.equal(currentDerivedReadVersion(), null); return ++calls; };
    assert.equal(await request(() => reader(req, 'cards', load)), 1);
    assert.equal(await request(() => reader(req, 'cards', load)), 2);
  }
});

test('each internal layer can verify revisions without enabling the response cache', async t => {
  clean(t);
  let revisions = 0;
  const database = { $queryRaw: async () => { revisions++; return [{ revision: 'v', server: 's', database: 'd' }]; } };
  for (const layer of ['acompanhamentoMonthlyCacheEnabled', 'acompanhamentoReferenceCacheEnabled', 'acompanhamentoProgressCacheEnabled']) {
    const reader = createAcompanhamentoReader({ database, config: config({ [layer]: true }) });
    let calls = 0;
    const load = () => { assert.ok(currentDerivedReadVersion()); return ++calls; };
    assert.equal(await request(() => reader(req, layer, load)), 1);
    assert.equal(await request(() => reader(req, layer, load)), 2, 'The response must still be recomputed');
  }
  assert.equal(revisions, 6);
  assert.equal(currentDerivedReadVersion(), null);
});

test('response-only caching still verifies every request, isolates users and refreshes source revisions', async t => {
  clean(t);
  let revision = 'one', fail = false, revisions = 0, calls = 0;
  const database = { $queryRaw: async () => {
    revisions++;
    if (fail) throw new Error('unavailable');
    return [{ revision, server: 's', database: 'response-only' }];
  } };
  const reader = createAcompanhamentoReader({ database, config: config({ acompanhamentoResponseCacheEnabled: true }) });
  const read = (user = req) => request(() => reader(user, 'cards', () => ({ value: ++calls })));
  assert.deepEqual(await read(), { value: 1 });
  assert.deepEqual(await read(), { value: 1 });
  assert.deepEqual(await read({ ...req, auth: { user: { id: 'other-user' } } }), { value: 2 });
  revision = 'two';
  assert.deepEqual(await read(), { value: 3 });
  fail = true;
  await assert.rejects(read(), error => error.status === 503 && /verificar/.test(error.message));
  assert.equal(calls, 3, 'Verification failure must not run the loader or return an old DTO');
  assert.equal(revisions, 5);
});
