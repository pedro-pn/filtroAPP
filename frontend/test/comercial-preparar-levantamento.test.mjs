import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server;
let client;
let api;
let mod;
let ServicosDosCircuitosBloco;
const storageAnterior = globalThis.localStorage;

const levantamento = {
  id: 'custo-1', proposalCode: '4418', revisionNumber: 2, mode: 'REVISAO',
  title: 'Limpeza química', status: 'RASCUNHO',
  updatedAt: '2026-09-15T12:00:00.000Z',
  payload: {
    title: 'Limpeza química',
    circuitServices: [{ id: 's1', serviceId: 'limpeza_quimica', systemId: 'circuito-1' }]
  }
};

test.before(async () => {
  globalThis.localStorage = { getItem: () => null };
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom'
  });
  client = await server.ssrLoadModule('/src/api/client.ts');
  api = await server.ssrLoadModule('/src/api/comercial.ts');
  mod = await server.ssrLoadModule('/src/pages/comercial/proposta/prepararLevantamento.ts');
  ({ ServicosDosCircuitosBloco } = await server.ssrLoadModule(
    '/src/pages/comercial/custos/sections/ServicosDosCircuitosBloco.tsx'
  ));
});

test.after(async () => {
  globalThis.localStorage = storageAnterior;
  await server?.close();
});

function responder(aoGravar, atual = levantamento) {
  const chamadas = [];
  client.apiClient.defaults.adapter = async config => {
    chamadas.push(config);
    assert.equal(config.url, '/comercial/levantamentos/custo-1');
    const data = config.method === 'get' ? atual : await aoGravar(config);
    return { status: 200, statusText: 'OK', headers: {}, config, data };
  };
  return chamadas;
}

test('rascunho completo é validado e concluído com a versão atual antes de abrir a proposta', async () => {
  const chamadas = responder(config => {
    const entrada = JSON.parse(config.data);
    assert.deepEqual(entrada, {
      proposalCode: levantamento.proposalCode,
      revisionNumber: levantamento.revisionNumber,
      mode: levantamento.mode,
      title: levantamento.title,
      payload: levantamento.payload,
      status: 'SALVO',
      expectedUpdatedAt: levantamento.updatedAt
    });
    return { ...levantamento, status: 'SALVO', salePrice: '38139.33' };
  });

  const pronto = await mod.prepararLevantamentoParaProposta(levantamento.id);
  assert.deepEqual(chamadas.map(item => item.method), ['get', 'put']);
  assert.equal(pronto.id, levantamento.id);
  assert.equal(pronto.status, 'SALVO');
  assert.equal(pronto.salePrice, '38139.33');
  assert.deepEqual(pronto.payload, levantamento.payload);
});

test('levantamento já concluído abre a proposta sem regravar o orçamento', async () => {
  const atual = { ...levantamento, status: 'SALVO', salePrice: '42000.00' };
  const chamadas = responder(() => assert.fail('Não deve gravar.'), atual);
  assert.deepEqual(await mod.prepararLevantamentoParaProposta(atual.id), atual);
  assert.deepEqual(chamadas.map(item => item.method), ['get']);
});

test('pendência real preserva as mensagens por campo e não contorna a validação', async () => {
  const issues = [
    { path: 'logistics[0].calculationMode', message: 'Informe o transporte.' },
    { path: 'circuitServices[0].systemId', message: 'Escolha o sistema.' }
  ];
  const chamadas = responder(config => {
    throw { isAxiosError: true, config, response: { status: 422, data: { issues } } };
  });
  await assert.rejects(() => mod.prepararLevantamentoParaProposta(levantamento.id), error => {
    assert.ok(error instanceof api.ComercialValidationError);
    assert.deepEqual(error.issues, issues);
    assert.deepEqual(Object.fromEntries(mod.parametrosDasPendenciasDoLevantamento(levantamento, error.issues)), {
      modo: 'revision', base: '4418', revisao: '2', id: 'custo-1', secao: 'inputs'
    });
    return true;
  });
  assert.deepEqual(chamadas.map(item => item.method), ['get', 'put']);
});

test('conflito não força a conclusão nem sobrescreve o levantamento de outro usuário', async () => {
  const chamadas = responder(config => {
    throw { isAxiosError: true, config, response: { status: 409, data: {
      error: 'Levantamento atualizado por outra pessoa.',
      code: api.CONCURRENT_WRITE_CODE,
      conflict: { updatedAt: '2026-09-15T12:01:00.000Z', updatedByLabel: 'Colega' }
    } } };
  });
  await assert.rejects(() => mod.prepararLevantamentoParaProposta(levantamento.id), api.ComercialConcurrentWriteError);
  assert.deepEqual(chamadas.map(item => item.method), ['get', 'put']);
});

test('avisos de mão de obra não desviam o usuário da verdadeira pendência em outra seção', () => {
  const params = mod.parametrosDasPendenciasDoLevantamento(levantamento, [
    { path: 'laborContexts[0].durationDays', message: 'A etapa não possui duração.', severity: 'warning' },
    { path: 'commercial.representativeCommission.percent', message: 'Informe a comissão.', severity: 'error' }
  ]);
  assert.equal(params.get('secao'), 'summary');
});

test('falha ao carregar não grava um orçamento vazio', async () => {
  const chamadas = responder(() => assert.fail('Não deve gravar.'), { ...levantamento, payload: undefined });
  await assert.rejects(() => mod.prepararLevantamentoParaProposta(levantamento.id), /dados completos/);
  assert.equal(chamadas.length, 1);
});

function renderizarServicos(erros, associacoes = levantamento.payload.circuitServices) {
  return renderToStaticMarkup(createElement(ServicosDosCircuitosBloco, {
    levantamento: {
      draft: {
        volumeSystems: [{ id: 'circuito-1', name: 'Circuito 1' }],
        circuitServices: associacoes
      },
      erroDe: path => erros[path]
    }
  }));
}

test('circuito e serviço pendentes recebem borda vermelha e mensagem associada ao campo', () => {
  const html = renderizarServicos({
    'circuitServices': 'Há sistemas sem serviço.',
    'circuitServices[0].systemId': 'Escolha o circuito.',
    'circuitServices[0].serviceId': 'Escolha o serviço.'
  });
  assert.match(html, /<select[^>]*aria-label="Circuito do serviço 1"[^>]*aria-invalid="true"[^>]*class="com-campo-invalido"[^>]*aria-describedby="s1-circuito-erro"/);
  assert.match(html, /<select[^>]*aria-label="Serviço do circuito 1"[^>]*aria-invalid="true"[^>]*class="com-campo-invalido"[^>]*aria-describedby="s1-servico-erro"/);
  assert.match(html, /id="s1-circuito-erro"[^>]*>Escolha o circuito\./);
  assert.match(html, /id="s1-servico-erro"[^>]*>Escolha o serviço\./);
  assert.doesNotMatch(html, /<section[^>]*aria-invalid/,
    'o grupo não deve roubar o foco do campo específico');
});

test('sem nenhuma linha de serviço, o bloco pendente permite focar o botão de adicionar', () => {
  const html = renderizarServicos({ circuitServices: 'Adicione os serviços.' }, []);
  assert.match(html, /<section[^>]*com-campo-invalido[^>]*aria-invalid="true"[^>]*aria-describedby="com-servicos-circuitos-erro"/);
  assert.match(html, /id="com-servicos-circuitos-erro"/);
  assert.match(html, /\+ Adicionar serviço/);
});

test('serviços válidos não recebem marcação de erro', () => {
  const html = renderizarServicos({});
  assert.doesNotMatch(html, /aria-invalid|com-campo-invalido|field-error/);
});
