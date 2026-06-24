import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeMonthlyCost } from '../src/lib/acompanhamento-cost-engine.js';

const OPERADOR_PARAMS = {
  salarioBase: 3080.33,
  salarioMinimo: 1621,
  cargaHoraria: 220,
  diasUteis: 22,
  insalubridade: 324.2,
  periculosidadePct: 0.3,
  produtividadePct: 0.15,
  transferenciaPct: 0.3,
  he70Pct: 0.7,
  he100Pct: 1,
  fgtsPct: 0.08,
  inssPatronalPct: 0.1,
  multaPct: 0.4,
  beneficios: { planoSaude: 800, valeAlimentacao: 600, odonto: 16, seguroVida: 50, cursos: 300 }
};

const OPERADOR_INPUTS = { diasCliente: 22, diasFora: 1, diasCasa: 22, he70Horas: 1, he100Horas: 1 };

test('motor reproduz as verbas do Simulador (operador) da planilha', () => {
  const r = computeMonthlyCost(OPERADOR_PARAMS, OPERADOR_INPUTS);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `esperado ~${b}, obtido ${a}`);
  close(r.periculosidade, 677.6726);
  close(r.produtividade, 476.14919);
  close(r.transferencia, 34.0453);
  close(r.valorHora, 20.874532);
  close(r.he70, 35.486705);
  close(r.he100, 41.749064);
  close(r.dsr, 14.042867);
  close(r.remuneracaoBruta, 4683.675726);
  close(r.encargos, 843.061631);
  close(r.provisoes, 1074.643375);
  close(r.beneficios, 1766);
  close(r.passivoRescisorio, 687.3506);
  close(r.totalMensal, 9054.731333);
  close(r.custoHora220, 41.15787);
});

test('zerar inputs deixa só fixos + encargos + provisões + benefícios + passivo', () => {
  const r = computeMonthlyCost(OPERADOR_PARAMS, { diasCliente: 0, diasFora: 0, diasCasa: 0, he70Horas: 0, he100Horas: 0 });
  // bruta = base + insalub = 3404.53
  assert.ok(Math.abs(r.remuneracaoBruta - 3404.53) < 0.01);
  assert.ok(r.totalMensal > r.remuneracaoBruta);
});

test('auxiliar usa gratificação 5% e viagem 10% no mesmo motor', () => {
  const aux = { ...OPERADOR_PARAMS, salarioBase: 2290.47, produtividadePct: 0.05, transferenciaPct: 0.1 };
  const r = computeMonthlyCost(aux, OPERADOR_INPUTS);
  assert.ok(r.totalMensal > 0);
  // produtividade do auxiliar é menor que a do operador (5% vs 15%)
  const op = computeMonthlyCost(OPERADOR_PARAMS, OPERADOR_INPUTS);
  assert.ok(r.produtividade < op.produtividade);
});
