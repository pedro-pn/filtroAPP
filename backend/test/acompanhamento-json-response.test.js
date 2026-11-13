import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createAcompanhamentoResponder } from '../src/lib/acompanhamento/read-cache.js';
import { clearDerivedReadCaches } from '../src/lib/operations/derived-read-cache.js';
import { requestSourceContext } from '../src/lib/operations/request-sources.js';

const config = overrides => ({ acompanhamentoReadCacheEnabled: true,
  acompanhamentoResponseCacheEnabled: true, acompanhamentoMonthlyCacheEnabled: false,
  acompanhamentoReferenceCacheEnabled: false, acompanhamentoProgressCacheEnabled: false, ...overrides });

async function fixture(t, { settings = {}, controls = {}, contentType = null } = {}) {
  clearDerivedReadCaches();
  const state = { revision: 'one', failed: false, queries: 0, loads: 0 };
  const database = { $queryRaw: async () => {
    state.queries++;
    if (state.failed) throw new Error('unavailable');
    return [{ revision: state.revision, server: 'synthetic-server', database: 'json-response-test' }];
  } };
  const send = createAcompanhamentoResponder({ database, config: config(controls) });
  const app = express();
  for (const [key, value] of Object.entries(settings)) app.set(key, value);
  const payload = user => ({ label: 'Texto sintético <>& café', date: new Date('2026-09-01T00:00:00Z'),
    items: [null, .1 + .2, Number.NaN], absent: undefined,
    ...(user === 'admin' ? { financial: { total: 123.45 } } : {}) });
  app.use((req, res, next) => {
    if (contentType) res.type(contentType);
    req.auth = { user: { id: req.get('x-test-profile') || 'admin' } }; next();
  });
  app.get('/reference', (req, res) => res.json(payload(req.auth.user.id)));
  app.get('/cached', (req, res, next) => {
    requestSourceContext(req, res, () => send(req, res, 'synthetic', () => {
      state.loads++; return payload(req.auth.user.id);
    })).catch(next);
  });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    clearDerivedReadCaches();
  });
  const request = (path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
  return { request, state };
}

test('serialized responses preserve exact Express bytes, headers, ETag, HEAD and conditional 304', async t => {
  const { request, state } = await fixture(t);
  const reference = await request('/reference');
  const expected = await reference.text();
  for (let index = 0; index < 2; index++) {
    const response = await request('/cached');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), expected);
    for (const header of ['content-type', 'content-length', 'etag']) assert.equal(response.headers.get(header), reference.headers.get(header));
  }
  const head = await request('/cached', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('content-length'), reference.headers.get('content-length'));
  const conditional = await request('/cached', { cache: 'force-cache', headers: { 'if-none-match': reference.headers.get('etag') } });
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), '');
  assert.equal(state.loads, 1);
  assert.equal(state.queries, 4, 'Every cached HTTP response still verifies freshness');
});

test('custom Express JSON escaping, replacer and indentation retain the standard JSON path', async t => {
  const { request } = await fixture(t, { settings: {
    'json escape': true, 'json spaces': 2,
    'json replacer': (key, value) => key === 'financial' ? undefined : value
  } });
  const reference = await request('/reference');
  const expected = await reference.text();
  assert.ok(expected.includes('\\u003c'));
  assert.ok(expected.includes('\n  '));
  assert.ok(!expected.includes('financial'));
  for (let index = 0; index < 2; index++) assert.equal(await (await request('/cached')).text(), expected);
});

test('serialized responses preserve an existing response content type', async t => {
  const { request } = await fixture(t, { contentType: 'application/problem+json' });
  const reference = await request('/reference');
  const cached = await request('/cached');
  assert.equal(cached.headers.get('content-type'), reference.headers.get('content-type'));
  assert.equal(await cached.text(), await reference.text());
});

test('serialized responses isolate user projections, observe new revisions and fail closed', async t => {
  const { request, state } = await fixture(t);
  assert.equal((await (await request('/cached')).json()).financial.total, 123.45);
  assert.equal((await (await request('/cached', { headers: { 'x-test-profile': 'viewer' } })).json()).financial, undefined);
  assert.equal(state.loads, 2);
  assert.equal((await (await request('/cached')).json()).financial.total, 123.45);
  state.revision = 'two';
  await request('/cached');
  assert.equal(state.loads, 3);
  state.failed = true;
  const failed = await request('/cached');
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error, /verificar/);
  assert.equal(state.loads, 3, 'A revision failure cannot serve the old JSON or recompute without verification');
});

test('disabled response cache keeps normal JSON rendering without retaining DTOs', async t => {
  const { request, state } = await fixture(t, { controls: { acompanhamentoResponseCacheEnabled: false } });
  const expected = await (await request('/reference')).text();
  for (let index = 0; index < 2; index++) assert.equal(await (await request('/cached')).text(), expected);
  assert.equal(state.loads, 2);
  assert.equal(state.queries, 0, 'All new layers disabled must avoid the revision query');
});
