import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { purchaseStatusTotals } from '../src/lib/acompanhamento/purchase-status-totals.js';

const row = (projectId, statusTitulo, valor) => ({ projectId, statusTitulo,
  _sum: { valor: valor === null ? null : new Prisma.Decimal(valor) } });

test('status totals preserve cents, negative amounts, paid-only keys and SQL all-null sums', () => {
  const result = purchaseStatusTotals([
    row('p', 'PAGO', '.30'), row('p', 'ABERTO', '.10'), row('p', null, '-.05'),
    row('empty', null, null), row('paid-null', 'PAGO', null), row('zero', 'ABERTO', '0')
  ]);
  assert.equal(result.totalByProject.get('p').toFixed(2), '0.35');
  assert.equal(result.paidByProject.get('p').toFixed(2), '0.30');
  assert.equal(result.totalByProject.get('empty'), null);
  assert.equal(result.paidByProject.has('empty'), false);
  assert.equal(result.paidByProject.has('paid-null'), true);
  assert.equal(result.paidByProject.get('paid-null'), null);
  assert.equal(result.totalByProject.get('zero').toFixed(2), '0.00');
});

test('regrouping remains exact beyond Decimal arithmetic precision and handles SQL numeric NaN', () => {
  const values = [row('large', 'PAGO', '1234567890123456789012345678.90'), row('large', 'ABERTO', '.12'),
    row('negative', null, '-.03'), row('nan', 'ABERTO', 'NaN')];
  for (const input of [values, [...values].reverse()]) {
    const result = purchaseStatusTotals(input);
    assert.equal(result.totalByProject.get('large').toFixed(2), '1234567890123456789012345679.02');
    assert.equal(result.totalByProject.get('negative').toFixed(2), '-0.03');
    assert.equal(result.totalByProject.get('nan').isNaN(), true);
  }
  assert.deepEqual(purchaseStatusTotals([]), { totalByProject: new Map(), paidByProject: new Map() });
});
