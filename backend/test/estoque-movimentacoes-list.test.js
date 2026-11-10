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
    notes: overrides.notes || null,
    romaneioId: overrides.romaneioId || null,
    reversalOfId: overrides.reversalOfId || null,
    createdAt: new Date(overrides.createdAt || '2026-07-09T12:00:00.000Z'),
    item: { id: overrides.itemId || 'item-1', code: 'PQ-001', name: 'Produto', unitLabel: 'kg' },
    batch: { id: overrides.batchId || 'batch-1', lotNumber: 'L-A', expiryDate: null },
    project: overrides.projectId === null ? null : { id: overrides.projectId || 'project-1', code: 'P-1', name: 'Projeto' },
    createdBy: { id: 'user-1', name: 'Gestor' },
    reversedBy: overrides.reversedBy || null
  };
}

function matchesWhere(row, where) {
  if (typeof where.itemId === 'string' && row.itemId !== where.itemId) return false;
  if (where.itemId?.in && !where.itemId.in.includes(row.itemId)) return false;
  if (where.type && row.type !== where.type) return false;
  if (typeof where.reason === 'string' && row.reason !== where.reason) return false;
  if (where.reason?.not === row.reason) return false;
  if (where.reason?.equals && where.reason.equals !== row.reason) return false;
  if (where.reversalOfId === null && row.reversalOfId) return false;
  if (where.reversedBy?.is === null && row.reversedBy) return false;
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
          return direction * (a.date - b.date || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        })
        .slice(args.skip || 0, args.take === undefined ? undefined : (args.skip || 0) + args.take),
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
  assert.deepEqual(args.orderBy, [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]);
  assert.deepEqual(
    stockMovementListArgs({ dateOrder: 'asc' }).orderBy,
    [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
  );
  assert.deepEqual(
    stockMovementListArgs({ dateOrder: 'invalid' }).orderBy,
    [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
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

test('running balances use all batches and projects before filters or pagination, independently per product', async () => {
  const client = fakeClient([
    movement({ id: 'purchase', type: 'ENTRADA', quantity: 100, date: '2026-07-01', projectId: null }),
    movement({ id: 'project-a', type: 'SAIDA', quantity: 30, reason: 'USO_EM_PROJETO', date: '2026-07-02' }),
    movement({ id: 'project-b', type: 'SAIDA', quantity: 20, reason: 'USO_EM_PROJETO', date: '2026-07-03', projectId: 'project-2' }),
    movement({ id: 'returned', type: 'ENTRADA', quantity: 5, reason: 'DEVOLUCAO_OBRA', date: '2026-07-04' }),
    movement({ id: 'new-batch', type: 'ENTRADA', quantity: 10, date: '2026-07-05', batchId: 'batch-2', projectId: null }),
    movement({ id: 'loss', type: 'SAIDA', quantity: '0.125', reason: 'PERDA', date: '2026-07-06', projectId: null }),
    movement({ id: 'other-item', itemId: 'item-2', quantity: 8, date: '2026-07-07', projectId: null })
  ]);
  const all = await listStockMovements(client, { dateOrder: 'asc' });
  assert.deepEqual(all.movements.map(row => [row.id, row.balanceAfter]), [
    ['purchase', '100.000'], ['project-a', '70.000'], ['project-b', '50.000'],
    ['returned', '55.000'], ['new-batch', '65.000'], ['loss', '64.875'], ['other-item', '8.000']
  ]);
  const filtered = await listStockMovements(client, { itemId: 'item-1', type: 'SAIDA', projectId: 'project-1', reason: 'USO_EM_PROJETO' });
  assert.equal(filtered.movements[0].balanceAfter, '70.000');
  const later = await listStockMovements(client, { itemId: 'item-1', from: '2026-07-03', dateOrder: 'asc', pageSize: 1, page: 2 });
  assert.deepEqual(later.movements.map(row => [row.id, row.balanceAfter]), [['returned', '55.000']]);
  const latest = await listStockMovements(client, { itemId: 'item-1', pageSize: 1 });
  assert.equal(latest.movements[0].balanceAfter, '64.875');
});

test('identical timestamps use the same deterministic order for pagination and running balances', async () => {
  const client = fakeClient([movement({ id: 'b', type: 'SAIDA', quantity: 2 }), movement({ id: 'a', quantity: 7 })]);
  const first = await listStockMovements(client, { dateOrder: 'asc', pageSize: 1 });
  const last = await listStockMovements(client, { pageSize: 1 });
  assert.deepEqual(first.movements.map(row => [row.id, row.balanceAfter]), [['a', '7.000']]);
  assert.deepEqual(last.movements.map(row => [row.id, row.balanceAfter]), [['b', '5.000']]);
});

test('romaneio edits identify legacy replacement rows and balance both simplified and audit history', async () => {
  const reversal = movement({ id: 'reversal', reason: 'ESTORNO', quantity: 420, romaneioId: 'romaneio', reversalOfId: 'old',
    notes: 'Estorno automático por edição do romaneio romaneio.', date: '2026-07-10', createdAt: '2026-07-10T12:00:00Z' });
  const client = fakeClient([
    movement({ id: 'purchase', quantity: 420, projectId: null, date: '2026-07-01' }),
    movement({ id: 'old', type: 'SAIDA', reason: 'USO_EM_PROJETO', quantity: 420, date: '2026-07-02', romaneioId: 'romaneio', reversedBy: reversal }),
    reversal,
    movement({ id: 'replacement', type: 'SAIDA', reason: 'USO_EM_PROJETO', quantity: 385, date: '2026-07-02',
      romaneioId: 'romaneio', notes: 'Movimentação automática do romaneio saída romaneio.', createdAt: '2026-07-10T12:00:00.010Z' })
  ]);
  const simplified = await listStockMovements(client, { includeReversed: false });
  assert.deepEqual(simplified.movements.map(row => [row.id, row.balanceAfter, row.romaneioEdit]), [
    ['replacement', '35.000', true], ['purchase', '420.000', false]
  ]);
  const audit = await listStockMovements(client, {});
  assert.equal(audit.movements[0].id, 'reversal');
  assert.equal(audit.movements[0].balanceAfter, '35.000');
  assert.equal(audit.movements[0].romaneioEdit, true);
  assert.equal(audit.movements.find(row => row.id === 'old').reversedByRomaneioEdit, true);
});

test('manual reversals keep their original identification and affect the running stock balance', async () => {
  const reversal = movement({ id: 'manual-reversal', type: 'SAIDA', reason: 'ESTORNO', quantity: 10, reversalOfId: 'purchase', date: '2026-07-10' });
  const client = fakeClient([movement({ id: 'purchase', quantity: 10, reversedBy: reversal, date: '2026-07-01' }), reversal]);
  const result = await listStockMovements(client, {});
  assert.equal(result.movements[0].balanceAfter, '0.000');
  assert.ok(result.movements.every(row => !row.romaneioEdit && !row.reversedByRomaneioEdit));
});
