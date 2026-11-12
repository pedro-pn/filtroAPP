import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedHttpPerformanceFixture } from '../scripts/fixtures/http-performance.js';
import { startHttpPerformanceServer } from '../scripts/benchmark-http-performance.js';
import { assertLocalPerformanceDatabase } from '../scripts/lib/http-performance-report.js';

test('PostgreSQL + HTTP: isolated cache layers preserve every response field and observe external writes', {
  skip: !process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL, timeout: 90000
}, async t => {
  const url = process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL;
  assertLocalPerformanceDatabase(url);
  process.env.DATABASE_URL = url;
  const { createPrismaClient } = await import('../src/lib/prisma.js');
  const database = createPrismaClient();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-cache-layers-'));
  let fixture;
  const servers = new Set();
  t.after(async () => {
    for (const server of servers) await server.stop();
    if (fixture) await fixture.cleanup();
    await database.$disconnect();
    await fs.rm(directory, { recursive: true, force: true });
  });
  fixture = await seedHttpPerformanceFixture(database, { reportCount: 40, scopeCount: 6, distributeGroupReports: true });
  const options = { poolLimit: 8, directory, sourceRoot: fileURLToPath(new URL('../', import.meta.url)) };
  const start = async controls => {
    const server = await startHttpPerformanceServer({ ...options, ...controls });
    servers.add(server); return server;
  };
  const stop = async server => { await server.stop(); servers.delete(server); };
  const routes = ['/api/acompanhamento/comercial/projetos-cards',
    '/api/acompanhamento/comercial/projetos/' + fixture.projectId + '/detalhe?progress=current',
    '/api/acompanhamento/comercial/grupos-missoes/' + fixture.groupId + '/detalhe?progress=current',
    '/api/acompanhamento/ponto/colaboradores?view=summary'];
  const referenceResponses = async () => {
    const reference = await start({ readCacheEnabled: false });
    const expected = {};
    try {
      for (const profile of ['admin', 'viewer']) {
        expected[profile] = [];
        for (const route of routes) {
          const response = await reference.request(route, fixture.sessions[profile][0]);
          assert.equal(response.status, 200); expected[profile].push(response.body);
        }
      }
    } finally { await stop(reference); }
    return expected;
  };
  for (const layer of ['none', 'responses', 'monthly', 'references', 'progress']) {
    await t.test(layer, async () => {
      const candidate = await start({ readCacheEnabled: true, readCacheLayers: { [layer]: true } });
      try {
        // With every new layer off, legacy caches retain their original TTL.
        // Use that mode as the uncached-process business reference only; each
        // enabled layer below must observe external commits without a restart.
        for (const phase of layer === 'none' ? ['initial'] : ['initial', 'external-write']) {
          if (phase === 'external-write') assert.equal((await fixture.workerWrite()).projectTimestampUnchanged, true);
          const expected = await referenceResponses();
          const traces = [];
          for (const profile of ['admin', 'viewer']) {
            const responses = await Promise.all(routes.map(route => candidate.request(route, fixture.sessions[profile][0])));
            assert.ok(responses.every(row => row.status === 200));
            assert.deepEqual(responses.map(row => row.body), expected[profile], layer + '/' + phase + '/' + profile);
            traces.push(...responses.map(row => row.server));
          }
          if (layer === 'none') {
            assert.ok(traces.every(row => !row.caches && !Object.hasOwn(row.stages, 'cache.verify')));
          } else {
            assert.ok(traces.some(row => row.caches?.[layer]?.miss > 0));
            assert.ok(traces.every(row => Object.keys(row.caches || {}).every(name => name === layer)));
          }
          assert.doesNotMatch(JSON.stringify(traces), /labor-benchmark-|Bearer |tokenHash/);
        }
      } finally { await stop(candidate); }
    });
  }
});
