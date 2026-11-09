import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createRequestMetrics, normalizedRequestRoute } from '../src/middleware/request-metrics.js';
import { measureRequestStage } from '../src/lib/operations/request-performance.js';
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
