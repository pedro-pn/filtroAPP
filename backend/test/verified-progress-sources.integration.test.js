import assert from 'node:assert/strict';
import test from 'node:test';
import { seedHttpPerformanceFixture } from '../scripts/fixtures/http-performance.js';
import { assertLocalPerformanceDatabase } from '../scripts/lib/http-performance-report.js';

test('PostgreSQL + HTTP: cards, detail and groups reuse progress sources and observe external writes', {
  skip: !process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL
}, async t => {
  assertLocalPerformanceDatabase(process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL);
  process.env.DATABASE_URL = process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL;
  process.env.ACOMPANHAMENTO_READ_CACHE_ENABLED = 'true';
  const { default: database } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const { clearProjectDerivedCaches } = await import('../src/lib/resource-list-cache.js');
  const original = database.reportService.findMany;
  let fixture, server;
  t.after(async () => {
    database.reportService.findMany = original;
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    if (fixture) await fixture.cleanup();
    clearProjectDerivedCaches(); await database.$disconnect();
  });
  fixture = await seedHttpPerformanceFixture(database, { reportCount: 120, scopeCount: 6, distributeGroupReports: true });
  let reads = 0;
  const batches = [];
  database.reportService.findMany = (...args) => {
    if (args[0].select?.extraData && args[0].select.report && Array.isArray(args[0].where?.report?.projectId?.in)) {
      reads++; batches.push(args[0].where.report.projectId.in);
    }
    return original.apply(database.reportService, args);
  };
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const endpoint = 'http://127.0.0.1:' + server.address().port;
  const routes = {
    cards: '/api/acompanhamento/comercial/projetos-cards',
    detail: '/api/acompanhamento/comercial/projetos/' + fixture.projectId + '/detalhe?progress=current',
    group: '/api/acompanhamento/comercial/grupos-missoes/' + fixture.groupId + '/detalhe?progress=current'
  };
  const get = async (kind, profile = 'admin', session = 0) => {
    const response = await fetch(endpoint + routes[kind], { headers: { authorization: 'Bearer ' + fixture.sessions[profile][session] } });
    assert.equal(response.status, 200);
    return response.json();
  };
  clearProjectDerivedCaches();
  await get('cards');
  assert.equal(reads, 1, 'Cards load the project set in one native batch');
  const before = await get('detail', 'admin', 1);
  assert.equal(reads, 1, 'A new response variant reuses the previously verified project');
  await get('group');
  assert.equal(reads, 2);
  assert.deepEqual(batches.at(-1), [fixture.projectIds[1]], 'The group loads only its additional member without planned scope');
  const viewer = await get('detail', 'viewer');
  assert.equal(reads, 3, 'Restricted native source sets stay isolated from administrator data');
  assert.equal(viewer.canViewProjectFinancials, false);
  clearProjectDerivedCaches(); reads = 0; batches.length = 0;
  await get('group');
  await get('cards');
  await get('detail');
  assert.equal(reads, 1, 'Priming the group also serves smaller sets without another native batch');
  const worker = await fixture.workerWrite();
  assert.equal(worker.projectTimestampUnchanged, true);
  await get('group');
  await get('cards', 'admin', 1);
  const after = await get('detail');
  await get('group');
  assert.equal(reads, 2, 'A new transactional revision loads the group batch once again');
  assert.notEqual(after.progressRevision, before.progressRevision);
  assert.notEqual(after.avancoPct, before.avancoPct);
});
