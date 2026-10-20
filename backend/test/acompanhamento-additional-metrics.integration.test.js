import assert from 'node:assert/strict';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import test from 'node:test';

test('HTTP + PostgreSQL: contribuição por campo persiste por adicional e atualiza as métricas de todas as telas', {
  skip: !process.env.ADDITIONAL_METRICS_TEST_DATABASE_URL
}, async t => {
  const url = new URL(process.env.ADDITIONAL_METRICS_TEST_DATABASE_URL);
  assert.match(url.hostname, /^(localhost|127\.0\.0\.1)$/);
  assert.ok(url.pathname.endsWith('_test') || (process.env.CI === 'true' && url.pathname === '/filtrovali'));
  process.env.DATABASE_URL = url.toString();
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const { listCommercialDashboard } = await import('../src/lib/acompanhamento/access-import.js');
  const { ADDITIONAL_PROPOSAL_METRICS, normalizeAdditionalMetricInclusion } = await import('../../shared/modules/additional-proposal-metrics.js');
  const suffix = randomUUID(), code = randomInt(1_000_000, 100_000_000);
  const users = [], proposals = [];
  let project, group, server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (group) await prisma.acompanhamentoMissionGroup.delete({ where: { id: group.id } });
    if (project) await prisma.project.delete({ where: { id: project.id } });
    await prisma.commercialProposal.deleteMany({ where: { id: { in: proposals.map(row => row.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(row => row.id) } } });
    await prisma.$disconnect();
  });
  for (const role of ['ACOMPANHAMENTO_MANAGER', 'ACOMPANHAMENTO_VIEWER']) users.push(await prisma.user.create({ data: {
    username: `${role}-${suffix}`, name: role, passwordHash: 'test-only', role: 'COLLABORATOR', accountType: 'INTERNAL',
    moduleRoles: { create: { module: 'ACOMPANHAMENTO', role } }
  } }));
  const tokens = users.map(() => randomUUID());
  await prisma.userSession.createMany({ data: users.map((user, index) => ({ userId: user.id,
    tokenHash: createHash('sha256').update(tokens[index]).digest('hex'), expiresAt: new Date(Date.now() + 600_000) })) });
  const raw = (normal, extra) => ({ hh_total: normal + extra, hh_util_diurno: normal, hh_util_noturno: 0,
    hh_util_extra_diurno: extra, hh_util_extra_noturno: 0, hh_sab_diurno: 0, hh_sab_noturno: 0, hh_dom_diurno: 0, hh_dom_noturno: 0 });
  const base = { salePrice: 1000, plannedCost: 600, expectedProfit: 400, taxes: 100, plannedDays: 10,
    workedDays: 8, components: { mo: 600 }, rawRow: raw(100, 20), isComplete: true };
  for (const data of [
    { ...base, codBd: code, codProp: code },
    { ...base, codBd: code + 1, codProp: code + 1, parentCodProp: code, salePrice: 500, plannedCost: 300,
      expectedProfit: 200, taxes: 50, plannedDays: 5, workedDays: 4, components: { mo: 300 }, rawRow: raw(50, 10) },
    { ...base, codBd: code + 2, codProp: code + 1, parentCodProp: code, nRev: 1 },
    { ...base, codBd: code + 3, codProp: code + 3, parentCodProp: code }
  ]) proposals.push(await prisma.commercialProposal.create({ data }));
  project = await prisma.project.create({ data: { code: `metrics-${suffix}`, name: 'Contribuições', clientName: 'Cliente',
    clientCnpj: '', contractCode: String(code), commercialProposalCode: String(code), location: '',
    budgets: { create: { sourceProposalCodBd: code, salePrice: 1000, plannedTotalCost: 600 } },
    additionalProposals: { create: { codProp: code + 1, sourceProposalCodBd: code + 1 } }
  } });
  group = await prisma.acompanhamentoMissionGroup.create({ data: { name: `Metrics ${suffix}`,
    members: { create: { projectId: project.id, activeProjectId: project.id, order: 0 } } } });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const request = async (path, body, user = 0, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/acompanhamento/comercial${path}`, {
      method, headers: { authorization: `Bearer ${tokens[user]}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  };
  const path = `/projetos/${project.id}`;
  const read = async suffix => { const result = await request(suffix);
    assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
  const save = (body, user) => request(`${path}/propostas-adicionais/revisao`, { codBd: code + 1, ...body }, user);
  const all = normalizeAdditionalMetricInclusion();
  const before = await read(`${path}/detalhe`);
  assert.equal(before.consumo.previsto, 900);
  assert.equal(before.diasCorridos.planned, 15);
  assert.equal(before.diasTrabalhados.planned, 12);
  assert.equal(before.workedHours.plannedTotalHours, 180);
  assert.equal((await read(`${path}/revisoes`)).additionalProposals[0].metricInclusion.hours, true);
  const onlyRevenue = Object.fromEntries(ADDITIONAL_PROPOSAL_METRICS.map(({ key }) => [key, key === 'salePrice']));
  assert.equal((await save({ metricInclusion: onlyRevenue }, 1)).status, 403);
  for (const metricInclusion of [null, {}, { ...all, workedDays: 'false' }, { ...all, unknown: true }]) {
    assert.equal((await save({ metricInclusion })).status, 400);
  }
  assert.equal((await save({ metricInclusion: onlyRevenue })).status, 200);
  const revised = await read(`${path}/detalhe`);
  assert.equal(revised.consumo.previsto, 600);
  assert.equal(Number(revised.faturamento.previsto), 1500);
  assert.equal(revised.diasCorridos.planned, 10);
  assert.equal(revised.diasTrabalhados.planned, 8);
  assert.equal(revised.workedHours.plannedTotalHours, 120);
  assert.equal(revised.diasTrabalhados.worked, before.diasTrabalhados.worked);
  const revisions = await read(`${path}/revisoes`);
  assert.deepEqual(revisions.additionalProposals[0].metricInclusion, onlyRevenue);
  assert.deepEqual(revisions.additionalProposals[0].revisions.find(row => row.codBd === code + 1).plannedHours,
    { normal: 50, overtime: 10, total: 60 });
  assert.equal(revisions.additionalProposals[0].revisions.find(row => row.codBd === code + 1).plannedDays, 5);
  const rows = await listCommercialDashboard({ projectIds: [project.id], includeProgress: false });
  assert.equal(rows[0].expectedProfit, 400);
  assert.equal(rows[0].taxes, 100);
  assert.equal(rows[0].components.mo, 600);
  const merged = await read(`/grupos-missoes/${group.id}/detalhe`);
  assert.equal(merged.budgetBreakdown.additionals[0].projectId, project.id);
  assert.equal(merged.consumo.previsto, 600);
  assert.equal(merged.workedHours.plannedTotalHours, 120);
  assert.equal((await read('/projetos-cards')).find(card => card.groupId === group.id).plannedCost, 600);
  // Mudar a revisão pela ação existente conserva a escolha por campo.
  assert.equal((await save({ codBd: code + 2 })).status, 200);
  assert.deepEqual((await read(`${path}/revisoes`)).additionalProposals[0].metricInclusion, onlyRevenue);
  assert.equal((await read(`${path}/detalhe`)).consumo.previsto, 600);
  // Outra proposta mantém sua própria seleção e o percentual incide depois das exclusões.
  assert.equal((await save({ codBd: code + 3 })).status, 200);
  const added = await read(`${path}/detalhe`);
  assert.equal(added.consumo.previsto, 1200);
  assert.equal(added.workedHours.plannedTotalHours, 240);
  assert.equal((await request(`${path}/cronograma`, { proposalPercentage: 50 }, 0, 'PATCH')).status, 200);
  const scaled = await read(`${path}/detalhe`);
  assert.equal(scaled.consumo.previsto, 600);
  assert.equal(scaled.diasCorridos.planned, 10);
  assert.equal(scaled.workedHours.plannedTotalHours, 120);
  assert.equal((await save({ codBd: code + 2, metricInclusion: all })).status, 200);
  assert.equal((await read(`${path}/detalhe`)).consumo.previsto, 900);
  const imported = await prisma.commercialProposal.findUnique({ where: { codBd: code + 1 } });
  assert.equal(Number(imported.plannedCost), 300);
  assert.equal(imported.workedDays, 4);

  await t.test('campos de adicional já vinculado podem mudar com CNPJ legado divergente, sem liberar novos vínculos', async () => {
    const proposalCnpj = '60435351002109';
    const projectCnpj = '04872297001612';
    await prisma.commercialProposal.updateMany({ where: { id: { in: proposals.map(row => row.id) } },
      data: { clientCnpj: proposalCnpj } });
    await prisma.project.update({ where: { id: project.id }, data: { clientCnpj: projectCnpj } });
    const selection = await prisma.projectAdditionalProposal.findFirstOrThrow({ where: {
      projectId: project.id, sourceProposalCodBd: code + 2, active: true
    } });
    const changed = { ...all, workedDays: false };
    const command = { codBd: code + 2, expectedSelectionVersion: selection.selectionVersion, metricInclusion: changed };
    const saved = await save(command);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.selectionVersion, selection.selectionVersion + 1);
    assert.deepEqual((await read(`${path}/revisoes`)).additionalProposals
      .find(row => row.proposalCode === String(code + 1)).metricInclusion, changed);
    assert.equal((await read(`${path}/detalhe`)).diasTrabalhados.planned, 8);
    const event = await prisma.projectContributionEvent.findFirstOrThrow({ where: {
      projectId: project.id, proposalCode: String(code + 1), selectionVersion: saved.data.selectionVersion
    } });
    assert.deepEqual(event.data.metricInclusion, changed);
    assert.equal((await save(command)).status, 409, 'a versão anterior continua protegida contra sobrescrita');
    assert.equal((await save({ codBd: code + 1, metricInclusion: changed,
      expectedSelectionVersion: saved.data.selectionVersion })).status, 422, 'trocar revisão ainda valida CNPJ');
    assert.equal((await save({ codBd: code + 2,
      expectedSelectionVersion: saved.data.selectionVersion })).status, 422, 'seleção sem edição de campos ainda valida CNPJ');
    await prisma.commercialProposal.update({ where: { codBd: code + 2 }, data: { clientCnpj: '12345678000190' } });
    assert.equal((await save({ ...command, expectedSelectionVersion: saved.data.selectionVersion })).status, 422,
      'edição de campos continua validando o CNPJ contra a mãe');
    await prisma.commercialProposal.update({ where: { codBd: code + 2 },
      data: { clientCnpj: proposalCnpj, parentCodProp: code + 99 } });
    assert.equal((await save({ ...command, expectedSelectionVersion: saved.data.selectionVersion })).status, 422,
      'edição de campos continua validando o vínculo com a mãe');
    await prisma.commercialProposal.update({ where: { codBd: code + 2 }, data: { parentCodProp: code } });
    await prisma.projectAdditionalProposal.updateMany({ where: { projectId: project.id, codProp: code + 3 },
      data: { active: false } });
    assert.equal((await save({ codBd: code + 3, metricInclusion: all })).status, 422, 'reativar contribuição ainda valida CNPJ');
    const newAdditional = await prisma.commercialProposal.create({ data: {
      ...base, codBd: code + 4, codProp: code + 4, parentCodProp: code, clientCnpj: proposalCnpj
    } });
    proposals.push(newAdditional);
    assert.equal((await save({ codBd: code + 4, metricInclusion: all })).status, 422, 'novo vínculo ainda valida CNPJ');
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).clientCnpj, projectCnpj);
    assert.equal((await prisma.commercialProposal.findUniqueOrThrow({ where: { codBd: code + 2 } })).clientCnpj, proposalCnpj);
  });
});
