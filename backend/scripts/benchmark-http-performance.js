import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { seedHttpPerformanceFixture } from './fixtures/http-performance.js';
import { assertLocalPerformanceDatabase, mapConcurrent, summarizeHttpSamples } from './lib/http-performance-report.js';

export async function startHttpPerformanceServer({ poolLimit, directory, sourceRoot, readCacheEnabled }) {
  assertLocalPerformanceDatabase(process.env.DATABASE_URL);
  const child = fork(fileURLToPath(new URL('./fixtures/http-performance-server.js', import.meta.url)), [sourceRoot], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, NODE_ENV: 'test', DATABASE_CONNECTION_LIMIT: String(poolLimit),
      HTTP_PERFORMANCE_ENABLED: 'true', HTTP_PERFORMANCE_WINDOW_MS: '900000', HTTP_PERFORMANCE_SAMPLE_MS: '10',
      ACOMPANHAMENTO_READ_CACHE_ENABLED: String(readCacheEnabled),
      BACKGROUND_JOBS_IN_API: 'false', ERROR_TRACKING_WEBHOOK_URL: '',
      ASSETS_DIR: path.join(directory, 'assets'), REPORTS_DIR: path.join(directory, 'reports') }
  });
  const pending = new Map();
  let sequence = 0, dead = false;
  const waitFor = (type, id) => new Promise((resolve, reject) => {
    const key = type + ':' + id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error('Local HTTP benchmark child timed out')); }, 60000);
    pending.set(key, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  });
  const ready = waitFor('ready', undefined);
  child.on('message', message => {
    const key = message.type + ':' + message.id;
    const waiter = pending.get(key);
    if (waiter) { pending.delete(key); waiter.resolve(message); }
  });
  child.on('exit', () => {
    dead = true;
    for (const waiter of pending.values()) waiter.reject(new Error('Local HTTP benchmark child exited'));
    pending.clear();
  });
  const stop = async () => {
    if (dead) return;
    const stopped = new Promise(resolve => child.once('exit', resolve));
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.send({ type: 'stop' });
    await stopped;
    clearTimeout(timer);
  };
  let started;
  try { started = await ready; } catch (error) { await stop(); throw error; }
  assert.equal(started.poolLimit, poolLimit);
  const control = async type => {
    const id = ++sequence, reply = waitFor('reply', id);
    child.send({ type, id });
    return (await reply).result;
  };
  return {
    stop, begin: () => control('begin'), pool: () => control('pool'),
    async request(route, token) {
      const id = ++sequence;
      const metric = waitFor('metric', id);
      const startedAt = performance.now();
      const network = (async () => {
        const response = await fetch('http://127.0.0.1:' + started.port + route, {
          headers: { 'x-http-benchmark-id': String(id), ...(token ? { authorization: 'Bearer ' + token } : {}) },
          signal: AbortSignal.timeout(60000)
        });
        const bytes = new Uint8Array(await response.arrayBuffer());
        return { status: response.status, bytes: bytes.byteLength, clientMs: performance.now() - startedAt,
          body: JSON.parse(new TextDecoder().decode(bytes)) };
      })();
      const [response, event] = await Promise.all([network, metric]);
      return { ...response, server: event.record };
    }
  };
}

function verifyResponse(scenario, profile, response, fixture, pontoView) {
  const diagnostic = response.status === 200 ? '' : String(response.body.error || response.body.code || 'unexpected status')
    .split(fixture.prefix).join('[fixture]').replace(/postgres(?:ql)?:\/\/\S+/gi, '[database]').slice(-800);
  assert.equal(response.status, 200, scenario + '/' + profile + ': expected authenticated success. ' + diagnostic);
  assert.equal(response.server.statusCode, 200);
  assert.equal(response.server.aborted, false);
  assert.ok(response.bytes > 0);
  assert.equal(response.bytes, response.server.responseBytes);
  if (scenario === 'ponto') {
    if (pontoView === 'reconciliation') {
      assert.equal(response.body.importId, fixture.importId);
      assert.ok(Array.isArray(response.body.unmatched));
      return;
    }
    assert.equal(response.body.rates.length, fixture.collaborators);
    assert.ok(response.body.rates.every(rate => rate.hasCostProfile && rate.totalMensal > 0));
    return;
  }
  const values = Array.isArray(response.body) ? response.body : [response.body];
  assert.ok(values.length > 0);
  for (const value of values) {
    assert.equal(value.canViewProjectFinancials, profile === 'admin');
    if (profile === 'viewer') {
      for (const key of ['invoicedRevenue', 'invoicedIss', 'invoiceCount', 'presumedProfitTaxes']) assert.equal(Object.hasOwn(value, key), false);
      assert.equal(value.faturamento?.realizado, undefined);
      assert.equal(value.faturamento?.notas, undefined);
    }
  }
  if (scenario === 'cards') {
    assert.equal(JSON.stringify(response.body).includes(fixture.projectIds[2]), profile === 'admin', 'manager-only project visibility');
  }
}

export async function runHttpPerformanceBenchmark({
  requests = 100, concurrency = 4, coldRounds = 3, reportCount = 1200, scopeCount = 297, poolLimit = 8, readCacheEnabled = false,
  pontoView = 'full', sourceRoot = fileURLToPath(new URL('..', import.meta.url)), distributeGroupReports = false
} = {}) {
  assertLocalPerformanceDatabase(process.env.DATABASE_URL);
  assert.ok(['full', 'summary', 'reconciliation'].includes(pontoView));
  assert.equal(typeof distributeGroupReports, 'boolean');
  assert.equal(typeof readCacheEnabled, 'boolean');
  sourceRoot = path.resolve(sourceRoot);
  await fs.access(path.join(sourceRoot, 'src/app.js'));
  for (const [value, max] of [[requests, 500], [coldRounds, 100], [reportCount, 6000], [scopeCount, 297], [concurrency, 8], [poolLimit, 50]]) {
    assert.ok(Number.isInteger(value) && value >= 1 && value <= max, 'Benchmark option outside its bounded range');
  }
  const { default: database } = await import('../src/lib/prisma.js');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-http-performance-'));
  let fixture, server;
  let attemptedScenarioRequests = 0;
  const samples = [], pool = [], permissionChecks = [], refresh = [];
  try {
    const counts = await Promise.all([
      database.project.count({ where: { id: { notIn: ['internal-maintenance-5002', 'internal-production-5004'] } } }),
      database.pontoImport.count(), database.report.count(), database.user.count(),
      database.commercialProposal.count(), database.crmOpportunity.count(), database.acompanhamentoMissionGroup.count()
    ]);
    assert.ok(counts.every(count => count === 0), 'Use a dedicated empty test database; the benchmark reads global cards and point data.');
    // Fixture deletion alone does not reset heap/TOAST pages for later cohorts.
    // This guarded, empty loopback test database owns the synthetic workload.
    await database.$executeRaw`VACUUM (ANALYZE)`;
    fixture = await seedHttpPerformanceFixture(database, { reportCount, scopeCount, distributeGroupReports });
    // Bulk synthetic loading can leave small-table estimates behind. Establish
    // statistics before measuring fresh API processes, rather than timing that
    // unrelated planner transition or waiting for background autovacuum.
    await database.$executeRaw`ANALYZE`;
    const routes = {
      cards: '/api/acompanhamento/comercial/projetos-cards',
      detail: '/api/acompanhamento/comercial/projetos/' + fixture.projectId + '/detalhe?progress=current',
      group: '/api/acompanhamento/comercial/grupos-missoes/' + fixture.groupId + '/detalhe?progress=current',
      ponto: '/api/acompanhamento/ponto/colaboradores' + (pontoView === 'full' ? '' : '?view=' + pontoView)
    };
    const request = async (scenario, profile, phase, session = 0) => {
      attemptedScenarioRequests++;
      const response = await server.request(routes[scenario], fixture.sessions[profile][session]);
      const { body, ...sample } = response;
      samples.push({ scenario, profile, phase, ...sample });
      verifyResponse(scenario, profile, response, fixture, pontoView);
      return body;
    };
    // Each cold sample is the first application request in its own API process.
    // Fixture setup and PostgreSQL page caches are shared and explicitly excluded.
    for (const scenario of Object.keys(routes)) for (const profile of ['admin', 'viewer']) {
      for (let round = 0; round < coldRounds; round++) {
        server = await startHttpPerformanceServer({ poolLimit, directory, sourceRoot, readCacheEnabled });
        await server.begin();
        await request(scenario, profile, 'first-process', round % 2);
        pool.push({ scenario, profile, phase: 'first-process', round, ...await server.pool() });
        await server.stop(); server = null;
      }
    }
    server = await startHttpPerformanceServer({ poolLimit, directory, sourceRoot, readCacheEnabled });
    const before = {};
    for (const scenario of Object.keys(routes)) for (const profile of ['admin', 'viewer']) {
      before[scenario + ':' + profile] = await request(scenario, profile, 'warmup');
    }
    pool.push({ phase: 'warmup', ...await server.pool() });
    await server.begin();
    const jobs = Array.from({ length: requests }, (_, index) => Object.keys(routes).flatMap(scenario => ['admin', 'viewer'].map(profile => ({ scenario, profile, session: index % 2 })))).flat();
    await mapConcurrent(jobs, concurrency, ({ scenario, profile, session }) => request(scenario, profile, 'warm', session));
    pool.push({ phase: 'warm', ...await server.pool() });
    // Negative access checks follow warm cache population.
    for (const [scenario, route] of Object.entries(routes)) {
      for (const [kind, token, status] of [['no-session', null, 401], ['no-module', fixture.sessions.blocked[0], 403]]) {
        const response = await server.request(route, token);
        assert.equal(response.status, status);
        permissionChecks.push({ scenario, kind, status });
      }
    }
    // Parent and API have separate Prisma/pool instances. Do not invalidate API
    // memory here: this models a worker commit observed by independent sessions.
    const worker = await fixture.workerWrite();
    assert.equal(worker.projectTimestampUnchanged, true);
    await server.begin();
    const committedAt = performance.now();
    const refreshJobs = Object.keys(routes).flatMap(scenario => ['admin', 'viewer'].flatMap(profile => [0, 1].map(session => ({ scenario, profile, session }))));
    await mapConcurrent(refreshJobs, concurrency, async ({ scenario, profile, session }) => {
      const body = await request(scenario, profile, 'after-worker-write', session);
      const reference = before[scenario + ':' + profile];
      const changed = scenario === 'detail' || scenario === 'group'
        ? body.progressRevision !== reference.progressRevision && body.avancoPct !== reference.avancoPct
        : scenario === 'ponto'
          ? pontoView === 'reconciliation' ? body.unmatched.length !== reference.unmatched.length
            : body.rates.find(rate => rate.collaboratorId === fixture.prefix + '-person-0').normalHoras !== reference.rates.find(rate => rate.collaboratorId === fixture.prefix + '-person-0').normalHoras
          : body.some(card => {
            const previous = reference.find(row => row.projectId === card.projectId && row.groupId === card.groupId && row.id === card.id);
            return previous && card.workedHours?.normalWorkedHours !== previous.workedHours?.normalWorkedHours;
          });
      // Record stale cards as false in legacy baselines too. The current API's
      // integration contract requires all four surfaces to observe the write.
      if (scenario !== 'cards') assert.equal(changed, true, 'Worker changes must be visible to the next completed request: ' + scenario);
      refresh.push({ scenario, profile, session, changed, completedAfterCommitMs: performance.now() - committedAt });
    });
    pool.push({ phase: 'after-worker-write', ...await server.pool() });
    const summary = summarizeHttpSamples(samples);
    const withinBudget = (scenario, limit) => {
      const rows = summary.filter(row => row.phase === 'warm' && row.scenario === scenario);
      return rows.some(row => row.serverP95Ms == null) ? null : rows.every(row => row.serverP95Ms < limit);
    };
    return {
      method: 'Synthetic loopback HTTP against the real Express app and migrated PostgreSQL. Authentication validates persisted hashed sessions through requireAuth; password login is not exercised. First-process samples use a fresh API process per request, with warm database pages and process imports excluded. Warm requests mix surfaces, profiles and two sessions per profile under a bounded shared concurrency. Client timing includes response-body receipt; server timing includes authentication and serialization. Active-pool interval samples are observations, not individual query wait times. No Nginx, TLS, browser rendering, external API or production load is measured.',
      environment: { nodeVersion: process.version, apiPoolLimit: poolLimit, concurrency, poolSampleIntervalMs: 10, pontoView, readCacheEnabled },
      complete: true, attemptedScenarioRequests,
      fixture: { syntheticProjects: 3, groupMembers: 2, groupReportsDistributed: distributeGroupReports, reports: fixture.reportCount, services: fixture.serviceCount,
        collaborators: fixture.collaborators, scopeLines: scopeCount, divisions: 11, authenticatedSessions: 4,
        vacuumedBeforeSeeding: true, analyzedBeforeRequests: true },
      summary, pool, permissionChecks, refresh, worker, samples,
      acceptance: { productionAcceptance: false, coldP95Available: coldRounds >= 100,
        warmP95Available: requests >= 100,
        warmCardsServerP95Under2s: withinBudget('cards', 2000),
        warmDetailServerP95Under1_5s: withinBudget('detail', 1500),
        refreshWithin15s: refresh.filter(row => row.changed != null).every(row => row.changed && row.completedAfterCommitMs <= 15000) }
    };
  } catch (error) {
    error.httpBenchmark = { complete: false, attemptedScenarioRequests, receivedScenarioResponses: samples.length,
      failure: { name: error.name, message: String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi, '[database]').slice(-1000) },
      summary: summarizeHttpSamples(samples), pool, permissionChecks, refresh, samples,
      acceptance: { productionAcceptance: false, functionalChecksPassed: false } };
    throw error;
  } finally {
    try { if (server) await server.stop(); }
    finally {
      try { if (fixture) await fixture.cleanup(); }
      finally { await database.$disconnect(); await fs.rm(directory, { recursive: true, force: true }); }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
  let result;
  try {
    result = await runHttpPerformanceBenchmark({
      requests: Number(arg('requests') || 100), concurrency: Number(arg('concurrency') || 4),
      coldRounds: Number(arg('cold-rounds') || 3), reportCount: Number(arg('reports') || 1200),
      scopeCount: Number(arg('scopes') || 297), poolLimit: Number(arg('pool-limit') || 8),
      pontoView: arg('ponto-view') || 'full',
      distributeGroupReports: process.argv.includes('--distribute-group-reports'),
      readCacheEnabled: process.argv.includes('--read-cache'),
      ...(arg('source-root') ? { sourceRoot: arg('source-root') } : {})
    });
  } catch (error) {
    if (arg('output') && error.httpBenchmark) await fs.writeFile(arg('output'), JSON.stringify(error.httpBenchmark, null, 2) + '\n');
    throw error;
  }
  if (arg('output')) await fs.writeFile(arg('output'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ summary: result.summary, pool: result.pool, acceptance: result.acceptance }, null, 2));
}
