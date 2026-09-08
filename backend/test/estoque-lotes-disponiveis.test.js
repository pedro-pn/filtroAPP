import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import { getAvailableStockBatchRows } from '../src/lib/estoque/stock-batches.js';

function batch(id, lotNumber, createdAt) {
  return {
    id,
    itemId: 'item-1',
    lotNumber,
    expiryDate: null,
    createdAt: new Date(createdAt)
  };
}

function movement({ batchId, type, quantity, projectId = null }) {
  return {
    itemId: 'item-1',
    batchId,
    type,
    quantity: new Prisma.Decimal(quantity),
    projectId
  };
}

function fakeClient({ batches, movements }) {
  return {
    stockBatch: {
      findMany: async ({ where }) => batches.filter(item => item.itemId === where.itemId)
    },
    stockMovement: {
      groupBy: async ({ by, where = {} }) => {
        const keyField = by.includes('batchId') ? 'batchId' : 'itemId';
        const grouped = new Map();
        for (const row of movements) {
          if (where.itemId && row.itemId !== where.itemId) continue;
          if (where.projectId && row.projectId !== where.projectId) continue;
          const key = `${row[keyField]}:${row.type}`;
          const current = grouped.get(key) || {
            [keyField]: row[keyField],
            type: row.type,
            _sum: { quantity: new Prisma.Decimal(0) }
          };
          current._sum.quantity = current._sum.quantity.plus(row.quantity);
          grouped.set(key, current);
        }
        return Array.from(grouped.values());
      }
    }
  };
}

test('devolução lista lotes com saldo na obra mesmo quando o saldo no estoque está zerado', async () => {
  const client = fakeClient({
    batches: [
      batch('batch-zero-stock', 'L-ZERO', '2026-07-01T12:00:00.000Z'),
      batch('batch-partial', 'L-PARCIAL', '2026-07-02T12:00:00.000Z'),
      batch('batch-other-project', 'L-OUTRA-OBRA', '2026-07-03T12:00:00.000Z'),
      batch('batch-returned', 'L-DEVOLVIDO', '2026-07-04T12:00:00.000Z')
    ],
    movements: [
      movement({ batchId: 'batch-zero-stock', type: 'ENTRADA', quantity: 5 }),
      movement({ batchId: 'batch-zero-stock', type: 'SAIDA', quantity: 5, projectId: 'project-1' }),
      movement({ batchId: 'batch-partial', type: 'ENTRADA', quantity: 10 }),
      movement({ batchId: 'batch-partial', type: 'SAIDA', quantity: 2, projectId: 'project-1' }),
      movement({ batchId: 'batch-other-project', type: 'ENTRADA', quantity: 4 }),
      movement({ batchId: 'batch-other-project', type: 'SAIDA', quantity: 4, projectId: 'project-2' }),
      movement({ batchId: 'batch-returned', type: 'ENTRADA', quantity: 3 }),
      movement({ batchId: 'batch-returned', type: 'SAIDA', quantity: 3, projectId: 'project-1' }),
      movement({ batchId: 'batch-returned', type: 'ENTRADA', quantity: 3, projectId: 'project-1' })
    ]
  });

  const returnBatches = await getAvailableStockBatchRows(client, {
    itemId: 'item-1',
    reason: 'DEVOLUCAO_OBRA',
    projectId: 'project-1'
  });

  assert.deepEqual(
    returnBatches.map(item => [item.batch.id, item.balance.toFixed(3)]),
    [
      ['batch-zero-stock', '5.000'],
      ['batch-partial', '2.000']
    ]
  );

  const stockBatches = await getAvailableStockBatchRows(client, { itemId: 'item-1' });
  assert.deepEqual(
    stockBatches.map(item => [item.batch.id, item.balance.toFixed(3)]),
    [
      ['batch-partial', '8.000'],
      ['batch-returned', '3.000']
    ]
  );
});
