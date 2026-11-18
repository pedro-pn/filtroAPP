import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  aggregateStockConsumptionMovements,
  buildBatchUnitCostMap,
  getStockConsumptionCostByProject
} from '../src/lib/acompanhamento/stock-cost.js';

function stockMovement(overrides = {}) {
  return {
    projectId: 'project-1',
    batchId: 'batch-1',
    type: 'SAIDA',
    reason: 'USO_EM_PROJETO',
    quantity: overrides.quantity ?? 1,
    unitCost: overrides.unitCost ?? null,
    item: { type: overrides.itemType || 'PRODUTO_QUIMICO' },
    ...overrides
  };
}

function purchaseMovement(overrides = {}) {
  return {
    batchId: 'batch-1',
    quantity: overrides.quantity ?? 1,
    unitCost: overrides.unitCost ?? 10,
    reversedBy: null,
    ...overrides
  };
}

test('buildBatchUnitCostMap calcula custo médio ponderado e ignora compra estornada', () => {
  const costs = buildBatchUnitCostMap([
    purchaseMovement({ quantity: 2, unitCost: 10 }),
    purchaseMovement({ quantity: 3, unitCost: 20 }),
    purchaseMovement({ quantity: 5, unitCost: 100, reversedBy: { id: 'reverse-1' } })
  ]);

  assert.equal(costs.get('batch-1'), 16);
});

test('aggregateStockConsumptionMovements soma saída e abate retorno de produto químico', () => {
  const costs = new Map([['batch-1', 10], ['batch-2', 12]]);
  const result = aggregateStockConsumptionMovements([
    stockMovement({ batchId: 'batch-1', quantity: 5 }),
    stockMovement({ batchId: 'batch-2', quantity: 2 }),
    stockMovement({ batchId: 'batch-1', type: 'ENTRADA', reason: 'DEVOLUCAO_OBRA', quantity: 2 })
  ], costs);

  assert.deepEqual(result.get('project-1'), {
    total: 54,
    categories: [{ categoria: 'Produtos químicos (estoque)', total: 54 }]
  });
});

test('aggregateStockConsumptionMovements ignora entrada extra que não deve abater custo', () => {
  const costs = new Map([['batch-1', 10]]);
  const result = aggregateStockConsumptionMovements([
    stockMovement({ batchId: 'batch-1', quantity: 5 }),
    stockMovement({
      batchId: 'batch-1',
      type: 'ENTRADA',
      reason: 'DEVOLUCAO_OBRA',
      quantity: 2,
      excludeFromProjectCost: true
    })
  ], costs);

  assert.deepEqual(result.get('project-1'), {
    total: 50,
    categories: [{ categoria: 'Produtos químicos (estoque)', total: 50 }]
  });
});

test('aggregateStockConsumptionMovements considera filtros e unitCost da própria movimentação', () => {
  const result = aggregateStockConsumptionMovements([
    stockMovement({ itemType: 'FILTRO', quantity: 3, unitCost: 90 }),
    stockMovement({ itemType: 'FILTRO', type: 'ENTRADA', reason: 'DEVOLUCAO_OBRA', quantity: 1, unitCost: 90 })
  ]);

  assert.deepEqual(result.get('project-1'), {
    total: 180,
    categories: [{ categoria: 'Filtros (estoque)', total: 180 }]
  });
});

test('aggregateStockConsumptionMovements usa estorno para cancelar custo de projeto', () => {
  const result = aggregateStockConsumptionMovements([
    stockMovement({ quantity: 4, unitCost: 25 }),
    stockMovement({ type: 'ENTRADA', reason: 'ESTORNO', quantity: 4, unitCost: 25 })
  ]);

  assert.deepEqual(result.get('project-1'), { total: 0, categories: [] });
});

test('getStockConsumptionCostByProject busca movimentos de projeto e custo das compras do lote', async () => {
  const calls = [];
  const client = {
    stockMovement: {
      findMany: async args => {
        calls.push(args);
        if (args.where.reason?.in) {
          return [
            stockMovement({ batchId: 'batch-1', quantity: 7 }),
            stockMovement({ batchId: 'batch-1', type: 'ENTRADA', reason: 'DEVOLUCAO_OBRA', quantity: 2 })
          ];
        }
        return [purchaseMovement({ batchId: 'batch-1', quantity: 5, unitCost: 11 })];
      }
    }
  };

  const result = await getStockConsumptionCostByProject(['project-1'], client);

  assert.deepEqual(calls[0].where.projectId, { in: ['project-1'] });
  assert.deepEqual(calls[1].where.batchId, { in: ['batch-1'] });
  assert.equal(result.get('project-1').total, 55);
});

test('romaneios custeiam somente a quantidade enviada e descontam as sobras na entrada', async () => {
  const movements = [
    stockMovement({ romaneioId: 'outbound-1', quantity: '7.500' }),
    stockMovement({ romaneioId: 'outbound-2', quantity: '2.500' })
  ];
  const client = {
    stockMovement: {
      findMany: async ({ where }) => where.reason?.in
        ? movements
        : [purchaseMovement({ quantity: 100, unitCost: '12.50' })]
    }
  };

  // Compra de R$ 1.250,00; somente 10 kg enviados à obra entram no custo.
  assert.equal((await getStockConsumptionCostByProject(['project-1'], client)).get('project-1').total, 125);

  movements.push(stockMovement({
    romaneioId: 'inbound-1', type: 'ENTRADA', reason: 'DEVOLUCAO_OBRA', quantity: '2.000'
  }));
  assert.equal((await getStockConsumptionCostByProject(['project-1'], client)).get('project-1').total, 100);

  movements.push(stockMovement({
    romaneioId: 'inbound-2', type: 'ENTRADA', reason: 'DEVOLUCAO_OBRA', quantity: '8.000'
  }));
  assert.deepEqual((await getStockConsumptionCostByProject(['project-1'], client)).get('project-1'), {
    total: 0, categories: []
  });
});
