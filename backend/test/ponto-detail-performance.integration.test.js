import assert from 'node:assert/strict';
import test from 'node:test';
import { seedHttpPerformanceFixture } from '../scripts/fixtures/http-performance.js';

test('PostgreSQL + HTTP: point projections and batched group sources preserve contracts, money and freshness', {
  skip: !process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL, timeout: 90000
}, async t => {
  process.env.DATABASE_URL = process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL;
  const { default: database } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const { getProjectDetail } = await import('../src/lib/acompanhamento/project-detail.js');
  const { getMissionGroupDetail, groupProjectDetails, groupProgressProjection } = await import('../src/lib/acompanhamento/project-detail-groups.js');
  const { getActiveMissionGroup } = await import('../src/lib/acompanhamento/mission-groups.js');
  const { buildPlannedScope } = await import('../src/lib/acompanhamento/planned-scope.js');
  const { computeProgressDetailsForProjects } = await import('../src/lib/acompanhamento/avanco.js');
  const { listCommercialDashboard } = await import('../src/lib/acompanhamento/access-import.js');
  const { loadPlannedHours } = await import('../src/lib/acompanhamento/planned-hours.js');
  const { loadGroupDetailSources } = await import('../src/lib/acompanhamento/project-detail-sources.js');
  const { withProjectAccess, withProjectChannel } = await import('../src/lib/projects/access-scope.js');
  let fixture, server;
  const extras = [];
  t.after(async () => {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    if (fixture) {
      await database.pontoExternalEmployee.deleteMany({ where: { externalEmployeeId: fixture.prefix + '-ignored' } });
      await database.report.deleteMany({ where: { id: { in: extras } } });
      await database.collaborator.deleteMany({ where: { id: { in: [fixture.prefix + '-outside', fixture.prefix + '-private-only'] } } });
      await database.omiePurchase.deleteMany({ where: { omieId: { startsWith: fixture.prefix } } });
      await database.omieCategory.deleteMany({ where: { codigo: fixture.prefix + '-admin' } });
      await fixture.cleanup();
    }
    await database.$disconnect();
  });
  fixture = await seedHttpPerformanceFixture(database, { reportCount: 36, scopeCount: 6 });
  const ids = fixture.projectIds.slice(0, 2);
  await database.collaborator.create({ data: { id: fixture.prefix + '-outside', code: fixture.prefix + '-outside', name: 'Pessoa sem ponto', jobRoleId: fixture.prefix + '-role' } });
  await database.collaborator.create({ data: { id: fixture.prefix + '-private-only', code: fixture.prefix + '-private-only', name: 'Pessoa de outro projeto', jobRoleId: fixture.prefix + '-role' } });
  const privateReport = await database.report.create({ data: {
    projectId: fixture.projectIds[2], reportType: 'RDO', status: 'APPROVED', sequenceNumber: 1, reportDate: new Date('2026-09-10'),
    arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1, daytimeWorkedMinutes: 480,
    collaborators: { create: { collaboratorId: fixture.prefix + '-private-only' } }
  } });
  extras.push(privateReport.id);
  for (const [index, projectId] of ids.entries()) {
    const report = await database.report.create({ data: { projectId, reportType: 'RDO', status: 'APPROVED', sequenceNumber: 200 + index,
      reportDate: new Date('2026-09-10'), arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00',
      daytimeCount: 1, daytimeWorkedMinutes: 480, nighttimeWorkedMinutes: 120,
      specialConditions: { noturnoDetails: { collaboratorIds: [fixture.prefix + '-outside'],
        colaboradores: [{ id: fixture.prefix + '-outside', name: 'Pessoa sem ponto', role: fixture.prefix }] } },
      collaborators: { create: { collaboratorId: fixture.prefix + '-outside' } } } });
    extras.push(report.id);
    await database.projectManualCost.create({ data: { projectId, description: 'Custo sintético ' + index, amount: index ? '0.20' : '123.45', costDate: new Date('2026-09-10') } });
    await database.projectPlannedNormalHours.create({ data: { projectId, jobRoleId: fixture.prefix + '-role', hours: 220 } });
  }
  await database.omiePurchase.createMany({ data: [
    { omieId: fixture.prefix + '-paid', projectId: ids[0], categoriaCodigo: 'TEST', categoriaDescricao: 'Insumo', statusTitulo: 'PAGO', valor: '0.10', rawPayload: {} },
    { omieId: fixture.prefix + '-open', projectId: ids[0], categoriaCodigo: 'TEST', categoriaDescricao: 'Insumo', statusTitulo: 'ABERTO', valor: '0.20', rawPayload: {} }
  ] });
  await database.omieCategory.create({ data: { codigo: fixture.prefix + '-admin', descricao: 'Categoria restrita', adminOnly: true } });
  await database.omiePurchase.create({ data: { omieId: fixture.prefix + '-admin', projectId: ids[0],
    categoriaCodigo: fixture.prefix + '-admin', categoriaDescricao: 'Categoria restrita', statusTitulo: 'PAGO', valor: '1.23', rawPayload: {} } });
  await database.$executeRaw`ANALYZE`;
  const group = await getActiveMissionGroup({ groupId: fixture.groupId });
  const progress = await computeProgressDetailsForProjects(ids, { currentOnly: true, includeSlices: false, includeRevision: true });
  const hours = await loadPlannedHours(ids);
  const dashboard = await listCommercialDashboard({ projectIds: ids, includeProgress: false });
  const entries = [];
  for (const member of group.members) {
    const options = { includeCollaboratorCosts: true, progressMode: 'current',
      dashboardRow: dashboard.find(row => row.projectId === member.projectId),
      progressDetails: progress.get(member.projectId), plannedHoursByProject: hours };
    entries.push({ member, projectId: member.projectId, dashboardRow: options.dashboardRow,
      detail: await getProjectDetail(member.projectId, options),
      plannedScope: buildPlannedScope(options.progressDetails.plannedServices, hours.get(member.projectId)),
      progress: options.progressDetails.progress, options });
  }
  let purchaseReads = 0, annualReads = 0, rosterReads = 0, metadataReads = 0, costCollaboratorReads = 0;
  const originalGroup = database.omiePurchase.groupBy, originalAnnual = database.acompanhamentoSetting.findMany;
  const originalRoster = database.reportCollaborator.findMany;
  const originalCollaborators = database.collaborator.findMany;
  database.collaborator.findMany = (...args) => {
    if (args[0].where.reportLinks) {
      metadataReads++;
      assert.deepEqual(args[0].where.reportLinks.some.report, { projectId: { in: ids }, deletedAt: null });
    }
    if (args[0].select.rdoCostSimulationExcluded) costCollaboratorReads++;
    return originalCollaborators.apply(database.collaborator, args);
  };
  database.omiePurchase.groupBy = (...args) => { if (args[0]._sum?.valor) purchaseReads++; return originalGroup.apply(database.omiePurchase, args); };
  database.acompanhamentoSetting.findMany = (...args) => { annualReads++; return originalAnnual.apply(database.acompanhamentoSetting, args); };
  database.reportCollaborator.findMany = (...args) => {
    rosterReads++;
    assert.equal(Object.hasOwn(args[0].select, 'report'), false, 'Detail must reuse its parent reports for both turns');
    assert.equal(Object.hasOwn(args[0].select, 'collaborator'), false, 'Group members reuse their scoped identity catalog');
    return originalRoster.apply(database.reportCollaborator, args);
  };
  t.after(() => {
    database.omiePurchase.groupBy = originalGroup; database.acompanhamentoSetting.findMany = originalAnnual;
    database.reportCollaborator.findMany = originalRoster;
    database.collaborator.findMany = originalCollaborators;
  });
  const shared = await loadGroupDetailSources(ids);
  assert.equal(purchaseReads, 2, 'Cost groups are read in two batches for the whole group');
  assert.equal(metadataReads, 0, 'Identity metadata is lazy');
  assert.equal((await shared.loadReportCollaborators()).has(fixture.prefix + '-private-only'), false,
    'The group catalog must exclude collaborators present only in other projects');
  for (const entry of entries) {
    const actual = await getProjectDetail(entry.projectId, { ...entry.options, sharedSources: shared });
    assert.deepEqual(actual, entry.detail);
  }
  assert.equal(purchaseReads, 2, 'Even a member without Omie costs must reuse its empty batch');
  assert.equal(annualReads, 1, 'Fallback report costing shares one request-owned catalog');
  assert.equal(rosterReads, 2, 'Keep the original per-member roster query and its source order');
  assert.equal(metadataReads, 1, 'One identity catalog for both members');
  assert.equal(costCollaboratorReads, 1, 'The same fallback collaborator must be loaded once even across sequential member reads');
  assert.ok(entries.every(entry => entry.detail.workedHours.roleCounts.some(role => role.usedHours > 0)));
  assert.equal(entries[1].detail.workedHours.roleCounts[0].usedHours, 10, 'Day and night hours still feed role totals');
  database.omiePurchase.groupBy = originalGroup; database.acompanhamentoSetting.findMany = originalAnnual;
  database.reportCollaborator.findMany = originalRoster;
  database.collaborator.findMany = originalCollaborators;
  const restrictedOptions = { ...entries[0].options, includeAdminOnlyCategories: false };
  const restricted = await getProjectDetail(ids[0], restrictedOptions);
  assert.deepEqual(await getProjectDetail(ids[0], { ...restrictedOptions, sharedSources: shared }), restricted);
  assert.ok(restricted.consumo.gasto < entries[0].detail.consumo.gasto);
  const divisionOptions = { ...entries[0].options, division: { key: JSON.stringify(['DATE', 'period-0', null]), startDate: '2026-09-01', endDate: '2026-09-02',
    mobilizationDate: '2026-09-01', plannedCost: 100, plannedRevenue: 150, plannedHours: 220, plannedDays: 2 } };
  assert.deepEqual(await getProjectDetail(ids[0], { ...divisionOptions, sharedSources: shared }), await getProjectDetail(ids[0], divisionOptions));
  const guarded = { ...shared, loadReportCollaborators: () => { throw new Error('Catalog from a different access scope'); } };
  await withProjectAccess({ accountType: 'INTERNAL' }, () => withProjectChannel('acompanhamento', async () => {
    assert.deepEqual(await getProjectDetail(ids[0], { ...entries[0].options, sharedSources: guarded }),
      await getProjectDetail(ids[0], entries[0].options));
  }));
  const expected = groupProjectDetails(group, entries, { progressProjection: groupProgressProjection(entries, { progressMode: 'current', includeRevision: true }) });
  assert.deepEqual(await getMissionGroupDetail(fixture.groupId, { includeCollaboratorCosts: true, progressMode: 'current' }), expected);
  await database.omiePurchase.update({ where: { omieId: fixture.prefix + '-open' }, data: { valor: '1.20' } });
  const after = await getMissionGroupDetail(fixture.groupId, { includeCollaboratorCosts: true, progressMode: 'current' });
  assert.equal(Math.round((after.consumo.gasto - expected.consumo.gasto) * 100), 100);
  assert.ok(after.colaboradores.find(row => row.collaboratorId === fixture.prefix + '-outside').custoEstimadoRdo > 0);
  await database.collaborator.update({ where: { id: fixture.prefix + '-outside' }, data: { name: 'Nome atualizado', rdoCostSimulationExcluded: true } });
  const refreshedPerson = (await getMissionGroupDetail(fixture.groupId, { includeCollaboratorCosts: true, progressMode: 'current' }))
    .colaboradores.find(row => row.collaboratorId === fixture.prefix + '-outside');
  assert.equal(refreshedPerson.name, 'Nome atualizado');
  assert.equal(refreshedPerson.custoEstimadoRdo, null, 'Cost exclusions are re-read in the next group request');

  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/api/acompanhamento/ponto/colaboradores';
  const request = async (suffix, token = fixture.sessions.admin[0]) => {
    const response = await fetch(endpoint + suffix, { headers: token ? { authorization: 'Bearer ' + token } : {} });
    return { status: response.status, body: await response.json() };
  };
  await database.pontoExternalEmployee.create({ data: { externalEmployeeId: fixture.prefix + '-ignored',
    externalName: 'Pessoa ignorada sintética', ignoredAt: new Date() } });
  await database.pontoPeriodSummary.create({ data: { importId: fixture.importId,
    rawName: 'Pessoa ignorada sintética', normalizedName: 'pessoa ignorada sintetica',
    periodStart: new Date('2026-09-01'), periodEnd: new Date('2026-09-30'), workedMinutes: 0 } });
  let ignoredReads = 0, full;
  const originalIgnoredRead = database.pontoExternalEmployee.findMany;
  database.pontoExternalEmployee.findMany = (...args) => { ignoredReads++; return originalIgnoredRead.apply(database.pontoExternalEmployee, args); };
  try { full = await request(''); }
  finally { database.pontoExternalEmployee.findMany = originalIgnoredRead; }
  assert.equal(ignoredReads, 1, 'Full/summary metadata must reuse the engine read of ignored employees');
  assert.equal(Object.hasOwn(full.body, 'ignoredExternalEmployees'), false, 'Internal employee metadata must not enter the public contract');
  const explicitFull = await request('?view=full'), summary = await request('?view=summary');
  assert.deepEqual(explicitFull, full);
  assert.equal(summary.status, 200);
  assert.equal(summary.body.rates.length, full.body.rates.length);
  for (const [index, rate] of summary.body.rates.entries()) {
    const legacy = full.body.rates[index];
    for (const key of Object.keys(rate).filter(key => key !== 'months')) assert.deepEqual(rate[key], legacy[key]);
    for (const [monthIndex, month] of rate.months.entries()) for (const key of Object.keys(month)) assert.deepEqual(month[key], legacy.months[monthIndex][key]);
    assert.equal(Object.hasOwn(rate, 'allocationTrail'), false);
    assert.equal(Object.hasOwn(rate, 'analyticalByProject'), false);
  }
  assert.ok(JSON.stringify(summary.body).length < JSON.stringify(full.body).length / 3);
  const originalReport = database.report.findMany;
  database.report.findMany = () => { throw new Error('Reconciliation must not compute costs or read RDO history'); };
  let reconciliation;
  try { reconciliation = await request('?view=reconciliation'); }
  finally { database.report.findMany = originalReport; }
  const metadata = { ...full.body }; delete metadata.rates;
  assert.equal(reconciliation.status, 200);
  assert.deepEqual(reconciliation.body, metadata);
  assert.equal(metadata.unmatched.length, 0);
  await database.pontoExternalEmployee.update({ where: { externalEmployeeId: fixture.prefix + '-ignored' }, data: { ignoredAt: null } });
  for (const view of ['full', 'summary', 'reconciliation']) {
    assert.ok((await request('?view=' + view)).body.unmatched.some(row => row.normalizedName === 'pessoa ignorada sintetica'));
  }
  await database.pontoExternalEmployee.update({ where: { externalEmployeeId: fixture.prefix + '-ignored' }, data: { ignoredAt: new Date() } });
  for (const view of ['summary', 'reconciliation']) {
    assert.equal((await request('?view=' + view, null)).status, 401);
    assert.equal((await request('?view=' + view, fixture.sessions.blocked[0])).status, 403);
    assert.equal((await request('?view=' + view, fixture.sessions.viewer[0])).status, 200);
  }
  assert.equal((await request('?view=unknown')).status, 400);
  await fixture.workerWrite();
  assert.equal((await request('?view=reconciliation')).body.unmatched.length, metadata.unmatched.length + 1);
});
