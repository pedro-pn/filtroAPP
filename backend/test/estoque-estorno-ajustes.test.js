import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import { createMovement, reverseMovement } from '../src/lib/estoque/stock-movements.js';

function item() {
  return {
    id: 'item-1',
    type: 'PRODUTO_QUIMICO',
    code: 'PQ-001',
    name: 'Produto',
    unitLabel: 'kg',
    isActive: true
  };
}

function batch() {
  return {
    id: 'batch-1',
    itemId: 'item-1',
    lotNumber: 'L-A',
    expiryDate: new Date('2026-09-30T00:00:00.000Z'),
    createdAt: new Date('2026-07-01T12:00:00.000Z')
  };
}

function movement(overrides = {}) {
  return {
    id: overrides.id || 'movement-1',
    itemId: 'item-1',
    batchId: 'batch-1',
    type: overrides.type || 'ENTRADA',
    reason: overrides.reason || 'COMPRA',
    quantity: new Prisma.Decimal(overrides.quantity || 5),
    date: new Date('2026-07-01T00:00:00.000Z'),
    projectId: overrides.projectId ?? null,
    reversalOfId: overrides.reversalOfId || null,
    createdById: 'user-1',
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    ...overrides
  };
}

function fakeClient({ movements = [movement()], project = { id: 'project-1' } } = {}) {
  const state = {
    item: item(),
    batches: [batch()],
    movements: [...movements],
    project
  };
  let movementSeq = state.movements.length;

  function movementWithRelations(row) {
    if (!row) return null;
    return {
      ...row,
      item: state.item,
      batch: state.batches.find(batch => batch.id === row.batchId),
      project: row.projectId ? state.project : null,
      createdBy: { id: row.createdById, name: 'Gestor' },
      reversedBy: state.movements.find(candidate => candidate.reversalOfId === row.id)
        ? { id: state.movements.find(candidate => candidate.reversalOfId === row.id).id }
        : null
    };
  }

  function groupBy({ by, where = {} }) {
    const keyField = by.includes('batchId') ? 'batchId' : 'itemId';
    const grouped = new Map();
    for (const row of state.movements) {
      if (where.itemId?.in && !where.itemId.in.includes(row.itemId)) continue;
      if (where.itemId && typeof where.itemId === 'string' && row.itemId !== where.itemId) continue;
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
    stockItem: { findUnique: async args => (args.where.id === state.item.id ? state.item : null) },
    stockBatch: {
      findUnique: async args => state.batches.find(batch => batch.id === args.where.id) || null,
      create: async args => {
        const created = { id: `batch-${state.batches.length + 1}`, createdAt: new Date(), ...args.data };
        state.batches.push(created);
        return created;
      }
    },
    project: { findFirst: async () => state.project },
    stockMovement: {
      findUnique: async args => movementWithRelations(state.movements.find(row => row.id === args.where.id)),
      create: async args => {
        movementSeq += 1;
        const created = movement({
          id: `movement-${movementSeq}`,
          ...args.data,
          createdAt: new Date('2026-07-09T12:00:00.000Z')
        });
        state.movements.push(created);
        return movementWithRelations(created);
      },
      groupBy: async args => groupBy(args)
    }
  };

  return {
    state,
    $transaction: fn => fn(tx)
  };
}

test('reverseMovement creates inverse movement and blocks duplicate or reversal-of-reversal', async () => {
  const originalExit = movement({ id: 'exit-1', type: 'SAIDA', reason: 'USO_EM_PROJETO', quantity: 2, projectId: 'project-1' });
  const client = fakeClient({ movements: [movement({ id: 'entry-1', quantity: 5 }), originalExit] });

  const reversed = await reverseMovement(client, { movementId: 'exit-1', notes: 'Correção', createdById: 'user-1' });
  assert.equal(reversed.movement.type, 'ENTRADA');
  assert.equal(reversed.movement.reason, 'ESTORNO');
  assert.equal(reversed.movement.reversalOfId, 'exit-1');

  await assert.rejects(
    () => reverseMovement(client, { movementId: 'exit-1', createdById: 'user-1' }),
    /já estornada/
  );
  await assert.rejects(
    () => reverseMovement(client, { movementId: reversed.movement.id, createdById: 'user-1' }),
    /estornar um estorno/
  );
});

test('reverseMovement blocks reversal that would leave negative balance', async () => {
  const client = fakeClient({
    movements: [
      movement({ id: 'entry-1', type: 'ENTRADA', reason: 'COMPRA', quantity: 5 }),
      movement({ id: 'exit-1', type: 'SAIDA', reason: 'USO_EM_PROJETO', quantity: 5, projectId: 'project-1' })
    ]
  });

  await assert.rejects(
    () => reverseMovement(client, { movementId: 'entry-1', createdById: 'user-1' }),
    /Saldo insuficiente/
  );
});

test('createMovement handles return, inventory and loss note requirements', async () => {
  const client = fakeClient({
    movements: [
      movement({ id: 'entry-1', quantity: 5 }),
      movement({ id: 'exit-1', type: 'SAIDA', reason: 'USO_EM_PROJETO', quantity: 3, projectId: 'project-1' })
    ]
  });

  const returned = await createMovement(client, {
    createdById: 'user-1',
    data: {
      reason: 'DEVOLUCAO_OBRA',
      itemId: 'item-1',
      batchId: 'batch-1',
      projectId: 'project-1',
      quantity: 1,
      date: '2026-07-09'
    }
  });
  assert.equal(returned.movement.type, 'ENTRADA');
  assert.equal(returned.movement.nfNumber, null);

  await assert.rejects(
    () => createMovement(client, {
      createdById: 'user-1',
      data: {
        reason: 'DEVOLUCAO_OBRA',
        itemId: 'item-1',
        batchId: 'batch-1',
        projectId: 'project-1',
        quantity: 3,
        date: '2026-07-09'
      }
    }),
    /Saldo insuficiente na obra.*disponível: 2\.000 kg/
  );

  await assert.rejects(
    () => createMovement(client, {
      createdById: 'user-1',
      data: { reason: 'PERDA', itemId: 'item-1', batchId: 'batch-1', quantity: 1, date: '2026-07-09' }
    }),
    /justificativa/i
  );

  const inventory = await createMovement(client, {
    createdById: 'user-1',
    data: {
      reason: 'INVENTARIO',
      type: 'SAIDA',
      itemId: 'item-1',
      batchId: 'batch-1',
      quantity: 1,
      date: '2026-07-09',
      notes: 'Ajuste de contagem'
    }
  });
  assert.equal(inventory.movement.reason, 'INVENTARIO');
  assert.equal(inventory.movement.type, 'SAIDA');
});
