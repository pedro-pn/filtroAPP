import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';

let server, createRecorder;
before(async () => {
  server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true }, appType: 'custom' });
  ({ createPagePerformanceRecorder: createRecorder } = await server.ssrLoadModule('/src/observability/pagePerformance.ts'));
});
after(async () => { await server?.close(); });
const sample = { surface: 'gestor:pendentes', phase: 'content-visible', source: 'cache', refreshing: true, durationMs: 12.345 };

test('coleta exige opt-in e só aceita superfícies conhecidas e durações válidas', () => {
  let enabled = false;
  const recorder = createRecorder(() => 0, () => enabled);
  recorder.record(sample);
  assert.deepEqual(recorder.read().samples, []);
  enabled = true;
  recorder.record({ ...sample, surface: '/projects/private-id?token=secret' });
  recorder.record({ ...sample, durationMs: NaN });
  recorder.record({ ...sample, durationMs: -1 });
  assert.deepEqual(recorder.read().samples, []);
  recorder.record({ ...sample, url: '/secret', projectId: 'private-id' });
  assert.deepEqual(recorder.read().samples, [{ ...sample, durationMs: 12.3 }]);
});

test('buffer e janela são limitados, com contagem explícita das amostras descartadas', () => {
  let now = 0;
  const recorder = createRecorder(() => now, () => true);
  for (let i = 0; i < 203; i++) recorder.record(sample);
  assert.equal(recorder.read().samples.length, 200);
  assert.equal(recorder.read().dropped, 3);
  now = 900_000;
  recorder.record(sample);
  assert.equal(recorder.read().dropped, 3);
  recorder.clear();
  recorder.record(sample);
  assert.equal(recorder.read().samples.length, 1);
  assert.equal(recorder.read().dropped, 0);
});

test('consulta do buffer não permite alterar evidências e separa atualização de conteúdo inicial', () => {
  const recorder = createRecorder(() => 0, () => true);
  recorder.record(sample);
  recorder.record({ ...sample, phase: 'refresh-complete', source: 'network', refreshing: false });
  const copy = recorder.read();
  copy.samples[0].surface = 'changed';
  copy.samples.pop();
  assert.equal(recorder.read().samples[0].surface, sample.surface);
  assert.deepEqual(recorder.read().samples.map(row => row.phase), ['content-visible', 'refresh-complete']);
});

test('relatório separa cache/rede e só publica percentis com cem amostras sem truncamento', () => {
  const recorder = createRecorder(() => 0, () => true);
  for (let index = 1; index <= 100; index++) recorder.record({ ...sample, durationMs: index });
  recorder.record({ ...sample, source: 'network', durationMs: 250 });
  const report = recorder.report();
  assert.equal(report[0].p50Ms, 50);
  assert.equal(report[0].p95Ms, 95);
  assert.equal(report[1].p95Ms, null);
  for (let index = 0; index < 100; index++) recorder.record(sample);
  assert.ok(recorder.report().every(row => row.truncated && row.p95Ms === null));
});
