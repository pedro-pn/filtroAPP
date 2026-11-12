import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

test('HTTP + PostgreSQL: detail projections preserve values, permissions and source revisions across worker writes', {
  skip: !process.env.ACOMPANHAMENTO_TEST_DATABASE_URL
}, async t => {
  const databaseUrl = new URL(process.env.ACOMPANHAMENTO_TEST_DATABASE_URL);
  assert.match(databaseUrl.pathname, /_test$/);
  process.env.DATABASE_URL = databaseUrl.toString();
  process.env.ACOMPANHAMENTO_READ_CACHE_ENABLED = 'true';
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const { clearProjectDerivedCaches } = await import('../src/lib/resource-list-cache.js');
  const suffix = randomUUID();
  const projects = [], users = [], proposals = [];
  let group, server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (group) await prisma.acompanhamentoMissionGroup.delete({ where: { id: group.id } });
    await prisma.report.deleteMany({ where: { projectId: { in: projects.map(item => item.id) } } });
    await prisma.project.deleteMany({ where: { id: { in: projects.map(item => item.id) } } });
    await prisma.commercialProposal.deleteMany({ where: { id: { in: proposals.map(item => item.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(item => item.id) } } });
    await prisma.$disconnect();
  });
  for (const admin of [true, false]) {
    users.push(await prisma.user.create({ data: {
      username: `projection-${admin}-${suffix}`, name: 'Pessoa fictícia', passwordHash: 'synthetic',
      accountType: admin ? 'ADMIN' : 'INTERNAL', role: admin ? 'MANAGER' : 'COLLABORATOR',
      ...(!admin ? { moduleRoles: { create: { module: 'ACOMPANHAMENTO', role: 'ACOMPANHAMENTO_VIEWER' } } } : {})
    } }));
  }
  const tokens = users.map(() => randomUUID());
  await prisma.userSession.createMany({ data: users.map((user, index) => ({
    userId: user.id, tokenHash: createHash('sha256').update(tokens[index]).digest('hex'), expiresAt: new Date(Date.now() + 600_000)
  })) });
  const code = Math.floor(Math.random() * 900_000_000);
  for (let index = 0; index < 2; index++) {
    proposals.push(await prisma.commercialProposal.create({ data: {
      codBd: code + index, codProp: code + index, salePrice: 100000, plannedCost: 60000, taxes: 10000, rawRow: {}, isComplete: true
    } }));
    projects.push(await prisma.project.create({ data: {
      code: `projection-${index}-${suffix}`, name: 'Projeto fictício', clientName: 'Cliente', clientCnpj: '', location: 'Local',
      contractCode: String(code + index), commercialProposalCode: String(code + index), startDate: new Date('2026-10-01'),
      trackingDivisions: [{ key: JSON.stringify(['DATE', 'period-1', null]), label: 'Outubro', startDate: '2026-10-01', endDate: '2026-10-31', mobilizationDate: '2026-10-01' }],
      plannedServices: { create: ['A', 'B'].map(scopeName => ({
        serviceType: 'TESTE_PRESSAO', scopeName, weight: 1,
        systems: { create: { systemType: 'TUBULACAO', unit: 'M', quantity: 100 } }
      })) }
    } }));
  }
  const report = await prisma.report.create({ data: {
    projectId: projects[0].id, reportType: 'RDO', status: 'APPROVED', reportDate: new Date('2026-10-05'),
    arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1,
    services: { create: { serviceType: 'TESTE_PRESSAO', finalized: true, extraData: { __scopeName: 'A', tubes: [{ c: 20, lengthUnit: 'm' }] } } }
  }, include: { services: true } });
  group = await prisma.acompanhamentoMissionGroup.create({ data: {
    name: `projection-${suffix}`, members: { create: projects.map((project, order) => ({ projectId: project.id, activeProjectId: project.id, order })) }
  } });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}/api/acompanhamento/comercial`;
  const request = async (path, user = 0) => {
    const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${tokens[user]}` } });
    return { status: response.status, bytes: Number(response.headers.get('content-length')), body: await response.json() };
  };
  const paths = [`/projetos/${projects[0].id}/detalhe`, `/grupos-missoes/${group.id}/detalhe`];
  const stripProjection = value => {
    const result = structuredClone(value);
    for (const key of ['progressReadMode', 'progressRevision', 'progressHistory', 'dailyProgressHistory', 'progressFilters']) delete result[key];
    return result;
  };
  const progressKeys = new Set(['avancoPct', 'avancoMethod', 'progressBreakdown', 'progressReadMode', 'progressRevision',
    'progressHistory', 'dailyProgressHistory', 'requiredWeeklyProgress', 'progressFilters']);
  const onlyProgress = value => Object.fromEntries(Object.entries(value).filter(([key]) => progressKeys.has(key)));
  for (const path of paths) {
    const legacy = await request(path), full = await request(`${path}?progress=full`);
    const history = await request(`${path}?progress=history`), current = await request(`${path}?progress=current`);
    for (const result of [legacy, full, history, current]) assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(legacy.body, full.body);
    assert.deepEqual((await request(`${path}?progress=full&legacy-option=1`)).body, full.body);
    assert.equal(current.body.progressRevision, full.body.progressRevision);
    assert.equal(history.body.progressRevision, full.body.progressRevision);
    assert.deepEqual(stripProjection(current.body), stripProjection(full.body));
    assert.deepEqual(history.body.progressHistory, full.body.progressHistory);
    assert.deepEqual(history.body.dailyProgressHistory, full.body.dailyProgressHistory);
    assert.equal(Object.hasOwn(current.body, 'progressHistory'), false);
    assert.equal(Object.hasOwn(current.body, 'dailyProgressHistory'), false);
    assert.equal(history.body.progressFilters ?? null, null);
    assert.match(full.body.progressRevision, /^[a-f0-9]{64}$/);
    await t.test(`progress-only response avoids unrelated reads after summary: ${path}`, async sub => {
      // O resumo aqueceu a mesma entrada comercial. A segunda leitura não deve
      // buscar novamente custos, ponto, equipe, plano de horas ou equipamentos.
      for (const [model, method] of [
        ['omiePurchase', 'groupBy'], ['omieReceivable', 'findMany'], ['pontoImport', 'findMany'],
        ['reportCollaborator', 'findMany'], ['costProfile', 'findMany'], ['collaborator', 'findMany']
      ]) {
        const delegate = prisma[model], original = delegate[method];
        delegate[method] = () => { throw new Error(`Unexpected read: ${model}.${method}`); };
        sub.after(() => { delegate[method] = original; });
      }
      for (const [mode, reference] of [['current', current], ['history', history], ['full', full]]) {
        const projected = await request(`${path}?progress=${mode}&fields=progress`);
        assert.equal(projected.status, 200, JSON.stringify(projected.body));
        assert.deepEqual(onlyProgress(projected.body), onlyProgress(reference.body));
        assert.deepEqual(Object.keys(projected.body).filter(key => !progressKeys.has(key)), ['canViewProjectFinancials']);
        sub.diagnostic(`${mode}: full detail ${reference.bytes} B; progress projection ${projected.bytes} B`);
      }
    });
    for (const mode of ['current', 'history', 'full']) {
      const restricted = await request(`${path}?progress=${mode}`, 1);
      assert.equal(restricted.status, 200, JSON.stringify(restricted.body));
      assert.equal(restricted.body.canViewProjectFinancials, false);
      assert.equal(Object.hasOwn(restricted.body, 'presumedProfitTaxes'), false);
      assert.equal(restricted.body.faturamento?.realizado, undefined);
      assert.equal(restricted.body.faturamento?.notas, undefined);
      const projected = await request(`${path}?progress=${mode}&fields=progress`, 1);
      assert.equal(projected.status, 200, JSON.stringify(projected.body));
      assert.deepEqual(onlyProgress(projected.body), onlyProgress(restricted.body));
      assert.equal(projected.body.canViewProjectFinancials, false);
    }
    assert.equal((await request(`${path}?progress=unknown`)).status, 400);
    assert.equal((await request(`${path}?fields=unknown`)).status, 400);
  }
  await t.test('two-member group shares one commercial source read across summary and history', async sub => {
    clearProjectDerivedCaches();
    const delegate = prisma.commercialProposal, original = delegate.findMany;
    let reads = 0;
    delegate.findMany = (...args) => { reads++; return original.apply(delegate, args); };
    sub.after(() => { delegate.findMany = original; });
    assert.equal((await request(`${paths[1]}?progress=current`)).status, 200);
    assert.equal((await request(`${paths[1]}?progress=history&fields=progress`)).status, 200);
    assert.equal(reads, 1);
  });
  const division = encodeURIComponent(JSON.stringify(['DATE', 'period-1', null]));
  const currentDivision = await request(`${paths[0]}?division=${division}&progress=current`);
  const fullDivision = await request(`${paths[0]}?division=${division}&progress=full`);
  assert.equal(currentDivision.status, 200, JSON.stringify(currentDivision.body));
  assert.equal(fullDivision.status, 200, JSON.stringify(fullDivision.body));
  assert.equal(currentDivision.body.progressRevision, fullDivision.body.progressRevision);
  assert.deepEqual(stripProjection(currentDivision.body), stripProjection(fullDivision.body));
  assert.deepEqual(onlyProgress((await request(`${paths[0]}?division=${division}&progress=full&fields=progress`)).body), onlyProgress(fullDivision.body));

  const before = await request(`${paths[0]}?progress=current`);
  const groupBefore = await request(`${paths[1]}?progress=current`);
  await prisma.reportService.update({ where: { id: report.services[0].id }, data: {
    extraData: { __scopeName: 'A', tubes: [{ c: 40, lengthUnit: 'm' }] }
  } });
  assert.equal((await prisma.project.findUnique({ where: { id: projects[0].id } })).updatedAt.toISOString(), projects[0].updatedAt.toISOString());
  const after = await request(`${paths[0]}?progress=current`);
  assert.notEqual(after.body.progressRevision, before.body.progressRevision);
  assert.notEqual(after.body.avancoPct, before.body.avancoPct);
  assert.equal((await request(`${paths[0]}?progress=full`)).body.progressRevision, after.body.progressRevision);
  assert.notEqual((await request(`${paths[1]}?progress=current`)).body.progressRevision, groupBefore.body.progressRevision);
  await prisma.projectManualProgressHistory.create({ data: { projectId: projects[0].id, progressPct: 10, recordedAt: new Date('2026-10-02') } });
  assert.notEqual((await request(`${paths[0]}?progress=current`)).body.progressRevision, after.body.progressRevision);
});
