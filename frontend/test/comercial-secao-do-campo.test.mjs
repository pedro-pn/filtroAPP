import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

/**
 * De qual seção é cada campo (parte da tarefa T047 / lacuna L1).
 *
 * O `422` devolve pendências endereçadas — `laborContexts[0].vehicleType` — e a tela
 * tem cinco seções. Sem esta tradução o usuário lê "há 8 pendências", olha a seção em
 * que está, vê tudo limpo, e não tem para onde ir.
 *
 * Os caminhos usados aqui **saíram de `validateCostEstimate` de verdade**, não foram
 * inventados: rodar o validador num rascunho incompleto produz exatamente estes.
 */

let server;
let secaoDoCaminho;
let primeiraSecaoPendente;

test.before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });
  ({ secaoDoCaminho, primeiraSecaoPendente } = await server.ssrLoadModule(
    '/src/pages/comercial/custos/secaoDoCaminho.ts'
  ));
});

test.after(async () => {
  await server?.close();
});

test('caminhos reais da validação encontram sua seção', () => {
  const casos = [
    ['title', 'premises'],
    ['assumptions.taxPercent', 'premises'],
    ['laborContexts[0].workCondition', 'labor'],
    ['laborContexts[3].assignments[2].people', 'labor'],
    ['materials[0].unitCost', 'inputs'],
    ['volumeSystems[1].volumeM3', 'inputs'],
    ['circuitServices[0].serviceId', 'inputs'],
    ['circuitServices[2].systemId', 'inputs'],
    ['products[0].dose', 'inputs'],
    ['filters[0].quantity', 'inputs'],
    ['logistics[2].calculationMode', 'logistics'],
    ['logisticsDestinations[0].oneWayDistanceKm', 'logistics'],
    ['commercial.representativeCommission.percent', 'summary']
  ];

  for (const [caminho, esperada] of casos) {
    assert.equal(secaoDoCaminho(caminho), esperada, caminho);
  }
});

test('as confirmações de escopo moram no mesmo objeto e em seções diferentes', () => {
  // É o único caso em que a raiz do caminho não basta.
  assert.equal(secaoDoCaminho('scopeConfirmations.noLabor'), 'labor');
  assert.equal(secaoDoCaminho('scopeConfirmations.noInputs'), 'inputs');
  assert.equal(secaoDoCaminho('scopeConfirmations.noLogistics'), 'logistics');
});

test('caminho desconhecido devolve null em vez de chutar uma seção', () => {
  // Chutar mandaria o usuário para uma seção onde não há nada marcado — pior que
  // não mover, porque parece que a tela mentiu.
  assert.equal(secaoDoCaminho('campoQueNaoExiste'), null);
  assert.equal(secaoDoCaminho(''), null);
  assert.equal(secaoDoCaminho('scopeConfirmations.desconhecida'), null);
});

test('o salto vai para a PRIMEIRA seção na ordem da tela', () => {
  // O servidor valida na ordem do payload, que não é a ordem que o usuário
  // percorre. Mandar para "Resumo" porque a comissão foi validada primeiro faria
  // o usuário voltar.
  const caminhos = [
    'commercial.representativeCommission.percent',
    'logistics[0].calculationMode',
    'laborContexts[0].vehicleType'
  ];
  assert.equal(primeiraSecaoPendente(caminhos), 'labor');
});

test('só pendências desconhecidas não movem a tela', () => {
  assert.equal(primeiraSecaoPendente(['nadaQueEuConheca']), null);
  assert.equal(primeiraSecaoPendente([]), null);
});
