import assert from 'node:assert/strict';
import test from 'node:test';

import { isRetryableError, retryAfterMs, withRetry } from '../src/lib/http/outbound.js';
import { syncConectaRh } from '../src/lib/conecta-rh/sync.js';
import { conectaRhFailureReporter } from '../src/lib/conecta-rh/job.js';
import { fetchCommercialProposal } from '../src/lib/projects/commercial-proposal-sync.js';

// Spec 042, critério 7.5: nova tentativa com espera exponencial e jitter nas
// integrações (Conecta RH e leituras do ComercialAPP), sem repetir 4xx.

const noSleep = { sleep: async () => {} };
const httpError = (status, extra = {}) => Object.assign(new Error(`HTTP ${status}`), { statusCode: status, ...extra });

test('withRetry repete falha transitória com espera exponencial e jitter, até o limite', async () => {
  const waits = [];
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw httpError(503);
    return 'ok';
  }, { attempts: 3, baseMs: 500, maxMs: 5000, random: () => 0.5, sleep: async ms => { waits.push(ms); } });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  // equal jitter: metade fixa + metade × random → 500→375, 1000→750.
  assert.deepEqual(waits, [375, 750]);

  calls = 0;
  await assert.rejects(withRetry(async () => { calls += 1; throw httpError(502); }, { attempts: 3, ...noSleep }), /HTTP 502/);
  assert.equal(calls, 3, 'para depois de 3 tentativas');
});

test('withRetry não repete 4xx (exceto 429) nem erro de contrato', async () => {
  for (const error of [httpError(400), httpError(403), httpError(404), httpError(410), new Error('Feed de RH incompatível com o contrato.')]) {
    let calls = 0;
    await assert.rejects(withRetry(async () => { calls += 1; throw error; }, noSleep));
    assert.equal(calls, 1, `não deveria repetir: ${error.message}`);
  }
});

test('429 respeita Retry-After, limitado a maxMs', async () => {
  const waits = [];
  let calls = 0;
  await withRetry(async () => {
    calls += 1;
    if (calls === 1) throw httpError(429, { retryAfterMs: 60_000 });
    return 'ok';
  }, { maxMs: 5000, jitter: false, sleep: async ms => { waits.push(ms); } });
  assert.deepEqual(waits, [5000]);
  assert.equal(retryAfterMs('2'), 2000);
  assert.equal(retryAfterMs(new Date(Date.now() + 3000).toUTCString()) > 1000, true);
  assert.equal(retryAfterMs('abc'), null);
});

test('retryOnResult descarta a resposta transitória e devolve a última como veio', async () => {
  const discarded = [];
  let calls = 0;
  const last = await withRetry(async () => ({ status: 503, id: ++calls, headers: { get: () => null } }), {
    retryOnResult: response => response.status === 503,
    discardResult: response => { discarded.push(response.id); },
    ...noSleep
  });
  assert.equal(last.id, 3, 'a terceira resposta volta para o chamador tratar');
  assert.deepEqual(discarded, [1, 2]);
});

test('cancelamento pelo chamador interrompe sem nova tentativa', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls += 1; throw httpError(503); }, { signal: controller.signal, ...noSleep }));
  assert.equal(calls, 1);
});

test('isRetryableError reconhece rede e prazo, mas não 500 nem 4xx', () => {
  assert.equal(isRetryableError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })), true);
  assert.equal(isRetryableError(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), true);
  assert.equal(isRetryableError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), true);
  assert.equal(isRetryableError(httpError(504)), true);
  assert.equal(isRetryableError(httpError(500)), false);
  assert.equal(isRetryableError(httpError(401)), false);
  assert.equal(isRetryableError(new Error('qualquer')), false);
});

const COMPANY_ID = '3f6f5b8e-1d2c-4b7a-9e1f-0a1b2c3d4e5f';

function conectaDatabase() {
  return {
    conectaRhSyncState: {
      findUnique: async () => ({ cursor: 'cursor-1' }),
      upsert: async () => ({})
    }
  };
}

test('Conecta RH: leitura do feed com 503 é repetida e a sincronização conclui', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(`${init.method} ${new URL(url).pathname}`);
    if (seen.length === 1) return new Response('{}', { status: 503 });
    return Response.json({ items: [], nextCursor: 'cursor-2', hasMore: false });
  };
  const result = await syncConectaRh({ database: conectaDatabase(), companyId: COMPANY_ID, apiUrl: 'https://conecta.example/api/rh',
    token: 'token', fetchImpl, production: false, retry: noSleep });
  assert.deepEqual(result, { events: 0, snapshots: 0 });
  assert.deepEqual(seen, ['GET /api/rh/changes', 'GET /api/rh/changes']);
});

test('Conecta RH: 4xx no feed não é repetido', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response('{}', { status: 401 }); };
  await assert.rejects(syncConectaRh({ database: conectaDatabase(), companyId: COMPANY_ID, apiUrl: 'https://conecta.example/api/rh',
    token: 'token', fetchImpl, production: false, retry: noSleep }), error => error.statusCode === 401);
  assert.equal(calls, 1);
});

test('Conecta RH: alerta só depois de N execuções seguidas com falha', async () => {
  const runs = statuses => ({ jobRun: { findMany: async ({ take }) => statuses.slice(0, take).map(status => ({ status })) } });
  const reported = [];
  const report = error => reported.push(error.message);
  const settle = () => new Promise(resolve => setImmediate(resolve));

  conectaRhFailureReporter({ database: runs(['FAILED', 'COMPLETED', 'FAILED']), threshold: 3, report })(new Error('1ª'));
  conectaRhFailureReporter({ database: runs(['FAILED', 'FAILED']), threshold: 3, report })(new Error('2ª'));
  conectaRhFailureReporter({ database: runs(['FAILED', 'FAILED', 'FAILED', 'COMPLETED']), threshold: 3, report })(new Error('3ª'));
  await settle();
  assert.deepEqual(reported, ['3ª']);
});

test('ComercialAPP: leitura da proposta repete 503 e, persistindo, mantém o código de erro de sempre', async () => {
  let calls = 0;
  const transport = async () => { calls += 1; return new Response('indisponível', { status: 503 }); };
  await assert.rejects(fetchCommercialProposal({ id: 'p1', clientCnpj: '00000000000191' }, { proposalCode: 'P-1', revisionNumber: 1 }, {
    transport, apiUrl: 'https://comercial.example', token: 'token', production: true, retry: noSleep
  }), error => error.code === 'COMERCIALAPP_HTTP_503');
  assert.equal(calls, 3);
});
