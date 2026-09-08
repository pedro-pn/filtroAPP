import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import { listStockMovements, stockMovementListArgs } from '../src/routes/resources/estoque.js';

function movement(overrides = {}) {
  return {
    id: overrides.id || 'movement-1',
    itemId: overrides.itemId || 'item-1',
    batchId: overrides.batchId || 'batch-1',
    projectId: overrides.projectId ?? 'project-1',
    type: overrides.type || 'ENTRADA',
    reason: overrides.reason || 'COMPRA',
    quantity: new Prisma.Decimal(overrides.quantity || 1),
    date: new Date(overrides.date || '2026-07-09T00:00:00.000Z'),
    nfNumber: overrides.nfNumber || null,
    supplier: null,
    unitCost: null,
    requestedBy: null,
    notes: null,
    reversalOfId: null,
    createdAt: new Date(overrides.createdAt || '2026-07-09T12:00:00.000Z'),
    item: { id: overrides.itemId || 'item-1', code: 'PQ-001', name: 'Produto', unitLabel: 'kg' },
    batch: { id: overrides.batchId || 'batch-1', lotNumber: 'L-A', expiryDate: null },
    project: overrides.projectId === null ? null : { id: overrides.projectId || 'project-1', code: 'P-1', name: 'Projeto' },
    createdBy: { id: 'user-1', name: 'Gestor' },
    reversedBy: null
  };
}

function matchesWhere(row, where) {
  if (where.itemId && row.itemId !== where.itemId) return false;
  if (where.type && row.type !== where.type) return false;
  if (where.reason && row.reason !== where.reason) return false;
  if (where.projectId && row.projectId !== where.projectId) return false;
  if (where.date?.gte && row.date < where.date.gte) return false;
  if (where.date?.lte && row.date > where.date.lte) return false;
  return true;
}

function fakeClient(rows) {
  return {
    stockMovement: {
      findMany: async args => rows
        .filter(row => matchesWhere(row, args.where || {}))
        .sort((a, b) => {
          const direction = args.orderBy[0].date === 'asc' ? 1 : -1;
          return direction * (a.date - b.date || a.createdAt - b.createdAt);
        })
        .slice(args.skip, args.skip + args.take),
      count: async args => rows.filter(row => matchesWhere(row, args.where || {})).length
    }
  };
}

test('stock movement list builds filters, caps pagination and sorts results', async () => {
  const args = stockMovementListArgs({
    itemId: 'item-1',
    type: 'SAIDA',
    reason: 'USO_EM_PROJETO',
    projectId: 'project-2',
    from: '2026-07-01',
    to: '2026-07-31',
    page: '1',
    pageSize: '999'
  });

  assert.equal(args.pageSize, 200);
  assert.deepEqual(args.orderBy, [{ date: 'desc' }, { createdAt: 'desc' }]);
  assert.deepEqual(
    stockMovementListArgs({ dateOrder: 'asc' }).orderBy,
    [{ date: 'asc' }, { createdAt: 'asc' }]
  );
  assert.deepEqual(
    stockMovementListArgs({ dateOrder: 'invalid' }).orderBy,
    [{ date: 'desc' }, { createdAt: 'desc' }]
  );
  assert.equal(args.where.itemId, 'item-1');
  assert.equal(args.where.type, 'SAIDA');
  assert.equal(args.where.reason, 'USO_EM_PROJETO');
  assert.equal(args.where.projectId, 'project-2');
  assert.equal(args.where.date.gte instanceof Date, true);
  assert.equal(args.where.date.lte instanceof Date, true);

  const rows = [
    movement({ id: 'old', type: 'SAIDA', reason: 'USO_EM_PROJETO', projectId: 'project-2', date: '2026-07-02T00:00:00.000Z' }),
    movement({ id: 'newer-created', type: 'SAIDA', reason: 'USO_EM_PROJETO', projectId: 'project-2', date: '2026-07-05T00:00:00.000Z', createdAt: '2026-07-05T12:05:00.000Z' }),
    movement({ id: 'newer', type: 'SAIDA', reason: 'USO_EM_PROJETO', projectId: 'project-2', date: '2026-07-05T00:00:00.000Z', createdAt: '2026-07-05T12:00:00.000Z' }),
    movement({ id: 'other-project', type: 'SAIDA', reason: 'USO_EM_PROJETO', projectId: 'project-1', date: '2026-07-06T00:00:00.000Z' }),
    movement({ id: 'purchase', type: 'ENTRADA', reason: 'COMPRA', projectId: null, date: '2026-07-07T00:00:00.000Z' })
  ];

  const result = await listStockMovements(fakeClient(rows), {
    itemId: 'item-1',
    type: 'SAIDA',
    reason: 'USO_EM_PROJETO',
    projectId: 'project-2',
    from: '2026-07-01',
    to: '2026-07-31',
    page: 1,
    pageSize: 2
  });

  assert.equal(result.total, 3);
  assert.equal(result.pageSize, 2);
  assert.deepEqual(result.movements.map(row => row.id), ['newer-created', 'newer']);

  const ascending = await listStockMovements(fakeClient(rows), {
    itemId: 'item-1',
    type: 'SAIDA',
    reason: 'USO_EM_PROJETO',
    projectId: 'project-2',
    dateOrder: 'asc',
    page: 1,
    pageSize: 3
  });
  assert.deepEqual(ascending.movements.map(row => row.id), ['old', 'newer', 'newer-created']);
});
