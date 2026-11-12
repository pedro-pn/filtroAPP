import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createRequestMetrics, normalizedRequestRoute } from '../src/middleware/request-metrics.js';
import { measureRequestStage, withRequestPerformance, recordRequestCache } from '../src/lib/operations/request-performance.js';
import { createDerivedReadCache } from '../src/lib/operations/derived-read-cache.js';
import { createPerformanceReport } from '../scripts/report-performance.js';

test('mede respostas rápidas e 304, preserva prefixo do módulo e o pico do pool', async t => {
  const records = [];
  let waiting = 0;
  const app = express();
  app.use(createRequestMetrics({ enabled: true, windowMs: 5000, sampleIntervalMs: 10,
    getPool: () => ({ total: 8, idle: 0, waiting, max: 8 }), write: event => records.push(event), slowLog() {} }));
  const router = express.Router();
  router.get('/:id', async (req, res) => {
    await measureRequestStage('sources', async () => {
      waiting = 7;
      await new Promise(resolve => setTimeout(resolve, 35));
      waiting = 0;
    });
    if (req.query.unchanged) return res.status(304).end();
    res.json({ ok: true });
  });
  app.use('/api/rdo/reports', router);
  app.use('/api/efetivo/projects', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await (await fetch(`${origin}/api/rdo/reports/private-id?token=secret`)).text();
  await (await fetch(`${origin}/api/efetivo/projects/private-id?unchanged=true`)).text();
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(record => [record.path, record.statusCode]), [
    ['/api/rdo/reports/:id', 200], ['/api/efetivo/projects/:id', 304]
  ]);
  assert.equal(records[0].poolWaitingMax, 7);
  assert.equal(records[0].dbPool.waiting, 0);
  assert.ok(records[0].stages.sources >= 30);
  assert.ok(Object.hasOwn(records[0].stages, 'http.serialize'));
  assert.ok(records[0].responseBytes > 0);
  assert.doesNotMatch(JSON.stringify(records), /private-id|token=secret/);
});

test('nenhum caminho não reconhecido ou parâmetro de montagem é publicado', () => {
  assert.equal(normalizedRequestRoute({ path: '/secret', originalUrl: '/secret?token=x' }), 'unmatched');
  assert.equal(normalizedRequestRoute({ baseUrl: '/api/projects/a-secret-token', route: { path: '/reports/:id' } }), '/api/projects/:scope/reports/:id');
});

test('amostras ativas do pool são contadas uma vez durante requisições sobrepostas', async t => {
  const records = [];
  let reads = 0, waiting = 2, arrived = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const app = express();
  app.use(createRequestMetrics({ enabled: true, windowMs: 5000, sampleIntervalMs: 10,
    getPool: () => { reads++; return { total: 8, waiting, idle: 0, max: 8 }; },
    write: record => records.push(record), slowLog() {} }));
  app.get('/work', async (_req, res) => { arrived++; await gate; res.json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { release(); server.close(resolve); server.closeAllConnections(); }));
  const requests = [1, 2].map(() => fetch('http://127.0.0.1:' + server.address().port + '/work').then(response => response.json()));
  while (arrived < 2) await new Promise(resolve => setTimeout(resolve, 5));
  await new Promise(resolve => setTimeout(resolve, 35));
  waiting = 0;
  await new Promise(resolve => setTimeout(resolve, 35));
  release(); await Promise.all(requests);
  const intervals = records.reduce((sum, record) => sum + record.activePool.samples, 0);
  assert.equal(intervals, reads - 4, 'Start/end reads are excluded and interval observations cannot be duplicated');
  const report = createPerformanceReport(); records.forEach(record => report.add(record));
  const pool = report.result().pool;
  assert.equal(pool.samples, intervals);
  assert.ok(pool.waitingZeroSamples > 0 && pool.waitingZeroSamples < pool.samples);
  assert.equal(pool.waitingMax, 2);
  assert.deepEqual(pool.sampleIntervalsMs, [10]);
});

test('relatório agrega os intervalos do pool e mantém resultado desconhecido sem amostras', () => {
  const report = createPerformanceReport();
  assert.equal(report.result().pool.waitingZeroTargetMet, null);
  const row = { method: 'GET', path: '/api/projects', durationMs: 1, statusCode: 200 };
  report.add({ ...row, activePool: { samples: 100, waitingZeroSamples: 96, waitingMax: 3, observedWaitingRunMaxMs: 5001, sampleIntervalMs: 100 } });
  report.add({ ...row, activePool: { samples: 100, waitingZeroSamples: 100, waitingMax: 0, observedWaitingRunMaxMs: 0, sampleIntervalMs: 100 } });
  assert.equal(report.result().pool.waitingZeroFraction, .98);
  assert.equal(report.result().pool.waitingZeroTargetMet, true);
  assert.equal(report.result().pool.observedWaitingOverFiveSeconds, true);
  report.add({ ...row, activePool: { samples: 1, waitingZeroSamples: 2 } });
  assert.equal(report.result().pool.samples, 200, 'Malformed interval counts do not create a false acceptance');
});

test('coleta desativada ou expirada conserva logs lentos sem emitir amostra completa', async () => {
  for (const options of [{ enabled: false, windowMs: 1000 }, { enabled: true, windowMs: -1 }]) {
    const handlers = {};
    let slow = 0;
    const middleware = createRequestMetrics({ ...options,
      getPool: () => ({ waiting: 0 }), slowLog: () => slow++, write: () => assert.fail('disabled') });
    middleware({ method: 'GET', baseUrl: '/api/rdo', route: { path: '/projects' } },
      { statusCode: 200, once: (name, handler) => { handlers[name] = handler; } }, () => {});
    handlers.finish(); handlers.close();
    assert.equal(slow, 1);
  }
});

test('relatório separa status, inclui leituras rápidas e não declara p95 de entrada truncada', () => {
  const report = createPerformanceReport({ maxSamples: 3, maxRoutes: 2 });
  for (const durationMs of [1, 10, 900, 2000]) report.add({ method: 'GET', path: '/api/rdo/reports', statusCode: 200, durationMs });
  report.add({ method: 'GET', path: '/api/rdo/reports', statusCode: 304, durationMs: 2 });
  report.add({ method: 'GET', path: '/third', statusCode: 200, durationMs: 3 });
  const result = report.result();
  assert.equal(result.routes[0].requests, 4);
  assert.equal(result.routes[0].p95Ms, null);
  assert.equal(result.routes[0].complete, false);
  assert.equal(result.routes[1].p95Ms, 2);
  assert.equal(result.routes[1].enoughSamplesForAcceptance, false);
  assert.equal(result.droppedRoutes, 1);
});

test('cache telemetry counts work once, measures copies per consumer and never exposes keys or revisions', async () => {
  const cache = createDerivedReadCache({ cacheName: 'monthly', maxEntryBytes: 50 });
  const trace = { stages: {} };
  await withRequestPerformance(trace, async () => {
    await Promise.all([1, 2].map(() => cache.get('secret-revision', ['private-user', 'private-project'], () => ({ total: 1 }))));
    await cache.get('secret-revision', ['private-user', 'private-project'], () => assert.fail('cached'));
    await cache.get('another-revision', 'large-secret-key', () => ({ value: 'x'.repeat(100) }));
    await assert.rejects(cache.get('another-revision', 'failed-secret-key', () => { throw new Error('private-error'); }), /private-error/);
    recordRequestCache('private-cache', 'hit');
    recordRequestCache('monthly', 'private-field');
  });
  const values = trace.caches.monthly;
  assert.equal(values.miss, 3);
  assert.equal(values.shared, 1);
  assert.equal(values.hit, 1);
  assert.equal(values.oversized, 1);
  assert.equal(values.loadFailed, 1);
  assert.equal(values.revisionChanged, 1);
  assert.equal(values.decodeFailed, undefined);
  assert.ok(values.encodedBytes > 100 && values.encodeMs >= 0 && values.decodeMs >= 0);
  assert.deepEqual(Object.keys(trace.caches), ['monthly']);
  assert.doesNotMatch(JSON.stringify(trace), /secret|private|another-revision/);
  const report = createPerformanceReport();
  report.add({ method: 'GET', path: '/api/projects', durationMs: 1, caches: trace.caches });
  report.add({ method: 'GET', path: '/api/projects', durationMs: 1, caches: {
    monthly: { hit: 2, miss: -1, shared: 'bad', decodeMs: Infinity, private: 42 }, 'private-cache': { hit: 1 }
  } });
  assert.equal(report.result().caches.monthly.hit, 3);
  assert.equal(report.result().caches.monthly.miss, 3);
  assert.deepEqual(Object.keys(report.result().caches), ['monthly']);
  assert.doesNotMatch(JSON.stringify(report.result()), /private/);
});

test('HTTP records include fixed cache aggregates only while detailed collection is enabled', async t => {
  const records = [];
  const cache = createDerivedReadCache({ cacheName: 'responses' });
  const app = express();
  app.use(createRequestMetrics({ enabled: true, windowMs: 5000, getPool: () => ({ waiting: 0 }),
    slowLog() {}, write: row => records.push(row) }));
  app.get('/work/:id', async (_req, res) => res.json(await cache.get('private-revision', 'private-key', () => ({ ok: true }))));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/work/private-id`;
  await (await fetch(url)).text(); await (await fetch(url)).text();
  assert.equal(records[0].caches.responses.miss, 1);
  assert.equal(records[1].caches.responses.hit, 1);
  assert.ok(records[0].caches.responses.encodeMs >= 0);
  assert.doesNotMatch(JSON.stringify(records), /private/);
});
