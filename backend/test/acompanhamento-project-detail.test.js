import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSalaryCategory } from '../src/lib/acompanhamento-project-detail.js';

test('isSalaryCategory: reconhece categorias de folha/mão de obra (acentos e caixa)', () => {
  assert.equal(isSalaryCategory('Salários e ordenados'), true);
  assert.equal(isSalaryCategory('FOLHA DE PAGAMENTO'), true);
  assert.equal(isSalaryCategory('Pró-labore'), true);
  assert.equal(isSalaryCategory('INSS a recolher'), true);
  assert.equal(isSalaryCategory('FGTS'), true);
  assert.equal(isSalaryCategory('Férias'), true);
  assert.equal(isSalaryCategory('Rescisão contratual'), true);
  assert.equal(isSalaryCategory('Vale transporte'), true);
});

test('isSalaryCategory: não marca custos de obra/material', () => {
  assert.equal(isSalaryCategory('Material de consumo'), false);
  assert.equal(isSalaryCategory('Hospedagem'), false);
  assert.equal(isSalaryCategory('Locação de equipamento'), false);
  assert.equal(isSalaryCategory('Combustível'), false);
  assert.equal(isSalaryCategory(null), false);
  assert.equal(isSalaryCategory(''), false);
});
