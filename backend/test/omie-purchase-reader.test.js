import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOmiePurchaseReader } from '../src/lib/omie/purchase-reader.js';

const fault = (status, message, faultcode = 'SOAP-ENV:Client-1') => Object.assign(new Error(message), {
  status, body: { faultstring: message, faultcode }
});
function harness(call) {
  let clock = 0;
  const waits = [], times = [];
  const reader = createOmiePurchaseReader({ requestDelayMs: 0, now: () => clock,
    wait: async ms => { waits.push(ms); clock += ms; },
    call: (...args) => { times.push(clock); return call(...args); }
  });
  return { ...reader, waits, times, advance: ms => { clock += ms; } };
}

for (const [name, error, expected] of [
  ['REDUNDANT', fault(500, 'ERROR: Consumo redundante detectado. Aguarde 59 segundos para tentar novamente (REDUNDANT).'), 61_000],
  ['espera indicada maior que um minuto', fault(429, 'Aguarde 120 segundos para tentar novamente'), 121_000],
  ['falha HTTP sem duração', fault(503, 'Serviço indisponível'), 61_000],
  ['rede após possível processamento no Omie', new TypeError('fetch failed'), 61_000],
  ['bloqueio HTTP 425', fault(425, 'API bloqueada por consumo indevido'), 1_801_000]
]) {
  test(`respeita o intervalo Omie antes de repetir a mesma página: ${name}`, async () => {
    let attempts = 0;
    const h = harness(async (_path, method, params) => {
      assert.equal(method, 'ListarContasPagar');
      assert.equal(params.pagina, 135);
      if (++attempts === 1) throw error;
      return { pagina: 135 };
    });
    assert.deepEqual(await h.read('ListarContasPagar', { pagina: 135 }), { pagina: 135 });
    assert.deepEqual(h.times, [0, expected]);
    assert.deepEqual(h.waits, [expected]);
    assert.equal(h.stats.retries, 1);
    assert.equal(h.stats.cooldownWaitMs, expected);
  });
}

test('reconsulta de uma página válida espera a janela sem reprocessar as demais', async () => {
  const h = harness(async (_path, _method, params) => ({ ...params }));
  await h.read('ListarContasPagar', { pagina: 1 });
  h.advance(1000);
  await h.read('ListarContasPagar', { pagina: 2 });
  await h.read('ListarContasPagar', { pagina: 1 });
  assert.deepEqual(h.times, [0, 1000, 61_000]);
  assert.deepEqual(h.waits, [60_000]);
  assert.equal(h.stats.retries, 0);
});

test('falha persistente respeita o intervalo e encerra após três tentativas', async () => {
  const error = fault(500, 'Aguarde 59 segundos (REDUNDANT)');
  const h = harness(async () => { throw error; });
  await assert.rejects(h.read('ListarContasPagar', { pagina: 10 }), error);
  assert.deepEqual(h.times, [0, 61_000, 122_000]);
  assert.equal(h.stats.apiCalls, 3);
  assert.equal(h.stats.retries, 2);
});

for (const error of [fault(401, 'Credenciais inválidas'), fault(403, 'Sem acesso'),
  fault(500, 'ERROR: Lançamento não cadastrado para o Código [123] !', 'SOAP-ENV:Client-105')]) {
  test(`não repete erro definitivo: HTTP ${error.status} ${error.body.faultcode}`, async () => {
    const h = harness(async () => { throw error; });
    await assert.rejects(h.read('ConsultarContaPagar', { codigo_lancamento_omie: 123 }), error);
    assert.equal(h.stats.apiCalls, 1);
    assert.deepEqual(h.waits, []);
  });
}

test('duração malformada não causa retry antecipado por overflow do timer', async () => {
  const error = fault(429, 'Aguarde 999999999999999999 segundos');
  const h = harness(async () => { throw error; });
  await assert.rejects(h.read('ListarContasPagar', { pagina: 1 }), error);
  assert.equal(h.stats.apiCalls, 1);
  assert.deepEqual(h.waits, []);
});
