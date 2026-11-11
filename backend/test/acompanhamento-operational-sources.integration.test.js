import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { seedHttpPerformanceFixture } from '../scripts/fixtures/http-performance.js';
import { assertLocalPerformanceDatabase } from '../scripts/lib/http-performance-report.js';
import { captureLaborQueries } from '../scripts/fixtures/labor-query-profile.js';

test('PostgreSQL: operational cost sources preserve equipment, stock, divisions and visibility', {
  skip: !process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL
}, async t => {
  assertLocalPerformanceDatabase(process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL);
  process.env.DATABASE_URL = process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL;
  const { default: db } = await import('../src/lib/prisma.js');
  const { getEquipmentUsageByProject } = await import('../src/lib/acompanhamento/equipment-usage.js');
  const { getStockConsumptionCostByProject } = await import('../src/lib/acompanhamento/stock-cost.js');
  const { withProjectAccess } = await import('../src/lib/projects/access-scope.js');
  const { requestSourceContext } = await import('../src/lib/operations/request-sources.js');
  const { purchaseStatusTotals } = await import('../src/lib/acompanhamento/purchase-status-totals.js');
  let fixture;
  t.after(async () => {
    if (fixture) {
      const own = { startsWith: fixture.prefix + '-operational-' };
      await db.omiePurchase.deleteMany({ where: { omieId: own } });
      await db.stockMovement.deleteMany({ where: { id: own } });
      await db.stockBatch.deleteMany({ where: { id: own } });
      await db.stockItem.deleteMany({ where: { id: own } });
      await db.romaneio.deleteMany({ where: { id: own } });
      await db.romaneioCatalogItem.deleteMany({ where: { id: own } });
      await fixture.cleanup();
    }
    await db.$disconnect();
  });
  fixture = await seedHttpPerformanceFixture(db, { reportCount: 10, scopeCount: 1 });
  const id = suffix => fixture.prefix + '-operational-' + suffix;
  const date = value => new Date(value + 'T00:00:00.000Z');
  await db.romaneioCatalogItem.createMany({ data: [
    { id: id('equipment'), sourceType: 'EQUIPAMENTOS', sourceId: id('registered'), code: 'TAG 01', name: 'Filtro', categoryName: id('category') },
    { id: id('fallback'), sourceType: 'EQUIPAMENTOS', code: null, name: 'Sem cadastro nominal', categoryName: id('category') },
    { id: id('manual'), sourceType: 'MANUAL', name: 'Manual excluído', categoryName: id('category') }
  ] });
  for (const [suffix, projectId, type, day] of [
    ['early', fixture.projectIds[0], 'OUTBOUND', '2026-09-01'],
    ['later', fixture.projectIds[0], 'OUTBOUND', '2026-09-10'],
    ['return', fixture.projectIds[0], 'INBOUND', '2026-08-01'],
    ['hidden', fixture.projectIds[2], 'OUTBOUND', '2026-08-02']
  ]) {
    await db.romaneio.create({ data: { id: id(suffix), projectId, type, romaneioDate: date(day), driverName: 'Sintético', vehiclePlate: 'TESTE',
      items: { create: [{ catalogItemId: id('equipment'), itemCode: 'OLD', itemName: 'Histórico', categoryName: id('category'), quantity: 1, unitLabel: 'unidade' },
        ...(suffix === 'later' ? [
          { catalogItemId: id('fallback'), itemCode: 'OLD 02', itemName: 'Histórico sem identidade', categoryName: id('category'), quantity: 1, unitLabel: 'unidade' },
          { catalogItemId: id('manual'), itemCode: 'MANUAL', itemName: 'Manual excluído', categoryName: id('category'), quantity: 1, unitLabel: 'unidade' }
        ] : [])] }
    } });
  }
  for (const [suffix, type] of [['chemical', 'PRODUTO_QUIMICO'], ['filter', 'FILTRO']]) {
    await db.stockItem.create({ data: { id: id(suffix), code: id(suffix), type, name: 'Sintético', unitLabel: 'unidade' } });
    await db.stockBatch.create({ data: { id: id(suffix + '-batch'), itemId: id(suffix), lotNumber: id(suffix) } });
  }
  await db.stockMovement.createMany({ data: [
    ['consumption', 'chemical', fixture.projectIds[0], 'SAIDA', 'USO_EM_PROJETO', 5, 10, '2026-09-01'],
    ['refund', 'chemical', fixture.projectIds[0], 'ENTRADA', 'DEVOLUCAO_OBRA', 1, 10, '2026-09-10'],
    ['filter-cost', 'filter', fixture.projectIds[0], 'SAIDA', 'USO_EM_PROJETO', 2, 1.25, '2026-09-02'],
    ['private-cost', 'chemical', fixture.projectIds[2], 'SAIDA', 'USO_EM_PROJETO', 9, 10, '2026-09-01']
  ].map(([suffix, item, projectId, type, reason, quantity, unitCost, day]) => ({
    id: id(suffix), itemId: id(item), batchId: id(item + '-batch'), projectId, type, reason, quantity, unitCost,
    date: date(day), createdById: fixture.prefix + '-admin'
  })) });
  const read = (accountType, load) => withProjectAccess({ accountType }, () => requestSourceContext({ method: 'GET' }, null, load));
  const expectedEquipment = [
    { code: 'TAG 01', name: 'Filtro', sinceDate: date('2026-09-01') },
    { code: 'OLD 02', name: 'Sem cadastro nominal', sinceDate: date('2026-09-10') }
  ];
  const admin = await read('ADMIN', () => getEquipmentUsageByProject(fixture.projectIds));
  assert.deepEqual(admin.get(fixture.projectIds[0]), expectedEquipment);
  assert.deepEqual(admin.get(fixture.projectIds[2]), [{ code: 'TAG 01', name: 'Filtro', sinceDate: date('2026-08-02') }]);
  const viewer = await read('INTERNAL', () => getEquipmentUsageByProject(fixture.projectIds));
  assert.deepEqual(viewer.get(fixture.projectIds[0]), expectedEquipment);
  assert.equal(viewer.has(fixture.projectIds[2]), false);
  const costs = await read('INTERNAL', () => getStockConsumptionCostByProject(fixture.projectIds));
  assert.deepEqual(costs.get(fixture.projectIds[0]), { total: 42.5, categories: [
    { categoria: 'Produtos químicos (estoque)', total: 40 }, { categoria: 'Filtros (estoque)', total: 2.5 }
  ] });
  assert.equal(costs.has(fixture.projectIds[2]), false);
  const division = await read('INTERNAL', () => getStockConsumptionCostByProject(fixture.projectIds, db,
    { startDate: '2026-09-01', endDate: '2026-09-05' }));
  assert.equal(division.get(fixture.projectIds[0]).total, 52.5);
  assert.equal((await read('ADMIN', () => getStockConsumptionCostByProject(fixture.projectIds))).get(fixture.projectIds[2]).total, 90);
  await db.stockMovement.update({ where: { id: id('consumption') }, data: { unitCost: 20 } });
  assert.equal((await read('INTERNAL', () => getStockConsumptionCostByProject(fixture.projectIds))).get(fixture.projectIds[0]).total, 92.5);
  await db.omiePurchase.createMany({ data: [
    [0, 'PAGO', '1.10'], [0, 'PAGO', '2.20'], [0, 'ABERTO', '3.30'], [0, 'AJUSTE', '-1.00'],
    [0, null, null], [1, 'ABERTO', null], [2, 'PAGO', '999999999999.99']
  ].map(([project, statusTitulo, valor], index) => ({
    omieId: id('purchase-' + index), projectId: fixture.projectIds[project], statusTitulo, valor, rawPayload: {}
  })) });
  for (const accountType of ['ADMIN', 'INTERNAL']) await withProjectAccess({ accountType }, async () => {
    const where = { projectId: { in: fixture.projectIds } };
    const originalTotal = await db.omiePurchase.groupBy({ by: ['projectId'], where, _sum: { valor: true } });
    const originalPaid = await db.omiePurchase.groupBy({ by: ['projectId'], where: { ...where, statusTitulo: 'PAGO' }, _sum: { valor: true } });
    const grouped = await db.omiePurchase.groupBy({ by: ['projectId', 'statusTitulo'], where, _sum: { valor: true } });
    const result = purchaseStatusTotals(grouped);
    assert.deepEqual(result.totalByProject, new Map(originalTotal.map(row => [row.projectId, row._sum.valor])));
    assert.deepEqual(result.paidByProject, new Map(originalPaid.map(row => [row.projectId, row._sum.valor])));
    assert.equal(result.totalByProject.get(fixture.projectIds[0]).toFixed(2), '5.60');
    assert.equal(result.totalByProject.get(fixture.projectIds[1]), null);
    assert.equal(result.totalByProject.has(fixture.projectIds[2]), accountType === 'ADMIN');
  });
  const profile = captureLaborQueries();
  try {
    const started = performance.now();
    assert.deepEqual(await getStockConsumptionCostByProject([fixture.projectIds[1]]), new Map());
    assert.deepEqual(await getEquipmentUsageByProject([fixture.projectIds[1]]), new Map());
    assert.equal((await profile.finish(started)).length, 2, 'Empty sources issue only their two parent reads');
  } finally { profile.restore(); }
});
