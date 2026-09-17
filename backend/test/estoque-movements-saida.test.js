import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import { createMovement } from '../src/lib/estoque/stock-movements.js';

function stockItem(overrides = {}) {
  return {
    id: 'item-1',
    type: 'PRODUTO_QUIMICO',
    code: 'PQ-001',
    name: 'Produto',
    unitLabel: 'kg',
    isActive: true,
    ...overrides
  };
}

function stockBatch(overrides = {}) {
  return {
    id: 'batch-1',
    itemId: 'item-1',
    lotNumber: 'L-A',
    expiryDate: new Date('2026-09-30T00:00:00.000Z'),
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    ...overrides
  };
}

function stockMovement(overrides = {}) {
  return {
    id: `movement-${Math.random()}`,
    itemId: 'item-1',
    batchId: 'batch-1',
    type: 'ENTRADA',
    reason: 'COMPRA',
    quantity: new Prisma.Decimal(5),
    date: new Date('2026-07-01T00:00:00.000Z'),
    createdById: 'user-1',
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    ...overrides
  };
}

function fakeClient({
  item = stockItem(),
  batches = [stockBatch()],
  movements = [stockMovement()],
  project = { id: 'project-1' },
  serializeTransactions = false,
  workflow = null
} = {}) {
  const state = { item, batches: [...batches], movements: [...movements], project };
  let movementSeq = state.movements.length;
  let transactionQueue = Promise.resolve();

  function batchBalance(batchId) {
    return state.movements
      .filter(movement => movement.batchId === batchId)
      .reduce((sum, movement) => (
        movement.type === 'ENTRADA'
          ? sum.plus(movement.quantity)
          : sum.minus(movement.quantity)
      ), new Prisma.Decimal(0));
  }

  function groupBy({ by, where = {} }) {
    const keyField = by.includes('batchId') ? 'batchId' : 'itemId';
    const grouped = new Map();
    for (const movement of state.movements) {
      if (where.itemId && movement.itemId !== where.itemId) continue;
      if (where.batchId && movement.batchId !== where.batchId) continue;
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

  const tx = {
    $queryRaw: async () => null,
    stockItem: {
      findUnique: async args => (args.where.id === state.item.id ? state.item : null)
    },
    stockBatch: {
      findUnique: async args => {
        if (args.where.id) return state.batches.find(batch => batch.id === args.where.id) || null;
        const key = args.where.itemId_lotNumber;
        return state.batches.find(batch => batch.itemId === key.itemId && batch.lotNumber === key.lotNumber) || null;
      },
      create: async args => {
        const batch = { id: `batch-${state.batches.length + 1}`, createdAt: new Date(), ...args.data };
        state.batches.push(batch);
        return batch;
      }
    },
    project: {
      findFirst: async () => state.project
    },
    projectWorkflow: { findUnique: async () => workflow },
    stockMovement: {
      create: async args => {
        movementSeq += 1;
        const batch = state.batches.find(item => item.id === args.data.batchId);
        const movement = {
          id: `movement-${movementSeq}`,
          createdAt: new Date('2026-07-09T12:00:00.000Z'),
          project: state.project,
          reversedBy: null,
          ...args.data,
          item: state.item,
          batch,
          createdBy: { id: args.data.createdById, name: 'Gestor Estoque' }
        };
        state.movements.push(movement);
        return movement;
      },
      groupBy: async args => groupBy(args)
    }
  };

  return {
    state,
    batchBalance,
    $transaction(fn) {
      if (!serializeTransactions) return fn(tx);
      const run = transactionQueue.then(() => fn(tx));
      transactionQueue = run.catch(() => {});
      return run;
    }
  };
}

test('USO_EM_PROJETO blocks insufficient balance and allows exact balance', async () => {
  const insufficient = fakeClient();
  await assert.rejects(
    () => createMovement(insufficient, {
      createdById: 'user-1',
      data: {
        reason: 'USO_EM_PROJETO',
        itemId: 'item-1',
        batchId: 'batch-1',
        projectId: 'project-1',
        quantity: 6,
        date: '2026-07-09'
      }
    }),
    /disponível: 5\.000 kg/
  );

  const exact = fakeClient();
  const result = await createMovement(exact, {
    createdById: 'user-1',
    data: {
      reason: 'USO_EM_PROJETO',
      itemId: 'item-1',
      batchId: 'batch-1',
      projectId: 'project-1',
      quantity: 5,
      date: '2026-07-09'
    }
  });
  assert.equal(result.movement.type, 'SAIDA');
  assert.equal(result.balances.batch.toString(), '0');
});

test('USO_EM_PROJETO rejects invalid project and expired lot without confirmation', async () => {
  const invalidProject = fakeClient({ project: null });
  await assert.rejects(
    () => createMovement(invalidProject, {
      createdById: 'user-1',
      data: {
        reason: 'USO_EM_PROJETO',
        itemId: 'item-1',
        batchId: 'batch-1',
        projectId: 'project-1',
        quantity: 1,
        date: '2026-07-09'
      }
    }),
    /Projeto de destino inválido/
  );

  const expired = fakeClient({ batches: [stockBatch({ expiryDate: new Date('2026-01-01T00:00:00.000Z') })] });
  await assert.rejects(
    () => createMovement(expired, {
      createdById: 'user-1',
      data: {
        reason: 'USO_EM_PROJETO',
        itemId: 'item-1',
        batchId: 'batch-1',
        projectId: 'project-1',
        quantity: 1,
        date: '2026-07-09'
      }
    }),
    error => error?.requiresConfirmation === true && error?.statusCode === 422
  );

  const confirmed = await createMovement(expired, {
    createdById: 'user-1',
    data: {
      reason: 'USO_EM_PROJETO',
      itemId: 'item-1',
      batchId: 'batch-1',
      projectId: 'project-1',
      quantity: 1,
      date: '2026-07-09',
      confirmExpired: true
    }
  });
  assert.equal(confirmed.movement.reason, 'USO_EM_PROJETO');
});

test('USO_EM_PROJETO serialized concurrent exits do not leave negative balance', async () => {
  const client = fakeClient({ serializeTransactions: true });
  const payload = {
    reason: 'USO_EM_PROJETO',
    itemId: 'item-1',
    batchId: 'batch-1',
    projectId: 'project-1',
    quantity: 3,
    date: '2026-07-09'
  };

  const results = await Promise.allSettled([
    createMovement(client, { createdById: 'user-1', data: payload }),
    createMovement(client, { createdById: 'user-1', data: payload })
  ]);

  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(client.batchBalance('batch-1').toString(), '2');
});

test('USO_EM_PROJETO não altera saldo quando o projeto gerenciado não está autorizado', async () => {
  const client = fakeClient({
    workflow: {
      projectId: 'project-1', stage: 'PREPARATION', version: 1,
      mobilizationAuthorizedAt: null, mobilizationAuthorizationVersion: null,
      checklists: [], commercialFacts: [], issues: []
    }
  });
  await assert.rejects(
    createMovement(client, {
      createdById: 'user-1',
      data: {
        reason: 'USO_EM_PROJETO', itemId: 'item-1', batchId: 'batch-1',
        projectId: 'project-1', quantity: 1, date: '2026-07-09'
      }
    }),
    error => error.code === 'PROJECT_MOBILIZATION_NOT_AUTHORIZED'
  );
  assert.equal(client.batchBalance('batch-1').toString(), '5');
});
