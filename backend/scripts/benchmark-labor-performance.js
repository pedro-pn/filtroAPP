import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { seedLaborPerformanceFixture } from './fixtures/labor-performance.js';
import { captureLaborQueries, summarizeLaborReportOrder } from './fixtures/labor-query-profile.js';
import { assertLocalPerformanceDatabase } from './lib/http-performance-report.js';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
assertLocalPerformanceDatabase(process.env.DATABASE_URL);
const localRoot = fileURLToPath(new URL('..', import.meta.url));
const mode = arg('mode');
const captureSourceOrder = process.argv.includes('--capture-source-order');
const encode = (_key, value) => value instanceof Map ? { map: [...value] } : value instanceof Set ? { set: [...value] } : value;

if (mode) {
  assert.ok(['warm', 'new-process', 'after-session'].includes(mode));
  const root = arg('source-root') || localRoot;
  const importStartedAt = performance.now();
  const { computeCollaboratorRates } = await import(pathToFileURL(path.join(root, 'src/lib/acompanhamento/labor-cost.js')));
  const { default: database } = await import(pathToFileURL(path.join(root, 'src/lib/prisma.js')));
  const serviceImportMs = performance.now() - importStartedAt;
  const importId = arg('import-id');
  let sqlProfile;
  const reportSources = [];
  try {
    const priorReadStartedAt = performance.now();
    if (mode === 'warm') await computeCollaboratorRates(importId);
    if (mode === 'after-session') await database.userSession.findFirst({ select: { id: true } });
    const priorReadMs = performance.now() - priorReadStartedAt;
    const queries = [];
    if (process.argv.includes('--profile')) {
      sqlProfile = captureLaborQueries();
      for (const model of Object.keys(database).filter(key => !key.startsWith('_') && !key.startsWith('$'))) {
        const delegate = database[model];
        if (!delegate || typeof delegate.findMany !== 'function') continue;
        for (const method of ['findMany', 'findFirst', 'findUnique', 'groupBy']) {
          const original = delegate[method];
          if (typeof original !== 'function') continue;
          delegate[method] = async (...args) => {
            const at = performance.now();
            const result = await original.apply(delegate, args);
            queries.push({ model, method, startedAt: at, durationMs: performance.now() - at,
              rows: Array.isArray(result) ? result.length : Number(Boolean(result)), resultJsonBytes: Buffer.byteLength(JSON.stringify(result)) });
            return result;
          };
        }
      }
    }
    if (captureSourceOrder || sqlProfile) {
      const original = database.report.findMany;
      database.report.findMany = async (...args) => {
        const rows = await original.apply(database.report, args);
        reportSources.push(rows);
        return rows;
      };
    }
    const startedAt = performance.now();
    const cpuStartedAt = process.cpuUsage();
    const result = await computeCollaboratorRates(importId);
    const durationMs = performance.now() - startedAt;
    const cpuMicros = process.cpuUsage(cpuStartedAt);
    const sqlQueries = sqlProfile ? await sqlProfile.finish(startedAt) : undefined;
    console.log(JSON.stringify({ durationMs, cpuMicros, cpuTotalMs: (cpuMicros.user + cpuMicros.system) / 1000,
      result, initialization: { serviceImportMs, priorReadMs },
      queries: queries.map(query => ({ ...query, startedAt: query.startedAt - startedAt })), sqlQueries,
      ...(captureSourceOrder || sqlProfile ? { sourceOrderDiagnostics: reportSources.map(summarizeLaborReportOrder) } : {}) }, encode));
  } finally { sqlProfile?.restore(); await database.$disconnect(); }
} else {
  const baseline = arg('baseline-root');
  assert.ok(baseline, 'Pass --baseline-root=<archived backend root> for a paired comparison.');
  const rounds = Number(arg('rounds') || 5), reportCount = Number(arg('reports') || 1200), servicesPerRdo = Number(arg('services-per-rdo') || 4);
  assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 20);
  assert.ok(Number.isInteger(reportCount) && reportCount >= 1 && reportCount <= 10000);
  assert.ok(Number.isInteger(servicesPerRdo) && servicesPerRdo >= 0 && servicesPerRdo <= 10);
  const { default: database, getDatabasePoolMetrics } = await import('../src/lib/prisma.js');
  let fixture, failureRecorded = false;
  const samples = {}, summary = {};
  try {
    const existing = await Promise.all([
      database.project.count({ where: { id: { notIn: ['internal-maintenance-5002', 'internal-production-5004'] } } }),
      database.pontoImport.count(), database.report.count(), database.user.count()
    ]);
    assert.ok(existing.every(count => count === 0), 'Use a dedicated empty test database for the global cost benchmark.');
    fixture = await seedLaborPerformanceFixture(database, { reportCount, servicesPerRdo });
    // Stabilize planner estimates for both sources before paired processes.
    // Diagnostics/timing must not include the initial bulk-load transition.
    await database.$executeRaw`ANALYZE`;
    const run = (root, mode, profile = false) => {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--source-root=${path.resolve(root)}`, `--import-id=${fixture.importId}`, `--mode=${mode}`, ...(profile ? ['--profile'] : []), ...(captureSourceOrder ? ['--capture-source-order'] : [])],
        { env: process.env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
      assert.equal(child.status, 0, child.stderr || child.error?.message);
      return JSON.parse(child.stdout);
    };
    for (const mode of ['warm', 'new-process', 'after-session']) {
      samples[mode] = [];
      for (let index = 0; index < rounds; index++) {
        // Alternate order to reduce systematic influence from database/CPU warming.
        const roots = index % 2 ? [localRoot, baseline] : [baseline, localRoot];
        const pair = roots.map(root => run(root, mode));
        try { assert.deepEqual(pair[0].result, pair[1].result, `Complete calculation differs in ${mode}`); }
        catch (error) {
          if (arg('output')) await fs.writeFile(arg('output'), JSON.stringify({ complete: false, exactParity: false,
            diagnosticOnly: captureSourceOrder, failedMode: mode, failedRound: index,
            samples, sourceOrderDiagnostics: pair.map(row => row.sourceOrderDiagnostics ?? null),
            failure: 'Complete calculation differs; this incomplete cohort is not timing acceptance.' }, null, 2) + '\n');
          failureRecorded = true;
          throw error;
        }
        const [before, after] = index % 2 ? [pair[1], pair[0]] : pair;
        samples[mode].push({ beforeMs: before.durationMs, afterMs: after.durationMs,
          beforeCpuMs: before.cpuTotalMs, afterCpuMs: after.cpuTotalMs,
          cpuMicros: { before: before.cpuMicros, after: after.cpuMicros },
          initialization: { before: before.initialization, after: after.initialization } });
        if (captureSourceOrder) samples[mode].at(-1).sourceOrderDiagnostics = {
          before: before.sourceOrderDiagnostics, after: after.sourceOrderDiagnostics
        };
      }
      const median = key => samples[mode].map(row => row[key]).sort((a, b) => a - b)[Math.floor(rounds / 2)];
      summary[mode] = { beforeMs: median('beforeMs'), afterMs: median('afterMs'),
        beforeCpuMs: median('beforeCpuMs'), afterCpuMs: median('afterCpuMs') };
      summary[mode].reductionPct = (1 - summary[mode].afterMs / summary[mode].beforeMs) * 100;
      summary[mode].cpuReductionPct = summary[mode].beforeCpuMs > 0
        ? (1 - summary[mode].afterCpuMs / summary[mode].beforeCpuMs) * 100 : null;
    }
    const profiles = [];
    if (process.argv.includes('--profile')) for (const mode of ['new-process', 'after-session']) for (const root of [baseline, localRoot]) {
      const { result: _result, ...profile } = run(root, mode, true);
      profiles.push({ revision: root === baseline ? 'baseline' : 'candidate', mode, ...profile });
    }
    const initializationProfiles = [];
    if (process.argv.includes('--profile')) for (const root of [baseline, localRoot]) for (let index = 0; index < 3; index++) {
      const child = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/labor-query-profile.js', import.meta.url)), path.resolve(root)],
        { env: process.env, encoding: 'utf8', timeout: 30000 });
      assert.equal(child.status, 0, child.stderr || child.error?.message);
      initializationProfiles.push({ revision: root === baseline ? 'baseline' : 'candidate', ...JSON.parse(child.stdout) });
    }
    const evidence = { method: 'Local paired uncached service calculations on PostgreSQL with warm database pages; not HTTP latency. Timings exclude process boot and module imports. Fresh Node/Prisma processes for every cold sample. After-session performs a SELECT, not HTTP authentication. Prisma operation profiles include mapping; sqlQueries capture pg pool calls and replay SELECTs with EXPLAIN ANALYZE after the calculation. Pool call durations overlap and include queue/event-loop delays. Initialization diagnostics run in separate processes and do not warm timed samples. Result bytes are JSON sizes, not network traffic.',
      cpuMethod: 'process.cpuUsage delta around the calculation only, before EXPLAIN replay; includes Node/Prisma CPU, excludes PostgreSQL, module imports and process boot. CPU and wall time are separate observations.',
      environment: { nodeVersion: process.version, databaseConnectionLimit: getDatabasePoolMetrics().max },
      fixture: { reports: fixture.reportCount, services: fixture.serviceCount, collaborators: fixture.collaborators, projectPreferenceEntries: 500,
        analyzedBeforeCalculations: true },
      samples, summary, complete: true, diagnosticOnly: captureSourceOrder, exactParity: true, profiles, initializationProfiles };
    if (arg('output')) await fs.writeFile(arg('output'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ summary, fixture: evidence.fixture, exactParity: true, profiles }, null, 2));
  } catch (error) {
    if (arg('output') && !failureRecorded) await fs.writeFile(arg('output'), JSON.stringify({
      complete: false, exactParity: false, diagnosticOnly: captureSourceOrder, samples,
      failure: 'Benchmark did not complete; this incomplete cohort is not timing acceptance.'
    }, null, 2) + '\n');
    throw error;
  } finally { if (fixture) await fixture.cleanup(); await database.$disconnect(); }
}
