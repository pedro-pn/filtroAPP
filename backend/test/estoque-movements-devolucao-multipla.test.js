import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import { createReturnMovements } from '../src/lib/estoque/stock-movements.js';

const project = { id: 'project-1', code: 'OBRA-1', name: 'Obra 1' };
const items = [
  {
    id: 'item-chemical',
    type: 'PRODUTO_QUIMICO',
    code: 'PQ-001',
    name: 'Produto químico',
    unitLabel: 'kg',
    isActive: true
  },
  {
    id: 'item-filter',
    type: 'FILTRO',
    code: 'FL-001',
    name: 'Filtro',
    unitLabel: 'un',
    isActive: true
  }
];
const batches = [
  {
    id: 'batch-chemical',
    itemId: 'item-chemical',
    lotNumber: 'LOTE-Q',
    expiryDate: new Date('2027-03-31T00:00:00.000Z'),
    createdAt: new Date('2026-08-01T12:00:00.000Z')
  },
  {
    id: 'batch-filter',
    itemId: 'item-filter',
    lotNumber: 'LOTE-F',
    expiryDate: new Date('2028-06-30T00:00:00.000Z'),
    createdAt: new Date('2026-08-02T12:00:00.000Z')
  }
];

function movement({ id, itemId, batchId, type, quantity, projectId = null }) {
  return {
    id,
    itemId,
    batchId,
    type,
    reason: type === 'ENTRADA' ? 'COMPRA' : 'USO_EM_PROJETO',
    quantity: new Prisma.Decimal(quantity),
    date: new Date('2026-08-10T00:00:00.000Z'),
    projectId,
    createdById: 'user-1',
    createdAt: new Date('2026-08-10T12:00:00.000Z')
  };
}

function fakeClient() {
  const state = {
    movements: [
      movement({ id: 'entry-chemical', itemId: 'item-chemical', batchId: 'batch-chemical', type: 'ENTRADA', quantity: 10 }),
      movement({ id: 'exit-chemical', itemId: 'item-chemical', batchId: 'batch-chemical', type: 'SAIDA', quantity: 4, projectId: project.id }),
      movement({ id: 'entry-filter', itemId: 'item-filter', batchId: 'batch-filter', type: 'ENTRADA', quantity: 5 }),
      movement({ id: 'exit-filter', itemId: 'item-filter', batchId: 'batch-filter', type: 'SAIDA', quantity: 2, projectId: project.id })
    ]
  };
  let movementSeq = state.movements.length;

  function groupBy({ by, where = {} }) {
    const keyField = by.includes('batchId') ? 'batchId' : 'itemId';
    const grouped = new Map();
    for (const row of state.movements) {
      if (where.itemId?.in && !where.itemId.in.includes(row.itemId)) continue;
      if (typeof where.itemId === 'string' && row.itemId !== where.itemId) continue;
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

  const tx = {
    $queryRaw: async () => null,
    stockItem: {
      findUnique: async ({ where }) => items.find(item => item.id === where.id) || null
    },
    stockBatch: {
      findUnique: async ({ where }) => batches.find(batch => batch.id === where.id) || null
    },
    project: {
      findFirst: async ({ where }) => where.id === project.id ? project : null
    },
    stockMovement: {
      groupBy: async args => groupBy(args),
      create: async ({ data }) => {
        movementSeq += 1;
        const created = {
          id: `return-${movementSeq}`,
          ...data,
          quantity: new Prisma.Decimal(data.quantity),
          createdAt: new Date('2026-08-31T12:00:00.000Z')
        };
        state.movements.push(created);
        return {
          ...created,
          item: items.find(item => item.id === created.itemId),
          batch: batches.find(batch => batch.id === created.batchId),
          project,
          createdBy: { id: data.createdById, name: 'Gestor Estoque' },
          reversedBy: null
        };
      }
    }
  };

  return {
    state,
    async $transaction(callback) {
      const movementCount = state.movements.length;
      try {
        return await callback(tx);
      } catch (error) {
        state.movements.splice(movementCount);
        throw error;
      }
    }
  };
}

function payload(overrides = {}) {
  return {
    reason: 'DEVOLUCAO_OBRA',
    projectId: project.id,
    date: '2026-08-31',
    notes: 'Retorno conjunto da equipe',
    items: [
      { itemId: 'item-chemical', batchId: 'batch-chemical', quantity: 2.5 },
      { itemId: 'item-filter', batchId: 'batch-filter', quantity: 1 }
    ],
    ...overrides
  };
}

test('devolução múltipla cria uma movimentação por produto preservando lote e validade', async () => {
  const client = fakeClient();
  const results = await createReturnMovements(client, {
    createdById: 'manager-1',
    data: payload()
  });

  assert.equal(results.length, 2);
  assert.deepEqual(results.map(result => result.movement.itemId), ['item-chemical', 'item-filter']);
  assert.deepEqual(results.map(result => result.movement.batchId), ['batch-chemical', 'batch-filter']);
  assert.deepEqual(
    results.map(result => result.movement.batch.expiryDate.toISOString().slice(0, 10)),
    ['2027-03-31', '2028-06-30']
  );
  assert.ok(results.every(result => result.movement.type === 'ENTRADA'));
  assert.ok(results.every(result => result.movement.reason === 'DEVOLUCAO_OBRA'));
  assert.ok(results.every(result => result.movement.projectId === project.id));
  assert.ok(results.every(result => result.movement.notes === 'Retorno conjunto da equipe'));
});

test('devolução múltipla é atômica quando uma linha excede o saldo disponível na obra', async () => {
  const client = fakeClient();
  const originalCount = client.state.movements.length;

  await assert.rejects(
    () => createReturnMovements(client, {
      createdById: 'manager-1',
      data: payload({
        items: [
          { itemId: 'item-chemical', batchId: 'batch-chemical', quantity: 2 },
          { itemId: 'item-filter', batchId: 'batch-filter', quantity: 3 }
        ]
      })
    }),
    /Saldo insuficiente na obra.*disponível: 2\.000 un/
  );

  assert.equal(client.state.movements.length, originalCount);
});

test('devolução múltipla rejeita produto e lote duplicados', async () => {
  const client = fakeClient();

  await assert.rejects(
    () => createReturnMovements(client, {
      createdById: 'manager-1',
      data: payload({
        items: [
          { itemId: 'item-chemical', batchId: 'batch-chemical', quantity: 1 },
          { itemId: 'item-chemical', batchId: 'batch-chemical', quantity: 1 }
        ]
      })
    }),
    /produto e lote já foram adicionados/i
  );
});
