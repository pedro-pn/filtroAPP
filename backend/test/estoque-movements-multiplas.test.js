import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { createMovements } from '../src/lib/estoque/stock-movements.js';

function fakeClient({ expired = false, workflow = null } = {}) {
  const items = [
    { id: 'chemical', type: 'PRODUTO_QUIMICO', code: 'PQ-1', name: 'Químico', unitLabel: 'kg', isActive: true },
    { id: 'filter', type: 'FILTRO', code: 'FL-1', name: 'Filtro', unitLabel: 'un', isActive: true }
  ];
  const state = {
    transactions: 0,
    batches: items.map(item => ({ id: `batch-${item.id}`, itemId: item.id, lotNumber: 'A', expiryDate: new Date(expired ? '2000-01-01' : '2099-01-01') })),
    movements: items.map(item => ({ itemId: item.id, batchId: `batch-${item.id}`, type: 'ENTRADA', quantity: new Prisma.Decimal(5) }))
  };
  const tx = {
    $queryRaw: async () => null,
    stockItem: { findUnique: async ({ where }) => items.find(item => item.id === where.id) || null },
    stockBatch: {
      findUnique: async ({ where }) => state.batches.find(batch => where.id ? batch.id === where.id
        : batch.itemId === where.itemId_lotNumber.itemId && batch.lotNumber === where.itemId_lotNumber.lotNumber) || null,
      create: async ({ data }) => {
        const batch = { id: `batch-${state.batches.length}`, ...data };
        state.batches.push(batch);
        return batch;
      }
    },
    project: { findFirst: async ({ where }) => where.id === 'project' ? { id: 'project' } : null },
    projectWorkflow: { findUnique: async () => workflow },
    stockMovement: {
      create: async ({ data }) => {
        const row = { id: `movement-${state.movements.length}`, ...data };
        state.movements.push(row);
        return row;
      },
      groupBy: async ({ by, where }) => {
        const keyField = by.includes('batchId') ? 'batchId' : 'itemId';
        const groups = new Map();
        for (const row of state.movements) {
          if (typeof where.itemId === 'string' && where.itemId !== row.itemId) continue;
          if (where.itemId?.in && !where.itemId.in.includes(row.itemId)) continue;
          if (where.projectId && where.projectId !== row.projectId) continue;
          const key = `${row[keyField]}:${row.type}`;
          const group = groups.get(key) || { [keyField]: row[keyField], type: row.type, _sum: { quantity: new Prisma.Decimal(0) } };
          group._sum.quantity = group._sum.quantity.plus(row.quantity);
          groups.set(key, group);
        }
        return [...groups.values()];
      }
    }
  };
  return {
    state,
    async $transaction(callback) {
      state.transactions += 1;
      const batchCount = state.batches.length;
      const movementCount = state.movements.length;
      try { return await callback(tx); }
      catch (error) {
        state.batches.splice(batchCount);
        state.movements.splice(movementCount);
        throw error;
      }
    }
  };
}

function purchase(itemId, overrides = {}) {
  return { reason: 'COMPRA', itemId, quantity: 2, date: '2026-10-27', nfNumber: '123',
    lotNumber: 'B', expiryDate: '2099-02-01', unitCost: 1234.56, supplier: 'Fornecedor', ...overrides };
}

function exit(itemId, overrides = {}) {
  return { reason: 'USO_EM_PROJETO', itemId, batchId: `batch-${itemId}`, quantity: 2,
    projectId: 'project', date: '2026-10-27', ...overrides };
}

test('compras múltiplas gravam cada produto e custo em uma única transação', async () => {
  const client = fakeClient();
  const results = await createMovements(client, { createdById: 'manager', data: {
    movements: [purchase('chemical'), purchase('filter', { unitCost: 0, lotNumber: '' })]
  } });
  assert.equal(client.state.transactions, 1);
  assert.equal(results.length, 2);
  assert.deepEqual(results.map(result => result.movement.itemId), ['chemical', 'filter']);
  assert.deepEqual(results.map(result => result.movement.unitCost.toString()), ['1234.56', '0']);
  assert.ok(results.every(result => result.movement.nfNumber === '123' && result.movement.createdById === 'manager'));
  assert.deepEqual(results.map(result => result.balances.item.toString()), ['7', '7']);
});

test('falha no segundo produto desfaz a compra e o lote criado pelo primeiro', async () => {
  const client = fakeClient();
  await assert.rejects(createMovements(client, { createdById: 'manager', data: {
    movements: [purchase('chemical'), purchase('filter', { quantity: 1.5 })]
  } }), /quantidades inteiras/);
  assert.equal(client.state.movements.length, 2);
  assert.equal(client.state.batches.length, 2);
});

test('saídas múltiplas respeitam o saldo acumulado e desfazem o lote inteiro se faltar saldo', async () => {
  const client = fakeClient();
  await assert.rejects(createMovements(client, { createdById: 'manager', data: {
    movements: [exit('chemical', { quantity: 3 }), exit('chemical', { quantity: 3 })]
  } }), /Saldo insuficiente.*disponível: 2\.000/);
  assert.equal(client.state.movements.length, 2);
  const results = await createMovements(client, { createdById: 'manager', data: { movements: [exit('chemical'), exit('filter')] } });
  assert.deepEqual(results.map(result => result.balances.batch.toString()), ['3', '3']);
});

test('confirmação de lote vencido é exigida antes de gravar qualquer saída', async () => {
  const client = fakeClient({ expired: true });
  const movements = [exit('chemical', { confirmExpired: true }), exit('filter')];
  await assert.rejects(createMovements(client, { createdById: 'manager', data: { movements } }), error => error.requiresConfirmation === true);
  assert.equal(client.state.movements.length, 2);
  const results = await createMovements(client, { createdById: 'manager', data: { movements: movements.map(row => ({ ...row, confirmExpired: true })) } });
  assert.equal(results.length, 2);
});

test('lote recusa lista vazia, mais de 100 itens e estorno direto', async () => {
  for (const movements of [[], Array.from({ length: 101 }, () => purchase('filter')), [{
    ...exit('filter'), reason: 'ESTORNO', type: 'SAIDA', reversalOfId: 'original'
  }]]) {
    const client = fakeClient();
    await assert.rejects(createMovements(client, { createdById: 'manager', data: { movements } }));
    assert.equal(client.state.transactions, 0);
  }
});

test('saídas em lote mantêm a autorização de mobilização do projeto', async () => {
  const client = fakeClient({ workflow: {
    projectId: 'project', stage: 'PREPARATION', version: 1,
    mobilizationAuthorizedAt: null, mobilizationAuthorizationVersion: null,
    checklists: [], commercialFacts: [], issues: []
  } });
  await assert.rejects(createMovements(client, { createdById: 'manager', data: { movements: [exit('chemical'), exit('filter')] } }),
    error => error.code === 'PROJECT_MOBILIZATION_NOT_AUTHORIZED');
  assert.equal(client.state.movements.length, 2);
});
