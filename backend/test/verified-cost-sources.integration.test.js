import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedHttpPerformanceFixture } from '../scripts/fixtures/http-performance.js';
import { startHttpPerformanceServer } from '../scripts/benchmark-http-performance.js';
import { assertLocalPerformanceDatabase } from '../scripts/lib/http-performance-report.js';

test('PostgreSQL + HTTP: independent cost requests share verified catalogs and observe external commits', {
  skip: !process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL, timeout: 90000
}, async t => {
  const url = process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL;
  assertLocalPerformanceDatabase(url);
  process.env.DATABASE_URL = url;
  process.env.ACOMPANHAMENTO_READ_CACHE_ENABLED = 'true';
  const { default: database } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const { clearProjectDerivedCaches } = await import('../src/lib/resource-list-cache.js');
  const originals = { reference: database.$queryRaw,
    categories: database.omieCategory.findMany };
  const writer = new pg.Pool({ connectionString: url, max: 1 });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-verified-costs-'));
  let fixture, server, previousEpi, settingsLoaded = false;
  const counts = { references: 0, categories: 0 };
  t.after(async () => {
    database.$queryRaw = originals.reference;
    database.omieCategory.findMany = originals.categories;
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    if (fixture) {
      await database.report.deleteMany({ where: { id: { startsWith: fixture.prefix + '-fallback-rdo-' } } });
      await database.collaborator.deleteMany({ where: { id: fixture.prefix + '-fallback-person' } });
      await database.omiePurchase.deleteMany({ where: { omieId: fixture.prefix + '-purchase' } });
      await database.omieCategory.deleteMany({ where: { codigo: fixture.prefix + '-category' } });
      if (settingsLoaded) {
        if (previousEpi) await database.acompanhamentoSetting.update({ where: { key: 'epiAnnualCost' }, data: { numberValue: previousEpi.numberValue } });
        else await database.acompanhamentoSetting.deleteMany({ where: { key: 'epiAnnualCost' } });
      }
      await fixture.cleanup();
    }
    clearProjectDerivedCaches();
    await writer.end(); await database.$disconnect();
    await fs.rm(directory, { recursive: true, force: true });
  });
  fixture = await seedHttpPerformanceFixture(database, { reportCount: 40, scopeCount: 6, distributeGroupReports: true });
  previousEpi = await database.acompanhamentoSetting.findUnique({ where: { key: 'epiAnnualCost' } });
  settingsLoaded = true;
  await database.collaborator.create({ data: { id: fixture.prefix + '-fallback-person', code: fixture.prefix + '-fallback-person',
    name: 'Pessoa sem ponto', jobRoleId: fixture.prefix + '-role' } });
  for (const [index, projectId] of fixture.projectIds.slice(0, 2).entries()) {
    await database.report.create({ data: { id: fixture.prefix + '-fallback-rdo-' + index,
      projectId, reportType: 'RDO', sequenceNumber: 900 + index, status: 'APPROVED', reportDate: new Date('2026-09-12'),
      arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1, daytimeWorkedMinutes: 480,
      collaborators: { create: { collaboratorId: fixture.prefix + '-fallback-person' } } } });
  }
  await database.omieCategory.create({ data: { codigo: fixture.prefix + '-category', descricao: 'Insumo sintético', adminOnly: true } });
  await database.omiePurchase.create({ data: { omieId: fixture.prefix + '-purchase', projectId: fixture.projectId,
    categoriaCodigo: fixture.prefix + '-category', categoriaDescricao: 'Insumo sintético', valor: '123.45', rawPayload: {} } });
  await database.$executeRaw`ANALYZE`;
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const endpoint = 'http://127.0.0.1:' + server.address().port;
  const routes = [
    ...fixture.projectIds.slice(0, 2).map(id => '/api/acompanhamento/comercial/projetos/' + id + '/detalhe?progress=current'),
    '/api/acompanhamento/comercial/grupos-missoes/' + fixture.groupId + '/detalhe?progress=current',
    '/api/acompanhamento/ponto/colaboradores?view=summary',
    '/api/acompanhamento/comercial/projetos-cards'
  ];
  const get = async (route, profile, session = 0) => {
    const response = await fetch(endpoint + route, { headers: { authorization: 'Bearer ' + fixture.sessions[profile][session] } });
    assert.equal(response.status, 200);
    return response.json();
  };
  database.$queryRaw = (...args) => {
    if (args[0][0].includes('labor.cost-reference-rows')) counts.references++;
    return originals.reference.apply(database, args);
  };
  database.omieCategory.findMany = (...args) => { counts.categories++; return originals.categories.apply(database.omieCategory, args); };
  clearProjectDerivedCaches();
  let before;
  for (const phase of ['initial', 'parameters', 'settings-and-categories']) {
    if (phase === 'parameters') {
      await writer.query('INSERT INTO "CostParameterSet" (id, "costProfileId", version, "effectiveDate", params, "createdAt") VALUES ($1,$2,2,$3,$4,now())',
        [fixture.prefix + '-parameter-v2', fixture.prefix + '-role-profile', '2026-09-15', { salarioBase: 6500, baseModel: fixture.prefix + '-model' }]);
    }
    if (phase === 'settings-and-categories') {
      const connection = await writer.connect();
      try {
        await connection.query('BEGIN');
        await connection.query('INSERT INTO "AcompanhamentoSetting" (key,"numberValue","updatedAt") VALUES ($1,12000,now()) ON CONFLICT (key) DO UPDATE SET "numberValue"=12000,"updatedAt"=now()', ['epiAnnualCost']);
        await connection.query('UPDATE "OmieCategory" SET "includeInAcompanhamentoCosts"=false WHERE codigo=$1', [fixture.prefix + '-category']);
        await connection.query('COMMIT');
      } catch (error) { await connection.query('ROLLBACK'); throw error; }
      finally { connection.release(); }
    }
    // A fresh ordinary API is the complete business reference: unversioned
    // legacy TTLs in an existing process are not an uncached reference. The
    // candidate stays alive; no API cache is cleared after an external write.
    const reference = await startHttpPerformanceServer({ poolLimit: 8, directory,
      sourceRoot: fileURLToPath(new URL('../', import.meta.url)), readCacheEnabled: false });
    const expected = {};
    try {
      for (const profile of ['admin', 'viewer']) {
        expected[profile] = [];
        for (const route of routes) {
          const response = await reference.request(route, fixture.sessions[profile][0]);
          assert.equal(response.status, 200); expected[profile].push(response.body);
        }
      }
    } finally { await reference.stop(); }
    for (const key of Object.keys(counts)) counts[key] = 0;
    const actual = {};
    for (const profile of ['admin', 'viewer']) {
      actual[profile] = await Promise.all(routes.map((route, index) => get(route, profile, index % 2)));
    }
    assert.deepEqual(actual, expected, phase + ': every response field, allocation trail and permission projection must match');
    assert.deepEqual(counts, { references: 2, categories: 2 }, 'One combined reference load per protected scope across different routes/sessions');
    assert.equal(actual.admin[0].canViewProjectFinancials, true);
    assert.equal(actual.viewer[0].canViewProjectFinancials, false);
    assert.ok(actual.admin[0].colaboradores.some(person => person.collaboratorId === fixture.prefix + '-fallback-person' && person.custoEstimadoRdo > 0));
    if (before) {
      assert.notDeepEqual(actual.admin[3].rates, before.admin[3].rates, 'Next request observes changed effective parameters/annual settings');
      assert.notDeepEqual(actual.admin[4].map(card => card.laborCost), before.admin[4].map(card => card.laborCost),
        'Cards observe external financial writes immediately, including their intermediate caches');
    }
    before = actual;
  }
  const originalRaw = database.$queryRaw;
  database.$queryRaw = () => { throw new Error('revision unavailable'); };
  try {
    const failure = await fetch(endpoint + routes[4], { headers: { authorization: 'Bearer ' + fixture.sessions.admin[0] } });
    assert.equal(failure.status, 503, 'Even cached cards must verify the source revision before serving a response');
    assert.deepEqual(await failure.json(), { error: 'Não foi possível verificar a atualização dos dados. Tente novamente.' });
  } finally { database.$queryRaw = originalRaw; }
  const originalReferenceRead = database.$queryRaw;
  await writer.query('UPDATE "JobRole" SET name=$1 WHERE id=$2', ['Cargo atualizado ' + fixture.prefix, fixture.prefix + '-role']);
  database.$queryRaw = (...args) => {
    if (args[0][0].includes('labor.cost-reference-rows')) throw new Error('catalog unavailable');
    return originalReferenceRead.apply(database, args);
  };
  try {
    const failure = await fetch(endpoint + routes[0], { headers: { authorization: 'Bearer ' + fixture.sessions.admin[0] } });
    assert.equal(failure.status, 404, 'The detail route preserves its existing error contract instead of serving a preceding revision');
    assert.deepEqual(await failure.json(), { error: 'catalog unavailable' });
  } finally { database.$queryRaw = originalReferenceRead; }
  assert.equal((await get(routes[0], 'admin')).canViewProjectFinancials, true, 'A subsequent request retries the failed catalog');
});
