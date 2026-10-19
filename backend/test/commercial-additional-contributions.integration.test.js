import assert from 'node:assert/strict';
import test from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import prisma from '../src/lib/prisma.js';
import { receiveCommercialAppProposal, storeQueriedCommercialAppProposal, selectCommercialAppRevision } from '../src/lib/acompanhamento/comercialapp-bridge.js';
import { listCommercialDashboard, setProjectAdditionalProposalRevision, setProjectBudgetRevision } from '../src/lib/acompanhamento/access-import.js';
import { loadPlannedHours } from '../src/lib/acompanhamento/planned-hours.js';
import { getPlannedScope, setPlannedScope } from '../src/lib/acompanhamento/planned-scope.js';
import { commercialTransaction, lockCommercialProject, removeContribution, resolveContributionScope } from '../src/lib/acompanhamento/commercial-contributions.js';
import { loadProposalScopes } from '../src/lib/acompanhamento/proposal-scopes.js';
import { rawHours, additionalPayload } from './helpers/commercial-additional-fixture.js';
const databaseUrl = process.env.TEST_DATABASE_URL;
const conflict = error => error.status === 409;

test('contribuições v3: 120/125/130 mil, revisão/mãe/eventos, overrides, seleção e concorrência', { skip: !databaseUrl }, async t => {
  assert.equal(new URL(databaseUrl).pathname, '/filtroapp_bridge_test');
  assert.equal(process.env.DATABASE_URL, databaseUrl);
  const code = randomInt(10_000_000, 20_000_000), ids = [];
  const project = await prisma.project.create({ data: { code: `extra-${randomUUID()}`, name: 'Contribuições QA',
    clientName: 'Cliente QA', clientCnpj: '12345678000190', contractCode: String(code), commercialProposalCode: String(code), location: 'Sede' } });
  t.after(async () => {
    await prisma.commercialAppDelivery.deleteMany({ where: { externalId: { in: ids } } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.commercialProposal.deleteMany({ where: { codProp: code } });
    await prisma.$disconnect();
  });
  await prisma.commercialProposal.create({ data: { codBd: code, codProp: code, clientCnpj: '12345678000190',
    salePrice: 100_000, plannedCost: 60_000, expectedProfit: 40_000, rawRow: rawHours(1000), isComplete: true } });
  await setProjectBudgetRevision(project.id, code);
  const budget = () => prisma.projectBudget.findUnique({ where: { projectId_version: { projectId: project.id, version: 1 } } });
  const originalBudget = await budget();
  const manual = await prisma.projectPlannedService.create({ data: { projectId: project.id, serviceType: 'MANUAL',
    scopeName: 'Serviço manual', weight: 1 } });
  const make = (number, revision, sale) => { const payload = additionalPayload(project.id, code, number, revision, sale); ids.push(payload.proposalId); return payload; };
  const a0 = make(code + 1, 0, 20_000), a1 = make(code + 1, 1, 25_000), b0 = make(code + 2, 0, 5_000);
  const stage = payload => commercialTransaction(async tx => storeQueriedCommercialAppProposal(tx,
    await lockCommercialProject(tx, project.id), { ...payload, approvedAt: null, eventId: undefined }));
  assert.equal((await stage(a0)).budgetStatus, 'STAGED');
  assert.equal(await prisma.projectAdditionalProposal.count({ where: { projectId: project.id } }), 0);
  assert.equal((await prisma.commercialAppProposal.findUnique({ where: { externalId: a0.proposalId } })).approvedAt, null);
  const total = async (sale, cost, hours) => {
    const [row] = await listCommercialDashboard({ projectIds: [project.id], includeProgress: false });
    assert.equal(Number(row.salePrice), sale); assert.equal(Number(row.plannedTotalCost), cost);
    assert.equal(Number(row.expectedMargin), 40, 'margens não são somadas');
    assert.equal((await loadPlannedHours([project.id])).get(project.id).hoursPlan.commercial.total, hours);
    assert.equal((await budget()).id, originalBudget.id); assert.equal(Number((await budget()).salePrice), 100_000);
    assert.equal((await prisma.project.findUnique({ where: { id: project.id } })).commercialProposalCode, String(code));
  };
  const ack = await receiveCommercialAppProposal(a0);
  assert.deepEqual(Object.fromEntries(Object.entries(ack).filter(([key]) => key !== 'duplicate')), {
    contractVersion: 3, budgetStatus: 'SELECTED', proposalId: a0.proposalId, projectId: project.id,
    parentProposalCode: String(code), contributionKey: a0.contributionKey, budgetOperation: a0.budgetOperation
  });
  await total(120_000, 72_000, 1200);
  assert.equal((await receiveCommercialAppProposal(a0)).duplicate, true, 'perda de ACK retorna a confirmação persistida');
  assert.equal(await prisma.projectContributionEvent.count({ where: { projectId: project.id } }), 1);
  await assert.rejects(receiveCommercialAppProposal({ ...a0, salePrice: 99 }), conflict);
  await assert.rejects(receiveCommercialAppProposal({ ...a0, extraField: 'different' }), conflict);
  await assert.rejects(receiveCommercialAppProposal({ ...a0, eventId: randomUUID(), salePrice: 99 }), conflict);
  await assert.rejects(receiveCommercialAppProposal({ ...a0, eventId: randomUUID(), proposalId: 'different-revision-id' }), conflict);
  await receiveCommercialAppProposal(a1); await total(125_000, 75_000, 1250);
  await receiveCommercialAppProposal(b0); await total(130_000, 78_000, 1300);
  assert.equal((await receiveCommercialAppProposal({ ...a0, eventId: randomUUID() })).budgetStatus, 'STAGED');
  await Promise.all([receiveCommercialAppProposal(a1), receiveCommercialAppProposal(b0), receiveCommercialAppProposal(a1)]);
  await total(130_000, 78_000, 1300);
  const allMetrics = { plannedDays: true, workedDays: true, plannedCost: true, salePrice: true, expectedProfit: true, taxes: true, hours: true };
  const selectedA = await prisma.projectAdditionalProposal.findUnique({ where: { projectId_source_proposalCode: {
    projectId: project.id, source: 'COMERCIAL_APP', proposalCode: a0.proposalCode } } });
  await selectCommercialAppRevision(project.id, a1.proposalId, null, { expectedSelectionVersion: selectedA.selectionVersion,
    metricInclusion: { ...allMetrics, plannedCost: false, hours: false } });
  await total(130_000, 63_000, 1050);
  await selectCommercialAppRevision(project.id, a1.proposalId, null, { expectedSelectionVersion: selectedA.selectionVersion + 1,
    metricInclusion: allMetrics });
  await total(130_000, 78_000, 1300);
  const services = () => prisma.projectPlannedService.findMany({ where: { projectId: project.id }, include: { systems: true } });
  assert.equal((await services()).length, 3, 'mesmos títulos não deduplicam contribuições');
  assert.equal(await prisma.commercialProposalSyncJob.count({ where: { projectId: project.id } }), 2);
  await prisma.commercialProposal.create({ data: { codBd: code + 5, codProp: code, nRev: 2, clientCnpj: '12345678000190',
    salePrice: 100_000, plannedCost: 60_000, expectedProfit: 40_000, rawRow: rawHours(1000), isComplete: true } });
  await setProjectBudgetRevision(project.id, code + 5); await total(130_000, 78_000, 1300);
  const scope = await getPlannedScope(project.id);
  await setPlannedScope(project.id, { contributionsFingerprint: scope.contributionsFingerprint,
    services: scope.services.map(service => ({ ...service, weight: Number(service.weight),
      systems: service.systems.map(row => ({ ...row, quantity: service.contributionKey === a1.contributionKey ? 99 : Number(row.quantity) })) })) });
  const a2 = make(code + 1, 2, 30_000), b1 = make(code + 2, 1, 6_000);
  await Promise.all([receiveCommercialAppProposal(a2), receiveCommercialAppProposal(b1)]);
  assert.equal(Number((await services()).find(row => row.contributionKey === a2.contributionKey).systems[0].quantity), 99);
  assert.equal(Number((await services()).find(row => row.contributionKey === b1.contributionKey).systems[0].quantity), 6);
  assert.equal((await services()).some(row => row.id === manual.id && row.contributionKey === null), true);
  let chosenA = await prisma.projectAdditionalProposal.findUnique({ where: { projectId_source_proposalCode: {
    projectId: project.id, source: 'COMERCIAL_APP', proposalCode: a0.proposalCode } } });
  await resolveContributionScope(project.id, a0.proposalCode, { expectedSelectionVersion: chosenA.selectionVersion,
    choice: 'COMMERCIAL', reason: 'Quantitativos do adicional conferidos' });
  assert.equal(Number((await services()).find(row => row.contributionKey === a0.contributionKey).systems[0].quantity), 30);
  assert.equal(Number((await services()).find(row => row.contributionKey === b0.contributionKey).systems[0].quantity), 6);
  chosenA = await prisma.projectAdditionalProposal.findUnique({ where: { id: chosenA.id } });
  await resolveContributionScope(project.id, a0.proposalCode, { expectedSelectionVersion: chosenA.selectionVersion,
    choice: 'MANUAL', reason: 'Escopo operacional conferido' });
  await assert.rejects(selectCommercialAppRevision(project.id, a0.proposalId, null), conflict);
  const selection = () => prisma.projectAdditionalProposal.findUnique({ where: { projectId_source_proposalCode: {
    projectId: project.id, source: 'COMERCIAL_APP', proposalCode: a0.proposalCode } } });
  const current = await selection();
  await assert.rejects(selectCommercialAppRevision(project.id, a0.proposalId, null,
    { expectedSelectionVersion: current.selectionVersion }), conflict);
  await selectCommercialAppRevision(project.id, a0.proposalId, null, { expectedSelectionVersion: current.selectionVersion,
    allowOlderRevision: true, reason: 'Revisão conferida pela gestão' });
  await assert.rejects(selectCommercialAppRevision(project.id, a2.proposalId, null,
    { expectedSelectionVersion: current.selectionVersion }), conflict);
  // Uma aprovação antiga de revisão superior não desfaz a escolha manual mais recente.
  assert.equal((await receiveCommercialAppProposal({ ...a2, eventId: randomUUID() })).budgetStatus, 'STAGED');
  const selected = await selection();
  await removeContribution(project.id, 'COMERCIAL_APP', a0.proposalCode,
    { expectedSelectionVersion: selected.selectionVersion, reason: 'Remoção operacional conferida' });
  assert.equal((await receiveCommercialAppProposal({ ...a2, eventId: randomUUID() })).budgetStatus, 'STAGED');
  assert.equal((await selection()).active, false);
  assert.equal((await services()).some(row => row.contributionKey === a0.contributionKey), true, 'override manual preservado');
  await t.test('retirar e reativar a mesma revisão reconstrói o escopo automático sem alterar outras contribuições', async () => {
    await selectCommercialAppRevision(project.id, a2.proposalId, null, { expectedSelectionVersion: (await selection()).selectionVersion });
    await resolveContributionScope(project.id, a0.proposalCode, { expectedSelectionVersion: (await selection()).selectionVersion,
      choice: 'COMMERCIAL', reason: 'Restaurar quantitativos comerciais antes da retirada' });
    const otherIds = async () => (await services()).filter(row => row.contributionKey !== a2.contributionKey).map(row => row.id).sort();
    const preserved = await otherIds();
    await removeContribution(project.id, 'COMERCIAL_APP', a2.proposalCode,
      { expectedSelectionVersion: (await selection()).selectionVersion, reason: 'Retirada explícita do escopo automático' });
    assert.equal((await services()).some(row => row.contributionKey === a2.contributionKey), false);
    await selectCommercialAppRevision(project.id, a2.proposalId, null, { expectedSelectionVersion: (await selection()).selectionVersion });
    const restored = (await services()).find(row => row.contributionKey === a2.contributionKey);
    assert.ok(restored, 'o histórico da importação não substitui as metas removidas');
    assert.equal(Number(restored.systems[0].quantity), 30);
    assert.deepEqual(await otherIds(), preserved);
    await total(136_000, 81_600, 1360);
    const restoredId = restored.id;
    await selectCommercialAppRevision(project.id, a2.proposalId, null, { expectedSelectionVersion: (await selection()).selectionVersion });
    assert.equal((await services()).find(row => row.contributionKey === a2.contributionKey).id, restoredId, 'repetir a seleção permanece idempotente');
  });
});

test('fontes mistas e mãe ausente: principal ComercialAPP + adicional Access; legado permanece staged', { skip: !databaseUrl }, async t => {
  const code = randomInt(30_000_000, 40_000_000), projects = [], ids = [];
  t.after(async () => {
    await prisma.commercialAppDelivery.deleteMany({ where: { externalId: { in: ids } } });
    await prisma.project.deleteMany({ where: { id: { in: projects.map(p => p.id) } } });
    await prisma.commercialProposal.deleteMany({ where: { codProp: { in: [code + 1, code + 20] } } });
    await prisma.$disconnect();
  });
  for (let i = 0; i < 2; i++) projects.push(await prisma.project.create({ data: { code: `mixed-${randomUUID()}`,
    name: 'QA', clientName: 'QA', clientCnpj: '12345678000190', contractCode: String(code), location: 'QA' } }));
  const main = additionalPayload(projects[0].id, code - 1, code, 0, 100_000);
  for (const key of ['proposalKind', 'parentProposalCode', 'additionalProposalId', 'sourceProposalId', 'sourceRevisionNumber',
    'contributionKey', 'budgetOperation', 'documents', 'documentsReference', 'prismaProjectId']) delete main[key];
  main.contractVersion = 1; ids.push(main.proposalId); await receiveCommercialAppProposal(main);
  await prisma.commercialProposal.create({ data: { codBd: code + 1, codProp: code + 1, parentCodProp: code,
    clientCnpj: '12345678000190', salePrice: 20_000, plannedCost: 12_000, expectedProfit: 8000, rawRow: rawHours(200), isComplete: true } });
  await setProjectAdditionalProposalRevision(projects[0].id, code + 1);
  const [row] = await listCommercialDashboard({ projectIds: [projects[0].id], includeProgress: false });
  assert.equal(Number(row.salePrice), 120_000); assert.equal(Number(row.plannedTotalCost), 72_000);
  assert.equal((await loadPlannedHours([projects[0].id])).get(projects[0].id).hoursPlan.commercial.total, 1200);
  const context = await loadProposalScopes(projects[0].id);
  assert.equal(context.main.key, `COMERCIAL_APP:${code}`);
  assert.equal(context.main.revision, 0);
  assert.equal(context.options.find(option => option.kind === 'ADDITIONAL').key, `ACCESS_IMPORT:${code + 1}`);
  const oldScope = await getPlannedScope(projects[0].id);
  const mainServices = await prisma.projectPlannedService.findMany({ where: { projectId: projects[0].id } });
  await setPlannedScope(projects[0].id, { contributionsFingerprint: oldScope.contributionsFingerprint,
    services: [...oldScope.services, { contributionKey: `ACCESS_IMPORT:${code + 1}`, scopeName: 'Escopo independente Access', serviceType: 'LIMPEZA_QUIMICA', weight: 100, systems: [] }] });
  for (const service of mainServices) assert.ok(await prisma.projectPlannedService.findUnique({ where: { id: service.id } }), 'escopo da principal preservado');
  assert.equal((await prisma.projectAdditionalProposal.findFirst({ where: { projectId: projects[0].id } })).scopeImport.status, 'MANUAL_OVERRIDE');

  const sameNumberOtherOrigin = additionalPayload(projects[0].id, code, code + 1); ids.push(sameNumberOtherOrigin.proposalId);
  await assert.rejects(receiveCommercialAppProposal(sameNumberOtherOrigin), conflict);
  const unresolved = additionalPayload(projects[1].id, code + 20, code + 21); ids.push(unresolved.proposalId);
  assert.equal((await receiveCommercialAppProposal(unresolved)).budgetStatus, 'STAGED');
  assert.equal(await prisma.projectBudget.count({ where: { projectId: projects[1].id } }), 0);
  assert.equal(await prisma.projectAdditionalProposal.count({ where: { projectId: projects[1].id } }), 0);
  assert.equal(await prisma.commercialProposal.count({ where: { codProp: code + 20 } }), 0);
  await assert.rejects(receiveCommercialAppProposal({ ...unresolved, projectId: 'prisma-is-not-a-filtro-project',
    eventId: randomUUID() }), error => error.status === 422);
  const wrongMother = additionalPayload(projects[0].id, code + 99, code + 31); ids.push(wrongMother.proposalId);
  await assert.rejects(receiveCommercialAppProposal(wrongMother), error => error.status === 422);
  await prisma.commercialProposal.create({ data: { codBd: code + 20, codProp: code + 20, clientCnpj: '12345678000190',
    salePrice: 100_000, plannedCost: 60_000, rawRow: rawHours(1000), isComplete: true } });
  await prisma.project.update({ where: { id: projects[1].id }, data: { contractCode: String(code + 20), commercialProposalCode: String(code + 20) } });
  await setProjectBudgetRevision(projects[1].id, code + 20);
  await selectCommercialAppRevision(projects[1].id, unresolved.proposalId, null, { expectedSelectionVersion: 0 });
  const eventsBeforeAck = await prisma.projectContributionEvent.count({ where: { projectId: projects[1].id } });
  assert.equal((await receiveCommercialAppProposal(unresolved)).budgetStatus, 'SELECTED', 'reenvio STAGED reconhece seleção manual sem reaplicar');
  assert.equal(await prisma.projectContributionEvent.count({ where: { projectId: projects[1].id } }), eventsBeforeAck);
  await assert.rejects(receiveCommercialAppProposal({ ...unresolved, client: { ...unresolved.client, cnpj: '98765432000199' },
    eventId: randomUUID() }), error => [409, 422].includes(error.status));
});
