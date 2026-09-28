import assert from 'node:assert/strict';
import test from 'node:test';
import { percentageForProjectValue, percentageOfProjectTotal } from '../src/utils/trackingDivisionPercentage.ts';

test('percentual calcula valores previstos a partir do total do projeto', () => {
  assert.equal(percentageOfProjectTotal(12000, '12.5', 'plannedCost'), 1500);
  assert.equal(percentageOfProjectTotal(123.45, '33.33', 'plannedRevenue'), 41.15);
  assert.equal(percentageOfProjectTotal(37, '50', 'plannedDays'), 19);
  assert.equal(percentageOfProjectTotal(42, '25', 'plannedHours'), 10.5);
});

test('percentual vazio não preenche meta e exige um total positivo', () => {
  assert.equal(percentageOfProjectTotal(100, '', 'plannedCost'), null);
  assert.equal(percentageOfProjectTotal(null, '25', 'plannedCost'), null);
  assert.equal(percentageOfProjectTotal(0, '25', 'plannedCost'), null);
  assert.equal(percentageOfProjectTotal(100, '101', 'plannedCost'), null);
  assert.equal(percentageForProjectValue('25', 100), '25');
});
