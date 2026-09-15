import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createServer } from 'vite';

let server;
let unidades;
let motor;

test.before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom'
  });
  unidades = await server.ssrLoadModule(
    '/src/pages/comercial/custos/unidadesDeTubo.ts'
  );
  motor = await server.ssrLoadModule('/../shared/comercial/dist/cost-model.js');
});

test.after(async () => {
  await server?.close();
});

test('comprimento aceita metros, centímetros e milímetros sem mudar o valor canônico', () => {
  assert.equal(unidades.comprimentoParaExibicao(2.35, 'm'), 2.35);
  assert.equal(unidades.comprimentoParaExibicao(2.35, 'cm'), 235);
  assert.equal(unidades.comprimentoParaExibicao(2.35, 'mm'), 2350);
  assert.equal(unidades.comprimentoEmMetros(235, 'cm'), 2.35);
  assert.equal(unidades.comprimentoEmMetros(2350, 'mm'), 2.35);
});

test('diâmetro converte polegada para o milímetro usado pelo cálculo', () => {
  assert.equal(unidades.diametroEmMilimetros(1, 'in'), 25.4);
  assert.equal(unidades.diametroParaExibicao(25.4, 'in'), 1);
  assert.equal(unidades.diametroEmMilimetros(100, 'mm'), 100);
});

test('as unidades escolhidas sobrevivem à normalização do rascunho no servidor', () => {
  const draft = motor.createDefaultCostEstimatePayload();
  draft.volumeSystems[0].pipeSegments = [
    {
      id: 'tubo-1',
      description: 'Sistema de lavagem',
      quantity: 1,
      lengthM: 2.35,
      lengthUnit: 'cm',
      internalDiameterMm: 25.4,
      diameterUnit: 'mm',
      fillPercent: 100
    }
  ];

  const normalizado = motor.normalizeCostEstimatePayload(draft);
  const trecho = normalizado.volumeSystems[0].pipeSegments[0];

  assert.equal(trecho.lengthUnit, 'cm');
  assert.equal(trecho.diameterUnit, 'mm');
});

test('trecho de tubo mostra nome do sistema e seletores com polegada como padrão', () => {
  const fonte = readFileSync(
    new URL(
      '../src/pages/comercial/custos/sections/CircuitosBloco.tsx',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(fonte, /Nome do sistema/);
  assert.match(fonte, /lengthUnit: 'm'/);
  assert.match(fonte, /diameterUnit: 'in'/);
  assert.match(fonte, /<option value="cm">cm<\/option>/);
  assert.match(fonte, /<option value="mm">mm<\/option>/);
  assert.match(fonte, /<option value="in">pol\.<\/option>/);
});
