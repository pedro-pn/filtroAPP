import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { assertLocalPerformanceDatabase, createActivePoolReport, mapConcurrent, summarizeHttpSamples } from '../scripts/lib/http-performance-report.js';

test('HTTP benchmark only accepts explicit loopback PostgreSQL test databases', () => {
  for (const url of ['postgresql://localhost/http_test', 'postgres://127.0.0.1:55439/http_test', 'postgresql://[::1]/http_test']) assert.doesNotThrow(() => assertLocalPerformanceDatabase(url));
  for (const url of ['postgresql://example.test/http_test', 'postgresql://127.0.0.1/filtro', 'https://localhost/http_test',
    'postgresql://127.0.0.1/http_test?host=example.test', 'postgresql://127.0.0.1/http_test?database=filtro', undefined]) assert.throws(() => assertLocalPerformanceDatabase(url));
});

test('HTTP percentiles separate phase, profile, status and aborts and suppress p95 below 100', () => {
  const row = (durationMs, extra = {}) => ({ scenario: 'cards', profile: 'admin', phase: 'warm', status: 200,
    clientMs: durationMs + 1, bytes: 512, server: { aborted: false, durationMs, poolWaitingMax: 0, eventLoopDelayMaxMs: 0 }, ...extra });
  const samples = Array.from({ length: 100 }, (_, index) => row(index + 1));
  samples.push(row(1000, { phase: 'first-process' }), row(1000, { profile: 'viewer' }), row(1000, { status: 500 }));
  samples.push(row(1000, { server: { aborted: true, durationMs: 1000, poolWaitingMax: 7, eventLoopDelayMaxMs: 35 } }));
  const groups = summarizeHttpSamples(samples);
  assert.equal(groups.length, 5);
  assert.equal(groups[0].requests, 100);
  assert.equal(groups[0].serverMedianMs, 50);
  assert.equal(groups[0].clientP95Ms, 96);
  assert.equal(groups[0].serverP95Ms, 95);
  assert.equal(groups[0].maxPoolWaiting, 0);
  for (const group of groups.slice(1)) { assert.equal(group.enoughSamples, false); assert.equal(group.serverP95Ms, null); }
  assert.equal(groups.at(-1).maxPoolWaiting, 7);
  assert.equal(Object.hasOwn(groups[0], 'databaseQueriesPeakMax'), false, 'Old traces remain readable');
  const [withPeaks] = summarizeHttpSamples(samples.slice(0, 100).map((sample, index) => ({
    ...sample, server: { ...sample.server, databaseQueriesPeak: index % 2 ? 7 : 3 }
  })));
  assert.equal(withPeaks.databaseQueriesPeakMedian, 3);
  assert.equal(withPeaks.databaseQueriesPeakMax, 7);
  const [withWait] = summarizeHttpSamples(samples.slice(0, 100).map(sample => ({
    ...sample, server: { ...sample.server, stages: { 'labor.sources.queue': 10, 'detail.sources.queue': 20 } }
  })));
  assert.equal(withWait.sourceQueueWaitTotalMedianMs, 30);
  assert.equal(withWait.sourceQueueWaitTotalP95Ms, 30);
  assert.equal(Object.hasOwn(groups[0], 'sourceQueueWaitTotalMedianMs'), false);
});

test('pool target uses active interval samples and detects sustained observed queueing', () => {
  const report = createActivePoolReport();
  assert.equal(report.result().waitingZeroFraction, null);
  for (let index = 0; index < 100; index++) report.add({ waiting: 0 }, index, false);
  report.add({ waiting: 2 }, 1000, true);
  report.add({ waiting: 1 }, 6001, true);
  for (let index = 0; index < 98; index++) report.add({ waiting: 0 }, 7000 + index * 10, true);
  const result = report.result();
  assert.equal(result.samples, 100);
  assert.equal(result.waitingZeroFraction, .98);
  assert.equal(result.waitingZeroTargetMet, true);
  assert.equal(result.waitingMax, 2);
  assert.equal(result.observedWaitingOverFiveSeconds, true);
  assert.equal(result.observedWaitingRunMaxMs, 5001);
});

test('concurrency is bounded and a failure drains active work before rejecting', async () => {
  let active = 0, peak = 0;
  await mapConcurrent(Array.from({ length: 12 }, (_, index) => index), 3, async () => {
    active++; peak = Math.max(peak, active);
    await setImmediate();
    active--;
  });
  assert.equal(peak, 3);
  const started = [];
  let release, finished = false;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = mapConcurrent([0, 1, 2, 3], 2, async value => {
    started.push(value);
    if (!value) { await Promise.resolve(); throw new Error('controlled failure'); }
    await gate;
  }).catch(error => { finished = true; return error; });
  await setImmediate();
  assert.deepEqual(started, [0, 1]);
  assert.equal(finished, false);
  release();
  assert.match((await pending).message, /controlled failure/);
  assert.deepEqual(started, [0, 1]);
});
