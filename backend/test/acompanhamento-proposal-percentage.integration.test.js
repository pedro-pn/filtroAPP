import assert from 'node:assert/strict';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import test from 'node:test';

test('HTTP + PostgreSQL: percentual individual ajusta todos os previstos, cronograma, revisões e projetos mesclados', {
  skip: !process.env.PROPOSAL_PERCENTAGE_TEST_DATABASE_URL
}, async t => {
  const url = new URL(process.env.PROPOSAL_PERCENTAGE_TEST_DATABASE_URL);
  assert.match(url.hostname, /^(localhost|127\.0\.0\.1)$/);
  assert.ok(url.pathname.endsWith('_test') || (process.env.CI === 'true' && url.pathname === '/filtrovali'));
  process.env.DATABASE_URL = url.toString();
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const { listCommercialDashboard } = await import('../src/lib/acompanhamento/access-import.js');
  const { computeProjectProgressDetails } = await import('../src/lib/acompanhamento/avanco.js');
  const { getProjectDetail } = await import('../src/lib/acompanhamento/project-detail.js');
  const { clearProjectDerivedCaches } = await import('../src/lib/resource-list-cache.js');
  const suffix = randomUUID(), code = randomInt(1_000_000, 100_000_000);
  const users = [], projects = [], proposals = [];
  let server, group;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (group) await prisma.acompanhamentoMissionGroup.delete({ where: { id: group.id } });
    await prisma.project.deleteMany({ where: { id: { in: projects.map(project => project.id) } } });
    await prisma.commercialProposal.deleteMany({ where: { id: { in: proposals.map(proposal => proposal.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    await prisma.$disconnect();
  });
  for (const role of ['ACOMPANHAMENTO_MANAGER', 'ACOMPANHAMENTO_VIEWER']) users.push(await prisma.user.create({ data: {
    username: `${role}-${suffix}`, name: role, passwordHash: 'test-only', role: 'COLLABORATOR', accountType: 'INTERNAL',
    moduleRoles: { create: { module: 'ACOMPANHAMENTO', role } }
  } }));
  const tokens = users.map(() => randomUUID());
  await prisma.userSession.createMany({ data: users.map((user, index) => ({ userId: user.id,
    tokenHash: createHash('sha256').update(tokens[index]).digest('hex'), expiresAt: new Date(Date.now() + 600_000) })) });
  const rawHours = (normal, extra) => ({ hh_total: normal + extra, hh_util_diurno: normal, hh_util_noturno: 0,
    hh_util_extra_diurno: extra, hh_util_extra_noturno: 0, hh_sab_diurno: 0, hh_sab_noturno: 0, hh_dom_diurno: 0, hh_dom_noturno: 0 });
  proposals.push(await prisma.commercialProposal.create({ data: { codBd: code, codProp: code, salePrice: 150000,
    plannedCost: 80000, expectedProfit: 70000, taxes: 10000, plannedDays: 20, workedDays: 16,
    rawRow: rawHours(100, 20), components: { he: 1000 }, isComplete: true } }));
  proposals.push(await prisma.commercialProposal.create({ data: { codBd: code + 1, codProp: code + 1, parentCodProp: code,
    salePrice: 30000, plannedCost: 20000, expectedProfit: 10000, taxes: 2000, plannedDays: 4, workedDays: 4,
    rawRow: rawHours(50, 10), isComplete: true } }));
  for (let index = 0; index < 2; index++) projects.push(await prisma.project.create({ data: {
    code: `percentage-${index}-${suffix}`, name: `Percentual ${index}`, clientName: 'Cliente teste', clientCnpj: '',
    contractCode: String(code), location: '', commercialProposalCode: String(code),
    budgets: { create: { sourceProposalCodBd: code, plannedTotalCost: 80000, salePrice: 150000 } },
    additionalProposals: { create: { codProp: code + 1, sourceProposalCodBd: code + 1 } },
    plannedServices: { create: { serviceType: 'FLUSHING', scopeName: 'Escopo teste', weight: 100,
      systems: { create: { systemType: 'OLEO', quantity: 200, unit: 'L' } } } }
  } }));
  group = await prisma.acompanhamentoMissionGroup.create({ data: { name: `Percentual ${suffix}`,
    members: { create: projects.map((project, order) => ({ projectId: project.id, activeProjectId: project.id, order })) } } });
  await prisma.projectManualCost.create({ data: { projectId: projects[0].id, description: 'Custo realizado', amount: 60000 } });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = '/api/acompanhamento/comercial';
  const request = async (path, body, userIndex = 0, method = body ? 'PATCH' : 'GET') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${base}${path}`, {
      method, headers: { authorization: `Bearer ${tokens[userIndex]}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  };
  const detail = async id => { const result = await request(`/projetos/${id}/detalhe`);
    assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
  const save = (id, percentage, user = 0) => request(`/projetos/${id}/cronograma`, { proposalPercentage: percentage }, user);
  const first = projects[0].id, second = projects[1].id;
  const before = await detail(first); // aquece os caches para conferir a invalidação após salvar
  assert.equal(before.consumo.previsto, 100000);
  assert.equal(before.workedHours.plannedTotalHours, 180);
  assert.equal((await save(first, 50, 1)).status, 403);
  for (const value of [-1, 101, null, '50', 12.345]) assert.equal((await save(first, value)).status, 400);
  assert.equal((await save('inexistente', 50)).status, 404);
  assert.equal((await save(first, 50)).status, 200);
  const adjusted = await detail(first);
  assert.equal(adjusted.proposalPercentage, 50);
  assert.equal(adjusted.consumo.previsto, 50000);
  assert.equal(adjusted.consumo.previstoIntegral, 100000);
  assert.equal(adjusted.consumo.gasto, 60000);
  assert.equal(adjusted.consumo.pct, 120);
  assert.equal(Number(adjusted.faturamento.previsto), 90000);
  assert.equal(adjusted.diasCorridos.planned, 12);
  assert.equal(adjusted.diasTrabalhados.planned, 10);
  assert.equal(adjusted.diasTrabalhados.worked, before.diasTrabalhados.worked);
  assert.equal(adjusted.workedHours.plannedNormalHours, 75);
  assert.equal(adjusted.workedHours.plannedOvertimeHours, 15);
  assert.equal(adjusted.workedHours.totalWorkedHours, before.workedHours.totalWorkedHours);
  assert.ok(adjusted.alerts.some(alert => alert.code === 'CUSTO' && alert.level === 'danger'));
  const schedule = await request(`/projetos/${first}/revisoes`);
  assert.equal(schedule.status, 200);
  assert.equal(schedule.data.proposalPercentage, 50);
  const scope = await request(`/projetos/${first}/escopo-previsto`);
  assert.equal(Number(scope.data.normalHours[0].hours), 150, 'cadastro conserva horas integrais');
  assert.equal(Number(scope.data.services[0].systems[0].quantity), 200, 'cadastro conserva quantitativo integral');
  assert.equal(Number((await computeProjectProgressDetails(first)).plannedServices[0].systems[0].quantity), 100);
  const division = { key: JSON.stringify(['SCOPE', 'Escopo teste', null]), startDate: '2026-09-01', endDate: '2026-09-30',
    plannedCost: 40000, plannedRevenue: 60000, plannedHours: 80, plannedDays: 10 };
  const divided = await getProjectDetail(first, { division });
  assert.equal(divided.consumo.previsto, 20000);
  assert.equal(Number(divided.faturamento.previsto), 30000);
  assert.equal(divided.workedHours.plannedTotalHours, 40);
  assert.equal(divided.diasCorridos.planned, 5);
  assert.equal(divided.division.plannedCost, 40000, 'metas da divisão permanecem integrais para edição');
  assert.equal((await detail(second)).consumo.previsto, 100000, 'missão mesclada mantém percentual independente');
  assert.equal((await save(second, 25)).status, 200);
  const merged = await request(`/grupos-missoes/${group.id}/detalhe`);
  assert.equal(merged.status, 200, JSON.stringify(merged.data));
  assert.equal(merged.data.consumo.previsto, 75000);
  assert.equal(merged.data.consumo.previstoIntegral, 200000);
  assert.equal(Number(merged.data.faturamento.previsto), 135000);
  assert.equal(merged.data.diasCorridos.planned, 18);
  assert.equal(merged.data.workedHours.plannedTotalHours, 135);
  assert.deepEqual(merged.data.group.members.map(member => member.proposalPercentage), [50, 25]);
  const cards = await request('/projetos-cards');
  assert.equal(cards.status, 200, JSON.stringify(cards.data));
  assert.equal(cards.data.find(card => card.groupId === group.id).plannedCost, 75000);
  const rows = await listCommercialDashboard({ projectIds: [first], includeProgress: false });
  assert.equal(rows[0].expectedProfit, 40000);
  assert.equal(rows[0].taxes, 6000);
  assert.equal(rows[0].components.he, 500);
  assert.equal(rows[0].budgetBreakdown.totals.plannedTotalCost, 100000);
  assert.equal((await save(first, 100)).status, 200);
  assert.equal((await detail(first)).workedHours.plannedTotalHours, 180);
  assert.equal((await save(first, 0)).status, 200);
  const zero = await detail(first);
  assert.equal(zero.consumo.previsto, 0);
  assert.equal(zero.consumo.pct, null);
  assert.equal(Number(zero.faturamento.previsto), 0);
  assert.equal(zero.diasCorridos.planned, 0);
  assert.equal(zero.workedHours.plannedTotalHours, 0);
  assert.equal(zero.consumo.gasto, 60000);
  assert.ok(zero.alerts.some(alert => alert.code === 'CUSTO' && alert.level === 'danger'));
  assert.equal((await save(second, 0)).status, 200);
  const zeroGroup = await request(`/grupos-missoes/${group.id}/detalhe`);
  assert.equal(zeroGroup.data.workedHours.plannedTotalHours, 0);
  assert.equal((await save(first, 50)).status, 200);
  await prisma.projectBudget.update({ where: { projectId_version: { projectId: first, version: 1 } }, data: { plannedTotalCost: 100000 } });
  await prisma.commercialProposal.update({ where: { codBd: code }, data: { rawRow: rawHours(200, 40) } });
  clearProjectDerivedCaches();
  const revised = await detail(first);
  assert.equal(revised.consumo.previsto, 60000, 'percentual incide sobre a nova base integral');
  assert.equal(revised.workedHours.plannedTotalHours, 150);
  assert.equal(Number((await prisma.projectBudget.findUnique({ where: { projectId_version: { projectId: first, version: 1 } } })).plannedTotalCost), 100000);
  const appProject = await prisma.project.create({ data: { code: `percentage-app-${suffix}`, name: 'ComercialAPP',
    clientName: 'Cliente teste', clientCnpj: '', contractCode: String(code + 2), location: '' } });
  projects.push(appProject);
  const externalId = `app-${suffix}`;
  await prisma.commercialAppProposal.create({ data: { externalId, projectId: appProject.id, proposalCode: String(code + 2),
    revisionNumber: 1, approvedAt: new Date(), clientName: 'Cliente teste', clientCnpj: '', title: 'ComercialAPP', site: '',
    salePrice: 140000, plannedTotalCost: 70000, snapshotHash: suffix, selectionStatus: 'SELECTED',
    snapshot: { estimateSummary: { hours: { normal: 120, overtime: 30, total: 150 } } } } });
  await prisma.projectBudget.create({ data: { projectId: appProject.id, source: 'COMERCIAL_APP', commercialAppProposalId: externalId,
    salePrice: 140000, plannedTotalCost: 70000 } });
  assert.equal((await save(appProject.id, 50)).status, 200);
  const appDetail = await detail(appProject.id);
  assert.equal(appDetail.consumo.previsto, 35000);
  assert.equal(Number(appDetail.faturamento.previsto), 70000);
  assert.equal(appDetail.workedHours.plannedTotalHours, 75);
});
