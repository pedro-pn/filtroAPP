import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import { buildStockSummary } from '../src/routes/resources/estoque.js';

function fakeClient({ items, movements }) {
  return {
    stockItem: {
      findMany: async () => items
    },
    stockMovement: {
      groupBy: async ({ by, where = {} }) => {
        const keyField = by.includes('batchId') ? 'batchId' : 'itemId';
        const grouped = new Map();
        for (const movement of movements) {
          if (where.itemId?.in && !where.itemId.in.includes(movement.itemId)) continue;
          if (where.itemId && typeof where.itemId === 'string' && movement.itemId !== where.itemId) continue;
          const key = `${movement[keyField]}:${movement.type}`;
          const current = grouped.get(key) || {
            [keyField]: movement[keyField],
            type: movement.type,
            _sum: { quantity: new Prisma.Decimal(0) }
          };
          current._sum.quantity = current._sum.quantity.plus(movement.quantity);
          grouped.set(key, current);
        }
        return Array.from(grouped.values());
      }
    }
  };
}

test('stock summary includes every registered item and aggregates balances and alert flags', async () => {
  const now = new Date('2026-07-09T12:00:00.000Z');
  const client = fakeClient({
    items: [
      {
        id: 'active-chemical',
        code: 'PQ-001',
        name: 'Produto',
        type: 'PRODUTO_QUIMICO',
        unitLabel: 'kg',
        minQuantity: new Prisma.Decimal(10),
        category: { id: 'category-1', name: 'Químicos' },
        manufacturer: 'Fabricante A',
        location: 'Galpão 1',
        isActive: true,
        batches: [
          {
            id: 'batch-expiring',
            lotNumber: 'L-1',
            expiryDate: new Date('2026-07-20T00:00:00.000Z'),
            nfNumber: '123',
            supplier: 'Fornecedor',
            createdAt: new Date('2026-07-01T12:00:00.000Z')
          },
          {
            id: 'batch-zero',
            lotNumber: 'L-0',
            expiryDate: null,
            nfNumber: null,
            supplier: null,
            createdAt: new Date('2026-07-02T12:00:00.000Z')
          }
        ]
      },
      {
        id: 'inactive-with-balance',
        code: 'FL-001',
        name: 'Filtro',
        type: 'FILTRO',
        unitLabel: 'un',
        minQuantity: null,
        isActive: false,
        batches: [
          {
            id: 'batch-filter',
            lotNumber: '',
            expiryDate: null,
            nfNumber: '456',
            supplier: null,
            createdAt: new Date('2026-07-03T12:00:00.000Z')
          }
        ]
      },
      {
        id: 'inactive-zero',
        code: 'FL-000',
        name: 'Filtro zerado',
        type: 'FILTRO',
        unitLabel: 'un',
        minQuantity: null,
        isActive: false,
        batches: []
      }
    ],
    movements: [
      { itemId: 'active-chemical', batchId: 'batch-expiring', type: 'ENTRADA', quantity: new Prisma.Decimal(8) },
      { itemId: 'active-chemical', batchId: 'batch-zero', type: 'ENTRADA', quantity: new Prisma.Decimal(2) },
      { itemId: 'active-chemical', batchId: 'batch-zero', type: 'SAIDA', quantity: new Prisma.Decimal(2) },
      { itemId: 'inactive-with-balance', batchId: 'batch-filter', type: 'ENTRADA', quantity: new Prisma.Decimal(3) }
    ]
  });

  const summary = await buildStockSummary(client, now);

  assert.equal(summary.length, 3);
  assert.equal(summary[0].balance, '8.000');
  assert.equal(summary[0].item.category.name, 'Químicos');
  assert.equal(summary[0].item.manufacturer, 'Fabricante A');
  assert.equal(summary[0].item.location, 'Galpão 1');
  assert.equal(summary[0].belowMin, true);
  assert.equal(summary[0].batches.length, 1);
  assert.equal(summary[0].batches[0].expiringSoon, true);
  assert.equal(summary[0].batches[0].expired, false);
  assert.equal(summary[1].item.id, 'inactive-with-balance');
  assert.equal(summary[1].balance, '3.000');
  assert.equal(summary[2].item.id, 'inactive-zero');
  assert.equal(summary[2].balance, '0.000');
  assert.deepEqual(summary[2].batches, []);
});
