import assert from 'node:assert/strict';
import test from 'node:test';

import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import { createRomaneioStockMovements, syncRomaneioStockMovements } from '../src/lib/romaneio/romaneio-stock.js';
import { getStockItemProjectActivity, listStockMovements } from '../src/routes/resources/estoque.js';

test('romaneio stock edits preserve unchanged rows and roll back failed edits in PostgreSQL', { timeout: 60_000 }, async t => {
  const database = await apiSimulationDatabase();
  t.after(() => database.close());
  const { client } = database;
  const user = await client.user.create({ data: {
    username: 'stock-editor', name: 'Responsável fictício', passwordHash: 'synthetic', role: 'COORDINATOR'
  } });
  const project = await client.project.create({ data: {
    code: '5824', name: 'Projeto fictício', clientName: 'Cliente', clientCnpj: '', contractCode: '', location: ''
  } });
  const items = [];
  for (const [code, quantity] of [['PQ001', 4500], ['PQ002', 420]]) {
    const stock = await client.stockItem.create({ data: { type: 'PRODUTO_QUIMICO', code, name: code, unitLabel: 'kg' } });
    const batch = await client.stockBatch.create({ data: { itemId: stock.id, lotNumber: 'L1' } });
    await client.stockMovement.create({ data: {
      itemId: stock.id, batchId: batch.id, type: 'ENTRADA', reason: 'COMPRA', quantity,
      date: new Date('2026-10-01'), createdById: user.id
    } });
    const catalog = await client.romaneioCatalogItem.create({ data: {
      sourceType: 'STOCK', sourceId: stock.id, code, name: code, categoryName: 'Produtos químicos',
      measureType: 'WEIGHT', defaultUnitLabel: 'kg', isSerialized: false
    } });
    items.push({ catalogItemId: catalog.id, itemName: code, categoryName: catalog.categoryName,
      quantity, unitLabel: 'kg', measureType: 'WEIGHT' });
  }
  const include = { items: { include: { catalogItem: true } } };
  const romaneio = await client.$transaction(async tx => {
    const created = await tx.romaneio.create({ data: {
      projectId: project.id, type: 'OUTBOUND', romaneioDate: new Date('2026-11-01T15:00:00Z'),
      driverName: 'Fictício', vehiclePlate: 'ABC1D23', items: { create: items }
    }, include });
    await createRomaneioStockMovements(tx, created, user);
    return created;
  });
  const firstMovements = await client.stockMovement.findMany({ where: { romaneioId: romaneio.id }, orderBy: { id: 'asc' } });
  const unchanged = firstMovements.find(row => row.quantity.eq(4500));
  const changed = firstMovements.find(row => row.quantity.eq(420));
  const changedItem = romaneio.items.find(row => row.itemName === 'PQ002');
  async function edit(quantity) {
    return client.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Romaneio" WHERE id = ${romaneio.id} FOR UPDATE`;
      await tx.romaneioItem.update({ where: { id: changedItem.id }, data: { quantity } });
      const updated = await tx.romaneio.findUniqueOrThrow({ where: { id: romaneio.id }, include });
      await syncRomaneioStockMovements(tx, updated, user);
    });
  }

  await edit(385);
  const afterEdit = await client.stockMovement.findMany({ where: { romaneioId: romaneio.id }, orderBy: { id: 'asc' } });
  assert.equal(afterEdit.length, 4);
  assert.deepEqual(afterEdit.find(row => row.id === unchanged.id), unchanged);
  assert.equal(afterEdit.filter(row => row.reason === 'ESTORNO').length, 1);
  assert.equal(afterEdit.find(row => row.reason === 'ESTORNO').reversalOfId, changed.id);
  assert.equal(afterEdit.filter(row => row.reason !== 'ESTORNO' && row.quantity.eq(385)).length, 1);
  assert.deepEqual(await getStockItemProjectActivity(client, changed.itemId), [
    { project: { id: project.id, code: project.code, name: project.name }, outbound: '385.000', inbound: '0.000', netOutbound: '385.000' }
  ]);
  const simplified = await listStockMovements(client, { itemId: changed.itemId, includeReversed: false });
  assert.equal(simplified.total, 2, 'only the purchase and corrected exit are active');
  assert.equal(simplified.movements[0].balanceAfter, '35.000');
  assert.equal(simplified.movements[0].romaneioEdit, true);
  const audit = await listStockMovements(client, { itemId: changed.itemId });
  assert.equal(audit.total, 4, 'audit history still includes the cancelled exit and its reversal');
  assert.equal(audit.movements[0].balanceAfter, '35.000');
  assert.equal(audit.movements.find(row => row.id === changed.id).reversedByRomaneioEdit, true);

  await edit(385);
  assert.deepEqual(await client.stockMovement.findMany({ where: { romaneioId: romaneio.id }, orderBy: { id: 'asc' } }), afterEdit);

  // Insufficient stock must roll back both the new reversal and the item edit.
  await assert.rejects(edit(421), /Saldo insuficiente/);
  assert.deepEqual(await client.stockMovement.findMany({ where: { romaneioId: romaneio.id }, orderBy: { id: 'asc' } }), afterEdit);
  assert.equal((await client.romaneioItem.findUniqueOrThrow({ where: { id: changedItem.id } })).quantity.toString(), '385');
});
