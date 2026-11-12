import assert from 'node:assert/strict';
import test from 'node:test';
import env from '../src/config/env.js';
import { readMonthlyCostSnapshot } from '../src/lib/acompanhamento/monthly-cost-snapshot.js';
import { readVerifiedCostSource } from '../src/lib/acompanhamento/verified-cost-sources.js';
import { readVerifiedProgressSources } from '../src/lib/acompanhamento/verified-progress-sources.js';
import { withDerivedReadVersion, clearDerivedReadCaches } from '../src/lib/operations/derived-read-cache.js';
import { requestSourceContext } from '../src/lib/operations/request-sources.js';

const verified = callback => requestSourceContext({ method: 'GET' }, null, () => withDerivedReadVersion('v', callback));

for (const layer of ['monthly', 'references', 'progress']) {
  test(`disabling only ${layer} bypasses that layer even when a verified snapshot exists`, async t => {
    const field = { monthly: 'acompanhamentoMonthlyCacheEnabled', references: 'acompanhamentoReferenceCacheEnabled',
      progress: 'acompanhamentoProgressCacheEnabled' }[layer];
    const original = env[field];
    clearDerivedReadCaches();
    t.after(() => { env[field] = original; clearDerivedReadCaches(); });
    env[field] = true;
    let calls = 0;
    const client = {};
    const load = () => ({ value: ++calls });
    const readers = {
      monthly: () => readMonthlyCostSnapshot(null, { includeIgnoredNames: false }, options => {
        if (!env[field]) assert.deepEqual(options, { includeIgnoredNames: false });
        return load();
      }),
      references: () => readVerifiedCostSource(client, 'catalog', load),
      progress: async () => (await readVerifiedProgressSources(client, ['p'], true, async ids => {
        assert.deepEqual(ids, ['p']); return new Map([['p', load()]]);
      })).get('p')
    };
    const read = () => verified(readers[layer]);
    assert.deepEqual(await read(), { value: 1 });
    assert.deepEqual(await read(), { value: 1 });
    env[field] = false;
    assert.deepEqual(await read(), { value: 2 });
    assert.deepEqual(await read(), { value: 3 });
    env[field] = true;
    assert.deepEqual(await read(), { value: 1 }, 'Unchanged source revision can reuse its existing snapshot');
  });
}
