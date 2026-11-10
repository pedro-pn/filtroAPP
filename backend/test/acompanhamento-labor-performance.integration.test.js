import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { seedLaborPerformanceFixture } from '../scripts/fixtures/labor-performance.js';
import { captureLaborQueries } from '../scripts/fixtures/labor-query-profile.js';
import { seedEffectiveAllocationFixture } from '../scripts/fixtures/effective-allocation.js';

const databaseUrl = process.env.LABOR_PERFORMANCE_TEST_DATABASE_URL;
test('PostgreSQL: fontes enxutas preservam folha, rateio, trilhas e atualização após gravação', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl);
  assert.match(url.pathname, /_test$/);
  process.env.DATABASE_URL = url.toString();
  const { default: database } = await import('../src/lib/prisma.js');
  const { computeCollaboratorRates, rdoDataByCollaboratorFromReports, getRoleParamsResolver, buildRoleParamsResolver,
    loadAllocatedAttendanceDays, debugCollaboratorMonth, findOfficialEffectiveAllocations,
    buildEffectiveAllocationIndex, buildScheduleWindows } = await import('../src/lib/acompanhamento/labor-cost.js');
  const { loadOfficialAllocationSources } = await import('../src/lib/acompanhamento/effective-allocation-sources.js');
  const { laborReportQuery, loadLaborReportSources } = await import('../src/lib/acompanhamento/labor-report-sources.js');
  let fixture, effectiveFixture;
  t.after(async () => {
    if (effectiveFixture) await effectiveFixture.cleanup();
    if (fixture) {
      await database.pontoImport.deleteMany({ where: { id: fixture.prefix + '-newer-import' } });
      await fixture.cleanup();
      await database.jobRole.deleteMany({ where: { id: fixture.prefix + '-unconfigured' } });
    }
    await database.$disconnect();
  });
  fixture = await seedLaborPerformanceFixture(database, { reportCount: 120, servicesPerRdo: 4 });
  const roleId = fixture.prefix + '-role', unconfiguredRoleId = fixture.prefix + '-unconfigured';
  await database.jobRole.create({ data: { id: unconfiguredRoleId, name: 'Sem perfil ' + fixture.prefix, normalizedKey: unconfiguredRoleId } });
  await database.collaboratorJobRoleHistory.createMany({ data: [
    { collaboratorId: fixture.prefix + '-person-0', jobRoleId: roleId, effectiveDate: new Date('2026-09-01') },
    { collaboratorId: fixture.prefix + '-person-0', jobRoleId: roleId, effectiveDate: new Date('2026-09-15') },
    { collaboratorId: fixture.prefix + '-person-1', jobRoleId: unconfiguredRoleId, effectiveDate: new Date('2026-09-01') }
  ] });
  await database.collaborator.update({ where: { id: fixture.prefix + '-person-2' }, data: { jobRoleId: unconfiguredRoleId } });
  // Salary and base-model changes must retain their exact effective dates.
  await database.costParameterSet.createMany({ data: [
    { costProfileId: fixture.prefix + '-role-profile', version: 2, effectiveDate: new Date('2026-09-15'), params: { salarioBase: 4500, baseModel: fixture.prefix + '-model' } },
    { costProfileId: fixture.prefix + '-model', version: 2, effectiveDate: new Date('2026-09-20'), params: { cargaHoraria: 220, confinamentoPct: .5 } }
  ] });
  const roles = await database.jobRole.findMany({ include: { costProfile: { include: { parameterSets: true } } } });
  const models = await database.costProfile.findMany({ where: { jobRoleId: null }, include: { parameterSets: true } });
  const legacyResolver = buildRoleParamsResolver({ roles, models });
  const resolver = await getRoleParamsResolver(database);
  for (const role of roles) {
    assert.equal(resolver.hasProfile(role.name), legacyResolver.hasProfile(role.name));
    assert.deepEqual(resolver.segmentsFor(role.name, '2026-09-01', '2026-09-30'), legacyResolver.segmentsFor(role.name, '2026-09-01', '2026-09-30'));
  }
  const original = database.report.findMany;
  const legacyQuery = () => {
    const query = laborReportQuery(new Date('2026-09-01'), new Date('2026-10-01'), { includeProject: true });
    query.select.id = true;
    query.where = { AND: [{ projectId: fixture.projectId }, query.where] };
    delete query.select.services.where;
    return query;
  };
  const beforeRows = await original.call(database.report, legacyQuery());
  const project = await database.project.findUnique({ where: { id: fixture.projectId } });
  const sources = await loadLaborReportSources({ database, projects: [project], periodStart: new Date('2026-09-01'), periodEnd: new Date('2026-09-30') });
  const afterRows = sources.reports.filter(report => report.projectId === fixture.projectId);
  assert.deepEqual(rdoDataByCollaboratorFromReports(afterRows), rdoDataByCollaboratorFromReports(beforeRows));
  assert.ok(afterRows.filter(row => row.reportType === 'RDO').every(row => row.services.length === 0));
  assert.equal(afterRows.find(row => row.reportType === 'RLQ').services.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(afterRows.map(report => report.services))) < Buffer.byteLength(JSON.stringify(beforeRows.map(report => report.services))));
  let before;
  const originalServiceRead = database.reportService.findMany;
  try {
    // Use the old nested selection as the real PostgreSQL source of intervals
    // for a complete calculation, then compare it with the direct period read.
    database.reportService.findMany = async () => (await original.call(database.report, legacyQuery()))
      .filter(report => report.reportType !== 'RDO')
      .flatMap(report => report.services.map(service => ({ reportId: report.id, ...service })));
    before = await computeCollaboratorRates(fixture.importId);
  } finally { database.reportService.findMany = originalServiceRead; }
  const sqlProfile = captureLaborQueries();
  t.after(sqlProfile.restore);
  const startedAt = performance.now();
  const after = await computeCollaboratorRates(fixture.importId);
  const sqlQueries = await sqlProfile.finish(startedAt);
  const serviceQueries = sqlQueries.filter(query => query.sqlSnippet.includes('"ReportService"'));
  assert.equal(serviceQueries.length, 1);
  assert.ok(serviceQueries[0].parameterCount < 10, 'Service interval SQL must not bind every historical report ID');
  const roleQueries = sqlQueries.filter(query => query.sqlSnippet.includes('"JobRole"'));
  assert.equal(roleQueries.length, 1, 'Current/history role names must reuse the same catalog as the cost resolver');
  assert.equal(sqlQueries.filter(query => query.sqlSnippet.includes('"PontoImport"')).length, 1,
    'Import dates must come from the scope read, without a second nested Import query');
  assert.equal(sqlQueries.filter(query => query.sqlSnippet.includes('"EfetivoMissionPlan"')).length, 1,
    'The complete official mission set is loaded once, even without allocations');
  for (const table of ['EfetivoAllocationCycle', 'EfetivoMissionCycle', 'EfetivoPlan']) {
    assert.equal(sqlQueries.filter(query => query.sqlSnippet.includes('"' + table + '"')).length, 0,
      'Empty official allocations must not trigger related ' + table + ' reads');
  }
  assert.deepEqual(after, before);
  assert.equal(after.rates.length, 21);
  assert.ok(after.rates.filter(row => ![fixture.prefix + '-person-1', fixture.prefix + '-person-2'].includes(row.collaboratorId))
    .every(row => row.hasCostProfile && row.totalMensal > 0));
  assert.equal(after.byCollaboratorId.get(fixture.prefix + '-person-1').role, 'Sem perfil ' + fixture.prefix);
  assert.equal(after.byCollaboratorId.get(fixture.prefix + '-person-1').hasCostProfile, false);
  assert.equal(after.byCollaboratorId.get(fixture.prefix + '-person-2').role, 'Sem perfil ' + fixture.prefix);
  assert.equal(after.byCollaboratorId.get(fixture.prefix + '-person-2').hasCostProfile, false);
  await database.jobRole.update({ where: { id: unconfiguredRoleId }, data: { name: 'Cargo atualizado ' + fixture.prefix } });
  assert.equal((await computeCollaboratorRates(fixture.importId)).byCollaboratorId.get(fixture.prefix + '-person-1').role,
    'Cargo atualizado ' + fixture.prefix, 'A subsequent calculation must re-read role names');
  const serviceId = fixture.prefix + '-service';
  await database.reportService.updateMany({ where: { reportId: serviceId }, data: { endTime: '10:30' } });
  const updatedSources = await loadLaborReportSources({ database, projects: [project], periodStart: new Date('2026-09-01'), periodEnd: new Date('2026-09-30') });
  assert.equal(rdoDataByCollaboratorFromReports(updatedSources.reports).get(fixture.prefix + '-person-20').dayProjects.get('2026-09-14').get(fixture.projectId).hours, 2.5);
  const person = `${fixture.prefix}-person-0`;
  await database.collaboratorAbsence.create({ data: { collaboratorId: person, type: 'FERIAS', startDate: new Date('2026-09-20'), endDate: new Date('2026-09-20') } });
  const refreshed = await computeCollaboratorRates(fixture.importId);
  const conflicts = refreshed.byCollaboratorId.get(person);
  assert.notDeepEqual(refreshed, after);
  assert.ok(JSON.stringify(conflicts).includes('WORK_DURING_ABSENCE'));

  // A later import must win even when its summary row was created earlier.
  const person3 = fixture.prefix + '-person-3', newerImportId = fixture.prefix + '-newer-import';
  const beforeOverlap = await computeCollaboratorRates();
  const sourcePeriod = await database.pontoPeriodSummary.findFirst({ where: { importId: fixture.importId, collaboratorId: person3 } });
  await database.pontoImport.create({ data: { id: newerImportId, fileName: 'newer-synthetic.xlsx', contentHash: newerImportId,
    periodStart: sourcePeriod.periodStart, periodEnd: sourcePeriod.periodEnd, createdAt: new Date('2026-10-02') } });
  const { id: _id, importId: _importId, createdAt: _createdAt, ...periodData } = sourcePeriod;
  const monthly = structuredClone(sourcePeriod.monthly);
  monthly['2026-09'].normalMinutes += 60; monthly['2026-09'].days[0].workedMinutes += 60;
  await database.pontoPeriodSummary.create({ data: { ...periodData, importId: newerImportId,
    workedMinutes: sourcePeriod.workedMinutes + 60, monthly, createdAt: new Date('2026-09-01') } });
  const originalPeriods = database.pontoPeriodSummary.findMany;
  let periodReads = 0;
  database.pontoPeriodSummary.findMany = (...args) => {
    periodReads++;
    assert.equal(Object.hasOwn(args[0].include, 'import'), false, 'Reuse scoped import dates in all three consumers');
    return originalPeriods.apply(database.pontoPeriodSummary, args);
  };
  try {
    const overlap = await computeCollaboratorRates();
    assert.equal(overlap.byCollaboratorId.get(person3).normalHoras, beforeOverlap.byCollaboratorId.get(person3).normalHoras + 1);
    assert.equal(overlap.pontoImports.length, 2);
    const { ignoredExternalEmployees, ...withMetadata } = await computeCollaboratorRates(null, { includeIgnoredNames: true });
    assert.ok(Array.isArray(ignoredExternalEmployees));
    assert.deepEqual(withMetadata, overlap, 'Optional listing metadata must not change the financial calculation or default contract');
    for (const operation of [() => loadAllocatedAttendanceDays({ database }), () => debugCollaboratorMonth('Pessoa sintética 3', '2026-09')]) {
      const profile = captureLaborQueries();
      try {
        const started = performance.now();
        await operation();
        const queries = await profile.finish(started);
        assert.equal(queries.filter(query => query.sqlSnippet.includes('"JobRole"')).length, 1,
          'Attendance and monthly diagnosis reuse current/history role names from one catalog');
      } finally { profile.restore(); }
    }
    assert.equal(periodReads, 4);
  } finally { database.pontoPeriodSummary.findMany = originalPeriods; }
  assert.deepEqual((await computeCollaboratorRates(fixture.importId)).byCollaboratorId.get(person3), beforeOverlap.byCollaboratorId.get(person3));

  effectiveFixture = await seedEffectiveAllocationFixture(database, fixture);
  const compareOfficialSources = async () => {
    const legacy = await findOfficialEffectiveAllocations(database);
    const loaded = await loadOfficialAllocationSources(database);
    assert.deepEqual(buildEffectiveAllocationIndex(loaded.allocations), buildEffectiveAllocationIndex(legacy));
    const missions = await database.efetivoMissionPlan.findMany({
      where: { deletedAt: null, scheduleStatus: 'CONFIRMED', plan: { kind: 'OFFICIAL', status: 'ACTIVE' } }, select: { projectId: true }
    });
    assert.deepEqual(loaded.missionProjectIds, new Set(missions.map(row => row.projectId)));
    return loaded;
  };
  const loaded = await compareOfficialSources();
  assert.equal(loaded.allocations.length, 3, 'Deleted allocations/missions, draft missions, scenarios and inactive plans are excluded');
  assert.ok(loaded.missionProjectIds.has(effectiveFixture.projectIds[0]), 'A confirmed mission without allocations still excludes its project');
  assert.equal(buildScheduleWindows(await database.project.findMany(), loaded.missionProjectIds)
    .some(window => window.projectId === effectiveFixture.projectIds[0]), false);
  const index = buildEffectiveAllocationIndex(loaded.allocations);
  const windows = person => index.get(fixture.prefix + '-person-' + person).windows.map(row => [row.startKey, row.endKey]);
  assert.deepEqual(windows(0), [['2026-09-02', '2026-09-04'], ['2026-09-24', '2026-09-30']]);
  assert.deepEqual(windows(1), [['2026-09-01', '2026-09-10'], ['2026-09-20', '2026-09-30']]);
  assert.deepEqual(windows(2), [['2026-09-12', '2026-09-16']]);
  await database.efetivoAllocationCycle.update({ where: { id: effectiveFixture.prefix + '-individual-1' }, data: { demobilizationDate: new Date('2026-09-05') } });
  await database.efetivoMissionCycle.update({ where: { id: effectiveFixture.prefix + '-general-1' }, data: { demobilizationDate: new Date('2026-09-12') } });
  const refreshedIndex = buildEffectiveAllocationIndex((await compareOfficialSources()).allocations);
  assert.equal(refreshedIndex.get(fixture.prefix + '-person-0').windows[0].endKey, '2026-09-05');
  assert.equal(refreshedIndex.get(fixture.prefix + '-person-1').windows[0].endKey, '2026-09-12');
  await database.efetivoMissionPlan.update({ where: { id: effectiveFixture.missionIds[1] }, data: { scheduleStatus: 'CANCELLED' } });
  assert.equal((await compareOfficialSources()).missionProjectIds.has(effectiveFixture.projectIds[0]), false);
  await database.efetivoPlan.update({ where: { id: effectiveFixture.planIds[0] }, data: { status: 'SUPERSEDED' } });
  assert.equal((await compareOfficialSources()).allocations.length, 0, 'Next request sees official plan deactivation');
});
