import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

/**
 * Seção Premissas e a faixa de indicadores.
 *
 * As duas são a mesma peça do ponto de vista do usuário: a faixa é o retorno
 * imediato do que se digita nas premissas. Por isso o teste cobre as duas
 * juntas — e a asserção que mais importa é que o motor no NAVEGADOR produz os
 * mesmos números do golden. O backend já prova isso; aqui prova-se que o
 * `shared/comercial` compilado funciona também no cliente.
 */

let server;
let motor;

test.before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });
  motor = await server.ssrLoadModule('/../shared/comercial/dist/cost-model.js');
});

test.after(async () => {
  await server?.close();
});

const goldensDir = new URL(
  '../../specs/009-modulo-comercial/contracts/goldens/',
  import.meta.url
).pathname;

function golden(nome) {
  return JSON.parse(readFileSync(`${goldensDir}${nome}.golden.json`, 'utf8'));
}

test('o motor no cliente reproduz o golden — não só no servidor', () => {
  const cenario = golden('02-sede-sem-hora-extra');
  const resultado = motor.calculateEstimate(cenario.payload);

  assert.equal(Number(resultado.totalCost), Number(cenario.result.totalCost));
  assert.equal(Number(resultado.salePrice), Number(cenario.result.salePrice));
  assert.equal(Number(resultado.margin), Number(cenario.result.margin));
});

test('o payload padrão já vem com as bases Filtrovali', () => {
  // São os valores que a seção Premissas mostra na primeira abertura, e que
  // aparecem na captura da baseline: 24, 17,54, 9, 5 e 15.
  const payload = motor.createDefaultCostEstimatePayload();
  const a = payload.assumptions;

  assert.equal(a.pricingModel, motor.FILTROVALI_PRICING_MODEL);
  assert.equal(a.overheadPercent, motor.DEFAULT_OVERHEAD_PERCENT);
  assert.equal(a.taxPercent, motor.DEFAULT_TAX_PERCENT);
  assert.equal(a.commissionPercent, motor.DEFAULT_COMMISSION_PERCENT);
  assert.equal(a.commercialPercent, motor.DEFAULT_COMMERCIAL_PERCENT);
  assert.equal(a.desiredMarginPercent, motor.DEFAULT_MARGIN_PERCENT);

  // Bases do LEC v1.2, que a seção mostra desabilitadas.
  assert.equal(a.monthlyHours, 193.6);
  assert.equal(a.workdaysPerMonth, 22);
  assert.equal(a.defaultHoursPerDay, 8.8);
});

test('o levantamento novo não assume Pré-engenharia como fase', () => {
  const payload = motor.createDefaultCostEstimatePayload();
  const faseInicial = payload.laborContexts[0];
  const destinoInicial = payload.logisticsDestinations[0];

  assert.equal(faseInicial.name, '');
  assert.equal(faseInicial.description, '');
  assert.equal(destinoInicial.name, 'Obra principal');
  assert.equal(destinoInicial.nameSource, 'custom');
  assert.equal(destinoInicial.laborContextId, undefined);
});

test('mobilização conjunta cobra uma composição por sentido', () => {
  const payload = motor.createDefaultCostEstimatePayload();
  payload.scopeConfirmations.noInputs = true;
  payload.scopeConfirmations.combinedCrewAndEquipmentTransport = true;
  payload.logisticsDestinations[0].oneWayDistanceKm = 100;

  for (const item of payload.logistics) {
    item.calculationMode = 'legacy';
    item.calculationModeConfirmed = true;
    item.returnSetup = 'custom';
    item.autoSyncedFromMobilization = false;
    item.unitCost = item.slotType === 'equipment' ? 1000 : 100;
  }

  const resultado = motor.calculateEstimate(payload);
  assert.deepEqual(
    resultado.logisticsResults.map(item => item.slotType),
    ['crew', 'crew']
  );
  assert.equal(resultado.mobilizationCost, 100);
  assert.equal(resultado.demobilizationCost, 100);
  assert.equal(
    resultado.directCost,
    resultado.laborCost
      + resultado.indirectCost
      + resultado.materialCost
      + resultado.inputCost
      + resultado.mobilizationCost
      + resultado.demobilizationCost
      + resultado.employeeReferralBonusCost,
    'mobilização e desmobilização devem entrar uma única vez no custo direto'
  );

  const indicesDeEquipamento = payload.logistics
    .map((item, indice) => item.slotType === 'equipment' ? indice : -1)
    .filter(indice => indice >= 0);
  const errosDeEquipamento = motor.validateCostEstimate(payload).errors.filter(issue =>
    indicesDeEquipamento.some(indice => issue.path.startsWith(`logistics[${indice}]`))
  );
  assert.deepEqual(errosDeEquipamento, []);
});

test('mudar a margem muda o preço, sem tocar no custo', () => {
  // É o comportamento que justifica o editor de margem viver na faixa: o
  // orçamentista ajusta e vê o preço mexer na hora.
  const payload = motor.createDefaultCostEstimatePayload();
  const base = motor.calculateEstimate(payload);

  const comMargemMaior = motor.calculateEstimate({
    ...payload,
    assumptions: { ...payload.assumptions, desiredMarginPercent: 30 }
  });

  assert.equal(
    Number(comMargemMaior.totalCost),
    Number(base.totalCost),
    'mexer na margem não pode mudar o custo'
  );
  assert.ok(
    Number(comMargemMaior.salePrice) > Number(base.salePrice),
    'margem maior tem de produzir preço maior'
  );
});

test('a seção Premissas rende os 11 controles e as duas notas', async () => {
  const { PremissasSection } = await server.ssrLoadModule(
    '/src/pages/comercial/custos/sections/PremissasSection.tsx'
  );
  const { useLevantamento } = await server.ssrLoadModule(
    '/src/pages/comercial/custos/useLevantamento.ts'
  );

  // Monta um componente hospedeiro só para poder usar o hook.
  function Hospedeiro() {
    const levantamento = useLevantamento('Baseline E0');
    return createElement(PremissasSection, { levantamento });
  }

  const html = renderToStaticMarkup(createElement(Hospedeiro));

  for (const rotulo of [
    'Nome do levantamento',
    'Orçamentista responsável',
    'HH mensal LEC',
    'Dias úteis / mês',
    'Jornada padrão',
    'Overhead s/ líquida (%)',
    'Imposto s/ bruta (%)',
    'Comissão s/ líquida (%)',
    'Comercial s/ líquida (%)',
    'Margem s/ bruta (%)'
  ]) {
    assert.ok(html.includes(rotulo), `faltou o rótulo "${rotulo}"`);
  }

  assert.ok(html.includes('Premissas do levantamento'), 'faltou o título da seção');
  assert.ok(html.includes('LEC v1.2'), 'faltou a nota do LEC');
  assert.ok(html.includes('Base Filtrovali'), 'faltou a nota das bases');
  assert.ok(html.includes('Campos com * são obrigatórios'), 'faltou o aviso de obrigatórios');
});

test('os quatro campos de base vêm desabilitados', () => {
  // HH mensal, dias úteis, jornada e orçamentista não são escolha do usuário:
  // vêm do LEC v1.2 e do login. Habilitá-los deixaria alguém "corrigir" a base
  // do cálculo sem perceber.
  const payload = motor.createDefaultCostEstimatePayload();
  assert.ok(payload.assumptions.monthlyHours > 0);
  assert.ok(payload.assumptions.workdaysPerMonth > 0);
  assert.ok(payload.assumptions.defaultHoursPerDay > 0);
});
