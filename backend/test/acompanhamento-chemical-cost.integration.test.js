import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import test from 'node:test';

test('PostgreSQL: projetos usam químicos do Omie até a primeira saída em romaneio e depois abatem devoluções', {
  skip: !process.env.CHEMICAL_COST_TEST_DATABASE_URL
}, async t => {
  const url = new URL(process.env.CHEMICAL_COST_TEST_DATABASE_URL);
  assert.match(url.hostname, /^(localhost|127\.0\.0\.1)$/);
  assert.ok(url.pathname.endsWith('_test') || (process.env.CI === 'true' && url.pathname === '/filtrovali'));
  process.env.DATABASE_URL = url.toString();
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { listCommercialDashboard } = await import('../src/lib/acompanhamento/access-import.js');
  const { getProjectDetail } = await import('../src/lib/acompanhamento/project-detail.js');
  const { listProjectCards } = await import('../src/lib/acompanhamento/project-cards.js');
  const { clearProjectDerivedCaches } = await import('../src/lib/resource-list-cache.js');
  const { createAutomaticRomaneioStockMovementsInTransaction } = await import('../src/lib/estoque/stock-movements.js');
  const suffix = randomUUID(), code = randomInt(1_000_000, 100_000_000);
  const categoryCode = `chemical-${suffix}`;
  let user, proposal, project, fallbackProject, item;
  t.after(async () => {
    if (item) {
      await prisma.stockMovement.deleteMany({ where: { itemId: item.id } });
      await prisma.stockBatch.deleteMany({ where: { itemId: item.id } });
      await prisma.stockItem.delete({ where: { id: item.id } });
    }
    for (const fixtureProject of [project, fallbackProject].filter(Boolean)) {
      await prisma.omiePurchase.deleteMany({ where: { projectId: fixtureProject.id } });
      await prisma.romaneio.deleteMany({ where: { projectId: fixtureProject.id } });
      await prisma.project.delete({ where: { id: fixtureProject.id } });
    }
    await prisma.omieCategory.deleteMany({ where: { codigo: categoryCode } });
    if (proposal) await prisma.commercialProposal.delete({ where: { id: proposal.id } });
    if (user) await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  });
  user = await prisma.user.create({ data: {
    username: suffix, name: 'Teste de custo químico', passwordHash: 'test-only', role: 'COLLABORATOR'
  } });
  proposal = await prisma.commercialProposal.create({ data: {
    codBd: code, codProp: code, salePrice: 2000, plannedCost: 1000, rawRow: {}, isComplete: true
  } });
  project = await prisma.project.create({ data: {
    code: String(code), name: 'Custo por consumo', clientName: 'Cliente', clientCnpj: '',
    contractCode: String(code), commercialProposalCode: String(code), location: ''
  } });
  fallbackProject = await prisma.project.create({ data: {
    code: `${code}-fallback`, name: 'Projeto sem saída de químicos', clientName: 'Cliente', clientCnpj: '',
    contractCode: String(code), commercialProposalCode: String(code), location: ''
  } });
  item = await prisma.stockItem.create({ data: {
    type: 'PRODUTO_QUIMICO', code: suffix, name: 'Químico teste', unitLabel: 'kg'
  } });
  const batch = await prisma.stockBatch.create({ data: {
    itemId: item.id, lotNumber: suffix, expiryDate: new Date('2030-01-01')
  } });
  const purchaseMovement = await prisma.stockMovement.create({ data: {
    itemId: item.id, batchId: batch.id, type: 'ENTRADA', reason: 'COMPRA',
    quantity: 100, unitCost: 12.5, date: new Date('2026-10-01'), createdById: user.id
  } });
  await prisma.omieCategory.create({ data: { codigo: categoryCode, descricao: 'PRODUTOS QUÍMICOS' } });
  const purchases = [
    { categoriaCodigo: categoryCode, categoriaDescricao: null, valor: 1250, statusTitulo: 'PAGO' },
    { categoriaCodigo: `legacy-${suffix}`, categoriaDescricao: 'Compra de produtos quimicos', valor: 500, statusTitulo: 'ABERTO' },
    { categoriaCodigo: null, categoriaDescricao: 'Químicos', valor: 200, statusTitulo: 'PAGO' },
    { categoriaCodigo: `hotel-${suffix}`, categoriaDescricao: 'Hospedagem', valor: 20, statusTitulo: 'PAGO' },
    { categoriaCodigo: `hotel-${suffix}`, categoriaDescricao: 'Hospedagem', valor: 30, statusTitulo: 'ABERTO' },
    { categoriaCodigo: null, categoriaDescricao: null, valor: 5, statusTitulo: 'PAGO' },
    { categoriaCodigo: `service-${suffix}`, categoriaDescricao: 'Limpeza química', valor: 45, statusTitulo: 'ABERTO' }
  ];
  await prisma.omiePurchase.createMany({ data: purchases.map((purchase, index) => ({
    ...purchase, projectId: project.id, omieId: `${suffix}-${index}`, rawPayload: {}
  })) });
  await prisma.omiePurchase.create({ data: {
    projectId: fallbackProject.id, omieId: `${suffix}-fallback`, categoriaCodigo: categoryCode,
    categoriaDescricao: 'Produtos químicos', valor: 333, statusTitulo: 'PAGO', rawPayload: {}
  } });

  const verifyViews = async (expectedStockCost, useOmieChemicals = false) => {
    const expectedOmie = useOmieChemicals ? 2050 : 100;
    const expectedPaid = useOmieChemicals ? 1475 : 25;
    const expectedPending = useOmieChemicals ? 575 : 75;
    clearProjectDerivedCaches();
    const rows = await listCommercialDashboard({ projectIds: [project.id, fallbackProject.id], includeProgress: false });
    const row = rows.find(row => row.projectId === project.id);
    const fallbackRow = rows.find(row => row.projectId === fallbackProject.id);
    assert.equal(Number(fallbackRow.realizedOmieCost), 333);
    assert.equal(Number(fallbackRow.realizedCost), 333);
    assert.equal(Number(row.realizedOmieCost), expectedOmie);
    assert.equal(Number(row.realizedPaid), expectedPaid);
    assert.equal(row.stockCost, expectedStockCost);
    assert.equal(Number(row.realizedCost), expectedOmie + expectedStockCost);
    const detail = await getProjectDetail(project.id);
    assert.equal(detail.consumo.omie, expectedOmie);
    assert.equal(detail.consumo.pago, expectedPaid);
    assert.equal(detail.consumo.previstoPagar, expectedPending);
    assert.equal(detail.consumo.estoque, expectedStockCost);
    assert.equal(detail.consumo.gasto, expectedOmie + expectedStockCost);
    assert.equal(detail.maioresGastos.find(cost => cost.categoria === 'Produtos químicos (estoque)')?.total ?? 0, expectedStockCost);
    const cards = await listProjectCards();
    const card = cards.find(row => row.projectId === project.id);
    assert.equal(cards.find(row => row.projectId === fallbackProject.id).realizedCost, 333);
    assert.equal(card.stockCost, expectedStockCost);
    assert.equal(card.realizedCost, expectedOmie + expectedStockCost);
  };
  const romaneio = async (type, quantity, excludeFromProjectCost = false) => {
    const document = await prisma.romaneio.create({ data: {
      projectId: project.id, type, romaneioDate: new Date('2026-10-02'),
      driverName: 'Motorista', vehiclePlate: 'TEST1234'
    } });
    await prisma.$transaction(tx => createAutomaticRomaneioStockMovementsInTransaction(tx, {
      romaneioType: type, itemId: item.id, quantity, date: '2026-10-02',
      projectId: project.id, createdById: user.id, romaneioId: document.id, excludeFromProjectCost
    }));
  };

  await verifyViews(0, true); // Sem saída, usa a despesa de químicos do Omie.
  await prisma.romaneio.create({ data: {
    projectId: project.id, type: 'OUTBOUND', romaneioDate: new Date('2026-10-02'),
    driverName: 'Motorista', vehiclePlate: 'TEST1234',
    items: { create: { itemName: 'Bomba', categoryName: 'Equipamentos', quantity: 1, unitLabel: 'un' } }
  } });
  await verifyViews(0, true); // Saída sem químicos não muda a fonte do custo.
  await romaneio('INBOUND', 1, true);
  await verifyViews(0, true); // Entrada extra não substitui uma saída de químicos.
  await prisma.stockMovement.update({ where: { id: purchaseMovement.id }, data: { unitCost: 0 } });
  await romaneio('OUTBOUND', 10);
  await verifyViews(0); // A saída já muda a fonte, mesmo com custo unitário zero.
  await prisma.stockMovement.update({ where: { id: purchaseMovement.id }, data: { unitCost: 12.5 } });
  await verifyViews(125); // 10 kg × R$ 12,50; compra de R$ 1.250 não é somada.
  await romaneio('INBOUND', 2);
  await verifyViews(100);
  await romaneio('INBOUND', 8);
  await verifyViews(0); // Devolução integral não faz voltar à despesa do Omie.
  assert.equal((await getProjectDetail(fallbackProject.id)).consumo.omie, 333);
});
