import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeMonthlyCost } from '../src/lib/acompanhamento/cost-engine.js';

const BASE_PARAMS = {
  salarioMinimo: 1621,
  cargaHoraria: 220,
  diasUteis: 22,
  periculosidadePct: 0.3,
  he70Pct: 0.7,
  he100Pct: 1,
  fgtsPct: 0.08,
  multaPct: 0.5,
  beneficios: {
    seguroVida: 50,
    valeAlimentacao: 600,
    planoSaude: 500,
    odonto: 18,
    cursos: 300,
    moradia: 1000
  }
};

const HOME_INPUTS = { diasCasa: 22, diasFora: 0, offshoreDays: 0, he70Horas: 0, he100Horas: 0 };

const close = (actual, expected, eps = 0.01) => {
  assert.ok(Math.abs(actual - expected) < eps, `esperado ~${expected}, obtido ${actual}`);
};

const SHEET_ROWS = [
  {
    name: 'Coordenador',
    params: { salarioBase: 5392.37, produtividadePct: 0.15, transferenciaPct: 0.3, confinamentoPct: 0.4 },
    expectedTotal: 13777.913024444439,
    expectedPericulosidade: 1155.5078571428571,
    expectedProdutividade: 1030.8116785714285
  },
  {
    name: 'Supervisor',
    params: { salarioBase: 4981.72, produtividadePct: 0.15, transferenciaPct: 0.3, confinamentoPct: 0.4 },
    expectedTotal: 12957.251813333332,
    expectedPericulosidade: 1067.5114285714287,
    expectedProdutividade: 956.0147142857143
  },
  {
    name: 'Encarregado',
    params: { salarioBase: 4693.03, produtividadePct: 0.15, transferenciaPct: 0.3, confinamentoPct: 0.4 },
    expectedTotal: 12380.320886666666,
    expectedPericulosidade: 1005.6492857142856,
    expectedProdutividade: 903.4318928571428
  },
  {
    name: 'Operador',
    params: { salarioBase: 4086.57, produtividadePct: 0.15, transferenciaPct: 0.3, confinamentoPct: 0.4 },
    expectedTotal: 11168.344268888888,
    expectedPericulosidade: 875.6935714285714,
    expectedProdutividade: 792.9695357142858
  },
  {
    name: 'Auxiliares',
    params: { salarioBase: 2395.37, produtividadePct: 0.05, transferenciaPct: 0.1, confinamentoPct: 0.2 },
    expectedTotal: 7325.9163266666665,
    expectedPericulosidade: 513.2935714285715,
    expectedProdutividade: 161.64317857142856
  }
];

test('motor reproduz os totais da aba Calculo Colaboradores em Itajai', () => {
  for (const row of SHEET_ROWS) {
    const result = computeMonthlyCost({ ...BASE_PARAMS, ...row.params }, HOME_INPUTS);
    close(result.insalubridade, 324.2);
    close(result.periculosidade, row.expectedPericulosidade);
    close(result.produtividade, row.expectedProdutividade);
    close(result.transferencia, 0);
    close(result.confinamento, 0);
    close(result.beneficios, 2468);
    close(result.totalMensal, row.expectedTotal);
  }
});

test('cargos da planilha usam a mesma estrutura com percentuais por modelo', () => {
  const operadorLike = SHEET_ROWS.slice(0, 4).map(row => row.params);
  for (const params of operadorLike) {
    assert.equal(params.produtividadePct, 0.15);
    assert.equal(params.transferenciaPct, 0.3);
    assert.equal(params.confinamentoPct, 0.4);
  }
  assert.equal(SHEET_ROWS[4].params.produtividadePct, 0.05);
  assert.equal(SHEET_ROWS[4].params.transferenciaPct, 0.1);
  assert.equal(SHEET_ROWS[4].params.confinamentoPct, 0.2);
});

test('zerar modalidades deixa fixos + encargos + provisoes + beneficios', () => {
  const result = computeMonthlyCost({ ...BASE_PARAMS, ...SHEET_ROWS[3].params }, {});
  close(result.remuneracaoBruta, 4086.57 + 324.2);
  assert.equal(result.periculosidade, 0);
  assert.equal(result.produtividade, 0);
  assert.equal(result.transferencia, 0);
  assert.equal(result.confinamento, 0);
  assert.ok(result.totalMensal > result.remuneracaoBruta);
});

test('motor ignora INSS patronal e INSS de provisoes', () => {
  const current = computeMonthlyCost({ ...BASE_PARAMS, ...SHEET_ROWS[3].params }, HOME_INPUTS);
  const withLegacyInss = computeMonthlyCost({
    ...BASE_PARAMS,
    ...SHEET_ROWS[3].params,
    inssPatronalPct: 0.99,
    inssProvisoesPct: 0.99
  }, HOME_INPUTS);

  assert.equal(withLegacyInss.inssPatronal, 0);
  assert.equal(withLegacyInss.inssProvisoes, 0);
  assert.equal(withLegacyInss.totalMensal, current.totalMensal);
});

test('motor aplica 50% de multa FGTS quando parametro antigo nao veio migrado', () => {
  const withParam = computeMonthlyCost({ ...BASE_PARAMS, ...SHEET_ROWS[3].params }, HOME_INPUTS);
  const withoutParam = computeMonthlyCost({ ...BASE_PARAMS, ...SHEET_ROWS[3].params, multaPct: undefined }, HOME_INPUTS);

  assert.equal(withoutParam.multaFgts, withParam.multaFgts);
  assert.equal(withoutParam.totalMensal, withParam.totalMensal);
});

test('modalidades viagem e offshore usam transferencia/confinamento da planilha', () => {
  const operador = { ...BASE_PARAMS, ...SHEET_ROWS[3].params };
  const operadorViagem = computeMonthlyCost(operador, { ...HOME_INPUTS, diasCasa: 0, diasFora: 22 });
  const operadorOffshore = computeMonthlyCost(operador, { ...HOME_INPUTS, diasCasa: 0, offshoreDays: 22 });
  close(operadorViagem.transferencia, (4086.57 + 324.2) * 0.3);
  assert.equal(operadorViagem.produtividade, 0);
  close(operadorOffshore.confinamento, (4086.57 + 324.2) * 0.4);
  assert.ok(operadorOffshore.totalMensal > operadorViagem.totalMensal);

  const auxiliar = { ...BASE_PARAMS, ...SHEET_ROWS[4].params };
  const auxViagem = computeMonthlyCost(auxiliar, { ...HOME_INPUTS, diasCasa: 0, diasFora: 22 });
  const auxOffshore = computeMonthlyCost(auxiliar, { ...HOME_INPUTS, diasCasa: 0, offshoreDays: 22 });
  close(auxViagem.transferencia, (2395.37 + 324.2) * 0.1);
  assert.equal(auxViagem.produtividade, 0);
  close(auxOffshore.confinamento, (2395.37 + 324.2) * 0.2);
  assert.ok(auxOffshore.totalMensal > auxViagem.totalMensal);
});
