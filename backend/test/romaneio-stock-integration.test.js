import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import {
  createAutomaticRomaneioStockMovementsInTransaction,
  reverseMovementInTransaction
} from '../src/lib/estoque/stock-movements.js';
import { buildStockCatalogRows, syncStockCatalogRows } from '../src/lib/romaneio-catalog.js';
import { createRomaneioStockMovements, syncRomaneioStockMovements } from '../src/lib/romaneio/romaneio-stock.js';

function stockItem(overrides = {}) {
  return {
    id: 'stock-item-1',
    type: 'PRODUTO_QUIMICO',
    code: 'PQ-001',
    name: 'Produto Quimico',
    unitLabel: 'kg',
    isActive: true,
    ...overrides
  };
}

function batch(overrides = {}) {
  return {
    id: overrides.id || 'batch-1',
    itemId: 'stock-item-1',
    lotNumber: overrides.lotNumber || 'L-A',
    expiryDate: overrides.expiryDate ?? new Date('2026-08-01T00:00:00.000Z'),
    createdAt: overrides.createdAt ?? new Date('2026-07-01T12:00:00.000Z'),
    ...overrides
  };
}

function movement(overrides = {}) {
  return {
    id: overrides.id || `movement-${Math.random()}`,
    itemId: overrides.itemId || 'stock-item-1',
    batchId: overrides.batchId || 'batch-1',
    romaneioId: overrides.romaneioId || null,
    type: overrides.type || 'ENTRADA',
    reason: overrides.reason || 'COMPRA',
    quantity: new Prisma.Decimal(overrides.quantity ?? 5),
    date: overrides.date || new Date('2026-07-01T00:00:00.000Z'),
    projectId: overrides.projectId ?? null,
    requestedBy: overrides.requestedBy || null,
    notes: overrides.notes || null,
    excludeFromProjectCost: overrides.excludeFromProjectCost || false,
    reversalOfId: overrides.reversalOfId || null,
    createdById: overrides.createdById || 'user-1',
    createdAt: overrides.createdAt || new Date('2026-07-01T12:00:00.000Z')
  };
}

function fakeTx({
  item = stockItem(),
  items = [item],
  batches = [batch()],
  movements = [movement()],
  project = { id: 'project-1' },
  workflow = null
} = {}) {
  const state = {
    item,
    items,
    batches: [...batches],
    movements: [...movements],
    project
  };
  let movementSeq = state.movements.length;

  function groupBy({ by, where = {} }) {
    const keyField = by.includes('batchId') ? 'batchId' : 'itemId';
    const grouped = new Map();
    for (const row of state.movements) {
      if (where.itemId?.in && !where.itemId.in.includes(row.itemId)) continue;
      if (where.itemId && typeof where.itemId === 'string' && row.itemId !== where.itemId) continue;
      if (where.batchId && row.batchId !== where.batchId) continue;
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

  function movementWithRelations(row) {
    if (!row) return null;
    const reversedBy = state.movements.find(candidate => candidate.reversalOfId === row.id);
    return {
      ...row,
      item: state.items.find(item => item.id === row.itemId),
      batch: state.batches.find(item => item.id === row.batchId),
      project: row.projectId ? state.project : null,
      createdBy: { id: row.createdById, name: 'Usuario' },
      reversedBy: reversedBy ? { id: reversedBy.id } : null
    };
  }

  const tx = {
    state,
    $queryRaw: async () => null,
    stockItem: {
      findUnique: async args => state.items.find(item => item.id === args.where.id) || null
    },
    stockBatch: {
      findMany: async args => state.batches.filter(row => row.itemId === args.where.itemId),
      findUnique: async args => {
        if (args.where.id) return state.batches.find(row => row.id === args.where.id) || null;
        const key = args.where.itemId_lotNumber;
        return state.batches.find(row => row.itemId === key.itemId && row.lotNumber === key.lotNumber) || null;
      },
      create: async args => {
        const created = { id: `batch-${state.batches.length + 1}`, createdAt: new Date('2026-07-09T12:00:00.000Z'), ...args.data };
        state.batches.push(created);
        return created;
      }
    },
    project: {
      findFirst: async () => state.project
    },
    projectWorkflow: { findUnique: async () => workflow },
    stockMovement: {
      findMany: async args => state.movements
        .filter(row => row.romaneioId === args.where.romaneioId && row.reason !== args.where.reason.not)
        .map(movementWithRelations),
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
  return tx;
}

test('stock catalog rows expose filters as units and kg chemicals as weight', () => {
  const rows = buildStockCatalogRows([
    stockItem({ id: 'filter-1', type: 'FILTRO', code: 'FL-001', name: 'Filtro A', unitLabel: 'un' }),
    stockItem({ id: 'chemical-1', type: 'PRODUTO_QUIMICO', code: 'PQ-001', name: 'Produto kg', unitLabel: 'kg' }),
    stockItem({ id: 'chemical-l', type: 'PRODUTO_QUIMICO', code: 'PQ-L', name: 'Produto L', unitLabel: 'L' })
  ]);

  assert.deepEqual(rows.map(row => row.sourceId), ['filter-1', 'chemical-1']);
  assert.deepEqual(rows.map(row => row.sourceType), ['STOCK', 'STOCK']);
  assert.equal(rows[0].categoryName, 'Filtros');
  assert.equal(rows[0].measureType, 'UNIT');
  assert.equal(rows[0].defaultUnitLabel, 'un');
  assert.equal(rows[0].isSerialized, false);
  assert.equal(rows[1].categoryName, 'Produtos químicos');
  assert.equal(rows[1].measureType, 'WEIGHT');
  assert.equal(rows[1].defaultUnitLabel, 'kg');
});

test('syncStockCatalogRows deactivates STOCK rows missing from current stock list', async () => {
  const calls = [];
  const tx = {
    romaneioCatalogItem: {
      findMany: async () => [],
      createMany: async args => {
        calls.push(['createMany', args]);
        return { count: args.data.length };
      },
      updateMany: async args => {
        calls.push(['updateMany', args]);
        return { count: 1 };
      }
    }
  };

  await syncStockCatalogRows(tx, [{
    sourceType: 'STOCK',
    sourceId: 'stock-item-1',
    code: 'PQ-001',
    name: 'Produto',
    categoryName: 'Produtos químicos',
    kind: 'EQUIPMENT',
    measureType: 'WEIGHT',
    defaultUnitLabel: 'kg',
    isSerialized: false,
    isActive: true
  }]);

  assert.equal(calls[0][0], 'createMany');
  assert.deepEqual(calls[1], ['updateMany', {
    where: { sourceType: 'STOCK', sourceId: { notIn: ['stock-item-1'] }, isActive: true },
    data: { isActive: false }
  }]);
});

test('syncStockCatalogRows deactivates legacy FILE chemical catalog rows', async () => {
  const calls = [];
  const tx = {
    romaneioCatalogItem: {
      findMany: async () => [],
      createMany: async args => {
        calls.push(['createMany', args]);
        return { count: args.data.length };
      },
      updateMany: async args => {
        calls.push(['updateMany', args]);
        return { count: 1 };
      }
    }
  };

  await syncStockCatalogRows(tx, []);

  const legacyChemicalUpdate = calls.find(([operation, args]) => (
    operation === 'updateMany'
    && args.where?.sourceType === 'FILE'
    && args.where?.OR
  ));

  assert.ok(legacyChemicalUpdate);
  assert.equal(legacyChemicalUpdate[1].data.isActive, false);
  assert.ok(legacyChemicalUpdate[1].where.OR.some(item => (
    item.categoryName?.equals === 'Produtos Químicos'
  )));
});

test('automatic outbound romaneio stock movement splits quantity by FEFO and links romaneio', async () => {
  const tx = fakeTx({
    batches: [
      batch({ id: 'batch-late', lotNumber: 'L-B', expiryDate: new Date('2026-10-01T00:00:00.000Z') }),
      batch({ id: 'batch-early', lotNumber: 'L-A', expiryDate: new Date('2026-08-01T00:00:00.000Z') })
    ],
    movements: [
      movement({ id: 'entry-early', batchId: 'batch-early', quantity: 5 }),
      movement({ id: 'entry-late', batchId: 'batch-late', quantity: 5 })
    ]
  });

  const created = await createAutomaticRomaneioStockMovementsInTransaction(tx, {
    romaneioType: 'OUTBOUND',
    itemId: 'stock-item-1',
    quantity: 7,
    date: '2026-07-09',
    projectId: 'project-1',
    requestedBy: 'Operador Romaneio',
    notes: 'Romaneio automatico',
    createdById: 'user-1',
    romaneioId: 'romaneio-1'
  });

  assert.equal(created.length, 2);
  assert.equal(created[0].batchId, 'batch-early');
  assert.equal(created[0].quantity.toString(), '5');
  assert.equal(created[1].batchId, 'batch-late');
  assert.equal(created[1].quantity.toString(), '2');
  assert.equal(created[0].romaneioId, 'romaneio-1');
  assert.equal(created[0].requestedBy, 'Operador Romaneio');
  assert.equal(created[0].reason, 'USO_EM_PROJETO');
});

test('automatic outbound romaneio stock movement identifies item when stock is insufficient', async () => {
  const tx = fakeTx({
    item: stockItem({ code: 'PQ-001', name: 'Quimipan' }),
    batches: [batch({ id: 'batch-low', lotNumber: 'L-A' })],
    movements: [movement({ id: 'entry-low', batchId: 'batch-low', quantity: 3 })]
  });

  await assert.rejects(
    createAutomaticRomaneioStockMovementsInTransaction(tx, {
      romaneioType: 'OUTBOUND',
      itemId: 'stock-item-1',
      quantity: 7,
      date: '2026-07-09',
      projectId: 'project-1',
      requestedBy: 'Operador Romaneio',
      notes: 'Romaneio automatico',
      createdById: 'user-1',
      romaneioId: 'romaneio-1'
    }),
    error => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /PQ-001 - Quimipan/);
      assert.match(error.message, /solicitado: 7\.000 kg/);
      assert.match(error.message, /disponível: 3\.000 kg/);
      return true;
    }
  );
});

test('automatic inbound romaneio stock movement creates return batch when none exists', async () => {
  const tx = fakeTx({ batches: [], movements: [] });

  const created = await createAutomaticRomaneioStockMovementsInTransaction(tx, {
    romaneioType: 'INBOUND',
    itemId: 'stock-item-1',
    quantity: 2.5,
    date: '2026-07-09',
    projectId: 'project-1',
    requestedBy: 'Operador Romaneio',
    notes: 'Romaneio retorno',
    excludeFromProjectCost: true,
    createdById: 'user-1',
    romaneioId: 'romaneio-2'
  });

  assert.equal(tx.state.batches.length, 1);
  assert.equal(tx.state.batches[0].lotNumber, 'ROMANEIO');
  assert.equal(created[0].type, 'ENTRADA');
  assert.equal(created[0].reason, 'DEVOLUCAO_OBRA');
  assert.equal(created[0].excludeFromProjectCost, true);
  assert.equal(created[0].romaneioId, 'romaneio-2');
});

test('movimentação automática de romaneio permite saída antes da mobilização e mantém entrada', async () => {
  const workflow = {
    projectId: 'project-1', stage: 'PREPARATION', version: 1,
    mobilizationAuthorizedAt: null, mobilizationAuthorizationVersion: null,
    checklists: [], commercialFacts: [], issues: []
  };
  const tx = fakeTx({ workflow });
  const outbound = await createAutomaticRomaneioStockMovementsInTransaction(tx, {
    romaneioType: 'OUTBOUND', itemId: 'stock-item-1', quantity: 1, date: '2026-07-09',
    projectId: 'project-1', createdById: 'user-1', romaneioId: 'romaneio-1'
  });
  assert.equal(outbound[0].type, 'SAIDA');
  assert.equal(outbound[0].romaneioId, 'romaneio-1');
  assert.equal(tx.state.movements.length, 2);

  const returned = await createAutomaticRomaneioStockMovementsInTransaction(tx, {
    romaneioType: 'INBOUND', itemId: 'stock-item-1', quantity: 1, date: '2026-07-09',
    projectId: 'project-1', createdById: 'user-1', romaneioId: 'romaneio-2'
  });
  assert.equal(returned[0].type, 'ENTRADA');
});

test('romaneio-linked stock reversal preserves romaneioId and project cost exclusion', async () => {
  const tx = fakeTx({
    movements: [
      movement({ id: 'entry-1', quantity: 5 }),
      movement({
        id: 'romaneio-exit',
        type: 'SAIDA',
        reason: 'USO_EM_PROJETO',
        quantity: 2,
        projectId: 'project-1',
        romaneioId: 'romaneio-1',
        excludeFromProjectCost: true
      })
    ]
  });

  const reversed = await reverseMovementInTransaction(tx, {
    movementId: 'romaneio-exit',
    notes: 'Edicao do romaneio',
    createdById: 'user-1'
  });

  assert.equal(reversed.movement.type, 'ENTRADA');
  assert.equal(reversed.movement.reason, 'ESTORNO');
  assert.equal(reversed.movement.romaneioId, 'romaneio-1');
  assert.equal(reversed.movement.excludeFromProjectCost, true);
  assert.equal(reversed.movement.reversalOfId, 'romaneio-exit');
});

const editor = { id: 'editor-1', name: 'Coordenador' };

function romaneioItem(itemId, quantity, overrides = {}) {
  return {
    catalogItem: { sourceType: 'STOCK', sourceId: itemId },
    quantity: new Prisma.Decimal(quantity),
    isExtra: false,
    ...overrides
  };
}

function outboundRomaneio(items, overrides = {}) {
  return {
    id: 'romaneio-1',
    type: 'OUTBOUND',
    projectId: 'project-1',
    romaneioDate: new Date('2026-07-09T15:00:00.000Z'),
    items,
    ...overrides
  };
}

function seadrillFixture() {
  const quantities = [4500, 420, 400, 725, 425];
  const items = quantities.map((_, index) => stockItem({ id: `chemical-${index}` }));
  const allocations = quantities.flatMap((quantity, index) => (index === 1 ? [70, 350] : [quantity])
    .map((amount, lot) => ({ itemId: items[index].id, quantity: amount, batchId: `batch-${index}-${lot}` })));
  const tx = fakeTx({
    items,
    batches: allocations.map(row => batch({ id: row.batchId, itemId: row.itemId })),
    movements: allocations.flatMap(row => [
      movement({ ...row, id: `purchase-${row.batchId}` }),
      movement({
        ...row, id: `exit-${row.batchId}`, type: 'SAIDA', reason: 'USO_EM_PROJETO',
        romaneioId: 'romaneio-1', projectId: 'project-1', date: new Date('2026-07-09T15:00:00.000Z')
      })
    ])
  });
  return { tx, romaneio: outboundRomaneio(quantities.map((quantity, index) => romaneioItem(items[index].id, quantity))) };
}

function netQuantity(tx, itemId) {
  return tx.state.movements
    .filter(row => row.romaneioId === 'romaneio-1' && row.itemId === itemId)
    .reduce((total, row) => row.type === 'SAIDA' ? total.plus(row.quantity) : total.minus(row.quantity), new Prisma.Decimal(0))
    .toString();
}

test('editing one Seadrill chemical preserves the other four products and reverses only the changed product', async () => {
  const { tx, romaneio } = seadrillFixture();
  const before = [...tx.state.movements];
  romaneio.items[1].quantity = new Prisma.Decimal(385);

  const created = await syncRomaneioStockMovements(tx, romaneio, editor);

  assert.deepEqual(created.map(row => [row.itemId, row.batchId, row.quantity.toString()]), [
    ['chemical-1', 'batch-1-0', '70'],
    ['chemical-1', 'batch-1-1', '315']
  ]);
  const added = tx.state.movements.slice(before.length);
  assert.equal(added.length, 4);
  assert.ok(added.every(row => row.itemId === 'chemical-1'));
  assert.deepEqual(added.filter(row => row.reason === 'ESTORNO').map(row => row.reversalOfId), [
    'exit-batch-1-0', 'exit-batch-1-1'
  ]);
  assert.deepEqual(romaneio.items.map(row => netQuantity(tx, row.catalogItem.sourceId)), ['4500', '385', '400', '725', '425']);
  assert.ok(before.every(row => tx.state.movements.includes(row)));

  // Saving again must ignore previous reversals and preserve the new allocations.
  assert.deepEqual(await syncRomaneioStockMovements(tx, romaneio, editor), []);
  assert.equal(tx.state.movements.length, before.length + 4);
});

test('editing only transport data, equipment or item order creates no stock movements', async () => {
  const { tx, romaneio } = seadrillFixture();
  const before = [...tx.state.movements];
  romaneio.driverName = 'Outro motorista';
  romaneio.vehiclePlate = 'ABC1D23';
  romaneio.items.reverse();
  romaneio.items.push(romaneioItem('equipment-1', 3, { catalogItem: { sourceType: 'EQUIPAMENTOS' } }));
  tx.state.items[0].isActive = false;

  assert.deepEqual(await syncRomaneioStockMovements(tx, romaneio, editor), []);
  assert.deepEqual(tx.state.movements, before);
});

test('adding and removing stock products adjusts only those products', async () => {
  const { tx, romaneio } = seadrillFixture();
  const before = tx.state.movements.length;
  tx.state.items.push(stockItem({ id: 'new-chemical' }));
  tx.state.batches.push(batch({ id: 'new-batch', itemId: 'new-chemical' }));
  tx.state.movements.push(movement({ id: 'new-purchase', itemId: 'new-chemical', batchId: 'new-batch', quantity: 10 }));
  romaneio.items = romaneio.items.filter(row => row.catalogItem.sourceId !== 'chemical-2');
  romaneio.items.push(romaneioItem('new-chemical', 5));

  await syncRomaneioStockMovements(tx, romaneio, editor);

  assert.deepEqual(tx.state.movements.slice(before + 1).map(row => [row.itemId, row.type, row.reason]), [
    ['chemical-2', 'ENTRADA', 'ESTORNO'],
    ['new-chemical', 'SAIDA', 'USO_EM_PROJETO']
  ]);
  assert.equal(netQuantity(tx, 'chemical-2'), '0');
  assert.equal(netQuantity(tx, 'new-chemical'), '5');
});

for (const [label, overrides] of [
  ['project', { projectId: 'project-2' }],
  ['date', { romaneioDate: new Date('2026-07-10T15:00:00.000Z') }],
  ['direction', { type: 'INBOUND' }]
]) {
  test(`editing romaneio ${label} replaces affected movements even when quantities are unchanged`, async () => {
    const tx = fakeTx();
    const romaneio = outboundRomaneio([romaneioItem('stock-item-1', 2)]);
    await createRomaneioStockMovements(tx, romaneio, editor);
    Object.assign(romaneio, overrides);
    const before = tx.state.movements.length;

    const created = await syncRomaneioStockMovements(tx, romaneio, editor);

    assert.equal(tx.state.movements.length, before + 2);
    assert.equal(tx.state.movements[before].reason, 'ESTORNO');
    assert.equal(created[0].projectId, romaneio.projectId);
    assert.equal(created[0].date.toISOString(), romaneio.romaneioDate.toISOString());
    assert.equal(created[0].type, romaneio.type === 'OUTBOUND' ? 'SAIDA' : 'ENTRADA');
    assert.equal(netQuantity(tx, 'stock-item-1'), romaneio.type === 'OUTBOUND' ? '2' : '-2');
  });
}

test('editing an inbound extra flag updates cost exclusion without changing stock balance', async () => {
  const tx = fakeTx();
  const romaneio = outboundRomaneio([romaneioItem('stock-item-1', 2)], { type: 'INBOUND' });
  await createRomaneioStockMovements(tx, romaneio, editor);
  romaneio.items[0].isExtra = true;

  const created = await syncRomaneioStockMovements(tx, romaneio, editor);

  assert.equal(created.length, 1);
  assert.equal(created[0].excludeFromProjectCost, true);
  assert.equal(netQuantity(tx, 'stock-item-1'), '-2');
  const before = tx.state.movements.length;
  assert.deepEqual(await syncRomaneioStockMovements(tx, romaneio, editor), []);
  assert.equal(tx.state.movements.length, before);
});

test('stock comparison sums duplicate item rows with decimal precision', async () => {
  const tx = fakeTx();
  const romaneio = outboundRomaneio([romaneioItem('stock-item-1', '0.3')]);
  await createRomaneioStockMovements(tx, romaneio, editor);
  const before = tx.state.movements.length;
  romaneio.items = [romaneioItem('stock-item-1', '0.1'), romaneioItem('stock-item-1', '0.2')];

  assert.deepEqual(await syncRomaneioStockMovements(tx, romaneio, editor), []);
  assert.equal(tx.state.movements.length, before);
});

test('editing stock quantities still enforces available balance', async () => {
  const tx = fakeTx();
  const romaneio = outboundRomaneio([romaneioItem('stock-item-1', 2)]);
  await createRomaneioStockMovements(tx, romaneio, editor);
  romaneio.items[0].quantity = new Prisma.Decimal(6);

  await assert.rejects(syncRomaneioStockMovements(tx, romaneio, editor), /Saldo insuficiente/);
});
