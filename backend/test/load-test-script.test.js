import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { percentile, readConfig, summarize, verdict } from '../scripts/load-test.js';

const script = fileURLToPath(new URL('../scripts/load-test.js', import.meta.url));

test('o teste de carga recusa produção e aceita só homologação ou máquina local', () => {
  assert.throws(() => readConfig({ LOAD_BASE_URL: 'https://app.filtrovali.com.br' }), /recusa app\.filtrovali\.com\.br/);
  assert.throws(() => readConfig({ LOAD_BASE_URL: 'https://filtrovali.com.br' }), /recusa/);
  assert.equal(readConfig({ LOAD_BASE_URL: 'https://filtrostaging.filtrovali.com.br/x' }).baseUrl, 'https://filtrostaging.filtrovali.com.br');
  assert.equal(readConfig({ LOAD_BASE_URL: 'http://127.0.0.1:4100' }).stages.length, 5);
  assert.throws(() => readConfig({ LOAD_BASE_URL: 'http://localhost', LOAD_STAGES: '5,abc' }), /LOAD_STAGES/);
});

test('resumo separa 429 (limitador) de erro e calcula percentis', () => {
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 95), 40);
  const summary = summarize([
    { name: 'a', status: 200, ok: true, ms: 100 },
    { name: 'a', status: 200, ok: true, ms: 300 },
    { name: 'b', status: 429, ok: false, ms: 5 },
    { name: 'b', status: 500, ok: false, ms: 50 }
  ]);
  assert.equal(summary.requests, 4);
  assert.equal(summary.errors, 1);
  assert.equal(summary.limited, 1);
  assert.equal(summary.errorRate, 0.25);
  assert.equal(summary.endpoints.a.p95, 300);
  assert.equal(summary.endpoints.b.errors, 1);
});

test('capacidade é o maior degrau dentro da meta e o gargalo vem do primeiro degrau que estourou', () => {
  const stage = (users, p95, errorRate, endpoints) => ({ users, summary: { p95, errorRate, endpoints } });
  const result = verdict([
    stage(5, 200, 0, { a: { p95: 200, errors: 0 } }),
    stage(10, 900, 0, { a: { p95: 900, errors: 0 } }),
    stage(20, 2600, 0.002, { a: { p95: 800, errors: 0 }, cards: { p95: 2600, errors: 0 } })
  ], { targetP95: 1500, maxErrorRate: 0.01 });
  assert.equal(result.capacityUsers, 10);
  assert.equal(result.firstFailingStage, 20);
  assert.equal(result.bottleneck.name, 'cards');
});

test('roda contra um servidor local, entra por cookie de sessão e grava o resultado', async t => {
  const seen = new Set();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    seen.add(url.pathname);
    if (url.pathname === '/api/auth/login') {
      assert.equal(req.headers['x-filtrovali-request'], '1');
      res.setHeader('set-cookie', 'fv_session=abc; HttpOnly; Path=/');
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ user: { id: 'u' } }));
    }
    if (req.headers.cookie !== 'fv_session=abc') { res.statusCode = 401; return res.end('{}'); }
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/rdo/reports') return res.end(JSON.stringify({ items: [{ id: 'r1', status: 'APPROVED' }] }));
    return res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'load-test-'));
  const output = path.join(dir, 'resultado.json');
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, LOAD_BASE_URL: `http://127.0.0.1:${server.address().port}`, LOAD_USERNAME: 'carga', LOAD_PASSWORD: 'x',
      LOAD_STAGES: '2,4', LOAD_STAGE_SECONDS: '1', LOAD_THINK_MS: '20', LOAD_OUTPUT: output },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  const code = await new Promise(resolve => child.on('exit', resolve));
  assert.equal(code, 0, stdout);
  const report = JSON.parse(await fs.readFile(output, 'utf8'));
  assert.deepEqual(report.results.map(stage => stage.users), [2, 4]);
  assert.equal(report.verdict.capacityUsers, 4);
  assert.ok(report.results[0].summary.requests > 0);
  assert.equal(report.results.reduce((sum, stage) => sum + stage.summary.errors, 0), 0);
  assert.ok(seen.has('/api/rdo/reports/r1/pdf') || report.results.every(stage => !stage.summary.endpoints['PDF do RDO']));
  assert.match(stdout, /Capacidade/);
});
