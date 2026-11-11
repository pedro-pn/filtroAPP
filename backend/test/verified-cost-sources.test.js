import assert from 'node:assert/strict';
import test from 'node:test';
import { readVerifiedCostSource } from '../src/lib/acompanhamento/verified-cost-sources.js';
import { createDerivedReadCache, clearDerivedReadCaches } from '../src/lib/operations/derived-read-cache.js';
import { requestSourceContext } from '../src/lib/operations/request-sources.js';
import { withProjectAccess, withProjectChannel } from '../src/lib/projects/access-scope.js';
import { loadRoleCostCatalog } from '../src/lib/acompanhamento/labor-cost.js';
import { getAnnualCollaboratorCosts } from '../src/lib/acompanhamento/settings.js';
import { buildOmieCostCategoryWhere } from '../src/lib/acompanhamento/cost-categories.js';
import database from '../src/lib/prisma.js';
import { costReferenceRows } from './helpers/cost-reference-rows.js';
import { loadCostReferenceSources } from '../src/lib/acompanhamento/cost-reference-sources.js';

const envelope = createDerivedReadCache();
let requestNumber = 0;
async function read(version, loader) {
  let value;
  await requestSourceContext({ method: 'GET' }, null, () => envelope.get(version, ++requestNumber, async () => {
    value = await loader(); return true;
  }));
  return value;
}
const clean = t => { clearDerivedReadCaches(); t.after(clearDerivedReadCaches); };

test('separate verified requests share pending catalog SQL and own independent Dates, Maps and aliases', async t => {
  clean(t);
  const client = {};
  let calls = 0, release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const load = () => readVerifiedCostSource(client, 'catalog', () => {
    calls++; started();
    return new Promise(resolve => { release = () => {
      const row = { date: new Date('2026-09-01'), amount: .1 + .2 };
      resolve({ rows: [row], byId: new Map([['a', row]]) });
    }; });
  });
  const first = read('v1', load), second = read('v1', load);
  await ready; release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(left.rows[0], left.byId.get('a'));
  assert.notEqual(left.rows[0], right.rows[0]);
  left.rows[0].date.setUTCFullYear(1900); left.rows[0].amount = 99;
  for (const value of [right, await read('v1', load)]) {
    assert.equal(value.rows[0].date.toISOString(), '2026-09-01T00:00:00.000Z');
    assert.equal(value.rows[0].amount, .1 + .2);
  }
});

test('database identity, catalog options, visibility, channel and revision isolate snapshots', async t => {
  clean(t);
  const client = {}, other = {};
  let calls = 0;
  const load = (owner = client, key = ['filter', true]) => readVerifiedCostSource(owner, key, () => ({ call: ++calls }));
  assert.equal((await read('v1', () => load())).call, 1);
  assert.equal((await read('v1', () => load())).call, 1);
  assert.equal((await read('v1', () => load(other))).call, 2);
  assert.equal((await read('v1', () => load(client, ['filter', false]))).call, 3);
  assert.equal((await withProjectAccess({ accountType: 'INTERNAL' }, () => read('v1', () => load()))).call, 4);
  assert.equal((await withProjectChannel('omni', () => read('v1', () => load()))).call, 5);
  assert.equal((await read('v1', () => load())).call, 1);
  assert.equal((await read('v2', () => load())).call, 6);
});

test('unverified reads, non-request callers and nested writes always read their own sources', async t => {
  clean(t);
  const client = {};
  let calls = 0;
  const load = () => readVerifiedCostSource(client, 'catalog', () => ++calls);
  assert.equal(await load(), 1); assert.equal(await load(), 2);
  await requestSourceContext({ method: 'GET' }, null, async () => { await load(); await load(); });
  assert.equal(calls, 4);
  await envelope.get('v1', 'non-request', async () => { await load(); await load(); return true; });
  assert.equal(calls, 6);
  await read('v1', async () => {
    assert.equal(await load(), 7);
    await requestSourceContext({ method: 'POST' }, null, async () => { await load(); await load(); });
    assert.equal(calls, 9);
    assert.equal(await load(), 7);
  });
});

test('a newer revision never joins an older pending read; failures retry on a subsequent request', async t => {
  clean(t);
  const client = {};
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const old = read('old', () => readVerifiedCostSource(client, 'catalog', () => new Promise(resolve => {
    release = () => resolve({ value: 'old' }); started();
  })));
  await ready;
  assert.deepEqual(await read('new', () => readVerifiedCostSource(client, 'catalog', () => ({ value: 'new' }))), { value: 'new' });
  release(); assert.deepEqual(await old, { value: 'old' });
  let calls = 0;
  const fail = () => readVerifiedCostSource(client, 'failed', async () => { calls++; throw new Error('catalog unavailable'); });
  const failures = await Promise.allSettled([read('v1', fail), read('v1', fail)]);
  assert.ok(failures.every(result => result.status === 'rejected' && result.reason.message === 'catalog unavailable'));
  assert.equal(calls, 1);
  await assert.rejects(read('v1', fail), /catalog unavailable/);
  assert.equal(calls, 2);
});

test('oversized catalogs are returned without retention and manual invalidation clears smaller entries', async t => {
  clean(t);
  const client = {};
  let calls = 0;
  const load = key => read('v1', () => readVerifiedCostSource(client, key, () => ({ call: ++calls,
    data: key === 'large' ? 'x'.repeat(1024 * 1024 + 1) : 'small' })));
  assert.equal((await load('large')).call, 1);
  assert.equal((await load('large')).call, 2);
  assert.equal((await load('small')).call, 3);
  assert.equal((await load('small')).call, 3);
  clearDerivedReadCaches();
  assert.equal((await load('small')).call, 4);
});

test('role rows and annual costs share SQL across requests while rebuilding independent resolvers', async t => {
  clean(t);
  let reads = 0;
  const client = {
    $queryRaw: async () => { reads++; return costReferenceRows({ roles: [{ id: 'r', name: 'Operador' }], profiles: [
      { key: 'operador', jobRoleId: null, parameterSets: [{ version: 1, effectiveDate: new Date('2026-01-01'),
        createdAt: new Date('2026-01-02'), params: { cargaHoraria: 220, base: { value: 1 } } }] },
      { key: 'role', jobRoleId: 'r', parameterSets: [{ version: 1, effectiveDate: new Date('2026-01-01'),
        createdAt: new Date('2026-01-02'), params: { salarioBase: 4200, baseModel: 'operador' } }] }
    ], settings: [{ key: 'epiAnnualCost', numberValue: 0 }] }); }
  };
  const load = () => Promise.all([loadRoleCostCatalog(client), getAnnualCollaboratorCosts(client)]);
  const [first, second] = await Promise.all([read('catalog-v1', load), read('catalog-v1', load)]);
  assert.equal(reads, 1, 'Concurrent role and annual consumers share the same statement');
  assert.deepEqual(first[0].resolver.paramsFor('Operador', '2026-09-01'), second[0].resolver.paramsFor('Operador', '2026-09-01'));
  first[0].resolver.paramsFor('Operador', '2026-09-01').base.value = 99;
  first[0].rolesById.get('r').name = 'Changed'; first[1].epiAnnualCost = 999;
  assert.equal(second[0].resolver.paramsFor('Operador', '2026-09-01').base.value, 1);
  assert.equal(second[0].rolesById.get('r').name, 'Operador');
  assert.equal(second[1].epiAnnualCost, 0);
  await read('catalog-v2', load);
  assert.equal(reads, 2);
});

test('cost reference dates preserve UTC day boundaries and timestamp milliseconds outside UTC', async t => {
  const previous = process.env.TZ;
  process.env.TZ = 'Pacific/Auckland';
  t.after(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; });
  const client = { $queryRaw: async () => [{ roles: [], settings: [], profiles: [{ key: 'model', jobRoleId: null,
    parameterSets: [{ version: 1, effectiveDate: '2026-09-01', createdAt: '2026-08-31T23:59:59.123', params: { base: .1 + .2 } }]
  }] }] };
  const set = (await loadCostReferenceSources(client)).profiles[0].parameterSets[0];
  assert.equal(set.effectiveDate.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(set.createdAt.toISOString(), '2026-08-31T23:59:59.123Z');
  assert.equal(set.params.base, .1 + .2);
});

test('Omie filters retain option/privacy boundaries and refresh category changes with the revision', async t => {
  clean(t);
  const originalCategory = database.omieCategory.findMany, originalPurchase = database.omiePurchase.groupBy;
  t.after(() => { database.omieCategory.findMany = originalCategory; database.omiePurchase.groupBy = originalPurchase; });
  let calls = 0, excluded = false;
  database.omieCategory.findMany = async () => { calls++; return [
    { codigo: 'manual', includeInAcompanhamentoCosts: !excluded }, { codigo: 'private', adminOnly: true },
    { codigo: 'chemical', descricao: 'Produtos químicos' }
  ]; };
  database.omiePurchase.groupBy = async () => [];
  const load = options => buildOmieCostCategoryWhere({ excludeChemicalProducts: true, ...options });
  const first = await read('filter-v1', () => load({ includeAdminOnly: false }));
  const other = await read('filter-v1', () => load({ includeAdminOnly: false }));
  assert.equal(calls, 1); assert.deepEqual(other, first);
  first.AND[0].OR[1].categoriaCodigo.notIn.push('poison');
  assert.ok(!other.AND[0].OR[1].categoriaCodigo.notIn.includes('poison'));
  const admin = await read('filter-v1', () => load({ includeAdminOnly: true }));
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(admin).includes('private'));
  excluded = true;
  const updated = await read('filter-v2', () => load({ includeAdminOnly: true }));
  assert.equal(calls, 3); assert.ok(JSON.stringify(updated).includes('manual'));
  assert.deepEqual(await read('filter-v1', () => load({ includeAdminOnly: false })), other);
});
