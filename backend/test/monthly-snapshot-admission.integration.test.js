import assert from 'node:assert/strict';
import test from 'node:test';
import { serialize } from 'node:v8';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedHttpPerformanceFixture } from '../scripts/fixtures/http-performance.js';
import { startHttpPerformanceServer } from '../scripts/benchmark-http-performance.js';
import { assertLocalPerformanceDatabase } from '../scripts/lib/http-performance-report.js';

test('PostgreSQL + HTTP: large historical monthly snapshots bypass codecs and preserve money, permissions and freshness', {
  skip: !process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL, timeout: 90000
}, async t => {
  assertLocalPerformanceDatabase(process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL);
  process.env.DATABASE_URL = process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL;
  const { default: database } = await import('../src/lib/prisma.js');
  const { computeCollaboratorRates } = await import('../src/lib/acompanhamento/labor-cost.js');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-monthly-admission-'));
  const servers = new Set();
  let fixture;
  t.after(async () => {
    for (const server of servers) await server.stop();
    if (fixture) await fixture.cleanup();
    await database.$disconnect();
    await fs.rm(directory, { recursive: true, force: true });
  });
  fixture = await seedHttpPerformanceFixture(database, { reportCount: 40, scopeCount: 6, distributeGroupReports: true });
  // Preserve a long historical window and large import metadata. No business
  // result or source field is removed merely to fit the cache byte bound.
  await database.pontoImport.update({ where: { id: fixture.importId }, data: {
    periodStart: new Date('2010-01-01'), summary: { syntheticHistory: 'x'.repeat(4 * 1024 * 1024) }
  } });
  assert.ok(serialize(await computeCollaboratorRates()).byteLength > 2 * 1024 * 1024, 'The real calculation must exceed the snapshot byte bound');
  const options = { poolLimit: 8, directory, sourceRoot: fileURLToPath(new URL('../', import.meta.url)) };
  const start = async controls => {
    const server = await startHttpPerformanceServer({ ...options, ...controls });
    servers.add(server); return server;
  };
  const stop = async server => { await server.stop(); servers.delete(server); };
  const candidate = await start({ readCacheEnabled: true, readCacheLayers: { monthly: true } });
  const routes = ['/api/acompanhamento/comercial/projetos-cards',
    '/api/acompanhamento/comercial/projetos/' + fixture.projectId + '/detalhe?progress=current',
    '/api/acompanhamento/comercial/grupos-missoes/' + fixture.groupId + '/detalhe?progress=current',
    '/api/acompanhamento/ponto/colaboradores?view=summary'];
  let baselinePoint;
  for (const phase of ['initial', 'external-write']) {
    if (phase === 'external-write') assert.equal((await fixture.workerWrite()).projectTimestampUnchanged, true);
    const reference = await start({ readCacheEnabled: false });
    let bypassed = 0, rejected = 0;
    try {
      for (const profile of ['admin', 'viewer']) {
        for (const route of routes) {
          const expected = await reference.request(route, fixture.sessions[profile][0]);
          const actual = await candidate.request(route, fixture.sessions[profile][0]);
          assert.equal(expected.status, 200); assert.equal(actual.status, 200);
          assert.deepEqual(actual.body, expected.body, phase + '/' + profile + '/' + route);
          const counters = actual.server.caches?.monthly;
          if (counters) {
            assert.ok(counters.bypassed >= 1);
            bypassed += counters.bypassed;
            rejected += counters.admissionRejected || 0;
            for (const field of ['encodedBytes', 'encodeMs', 'decodeMs', 'shared', 'loadFailed']) assert.equal(counters[field], undefined);
          }
          if (route === routes[3]) assert.ok(counters, 'Point summary must execute the monthly calculation');
          if (profile === 'admin' && route === routes[3]) {
            if (phase === 'initial') baselinePoint = actual.body;
            else assert.notDeepEqual(actual.body.rates, baselinePoint.rates, 'External writes still update the complete financial projection');
          }
        }
      }
      assert.ok(bypassed > 0 && rejected > 0, phase + ': at least one oversized calculation must be detected and returned through the owned path');
    } finally { await stop(reference); }
  }
});
