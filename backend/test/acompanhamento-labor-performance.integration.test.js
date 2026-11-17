import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { Prisma } from '@prisma/client';
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
  const { loadCostReferenceSources } = await import('../src/lib/acompanhamento/cost-reference-sources.js');
  const { loadMonthlyPontoSources } = await import('../src/lib/acompanhamento/ponto-period-sources.js');
  const { loadLaborPeriodReferences } = await import('../src/lib/acompanhamento/labor-period-reference-sources.js');
  const { loadCorporateCalendar } = await import('../src/lib/calendar/corporate-calendar.js');
  const { laborReportQuery, loadLaborReportSources } = await import('../src/lib/acompanhamento/labor-report-sources.js');
  let fixture, effectiveFixture, axesGroupId, axesReportId, axesWeekId;
  t.after(async () => {
    if (axesWeekId) await database.allocationReviewWeek.deleteMany({ where: { id: axesWeekId } });
    if (axesGroupId) await database.acompanhamentoMissionGroup.deleteMany({ where: { id: axesGroupId } });
    if (axesReportId) await database.report.deleteMany({ where: { id: axesReportId } });
    if (fixture) await database.pontoDayProjectOverride.deleteMany({ where: { collaboratorId: fixture.prefix + '-person-0' } });
    if (effectiveFixture) await effectiveFixture.cleanup();
    if (fixture) {
      await database.pontoExternalEmployee.deleteMany({ where: { externalEmployeeId: { startsWith: fixture.prefix + '-ignored-' } } });
      await database.workforceHoliday.deleteMany({ where: { id: { startsWith: fixture.prefix + '-calendar-' } } });
      await database.pontoImport.deleteMany({ where: { id: fixture.prefix + '-newer-import' } });
      await fixture.cleanup();
      await database.jobRole.deleteMany({ where: { id: fixture.prefix + '-unconfigured' } });
    }
    await database.$disconnect();
  });
  fixture = await seedLaborPerformanceFixture(database, { reportCount: 120, servicesPerRdo: 4 });
  await t.test('monthly source order stays stable after updating a bulk-created parent', async () => {
    const options = { startDate: '2026-09-01', endDate: '2026-09-30' };
    const before = await loadMonthlyPontoSources(database, [fixture.importId], options);
    const ids = before.periods.map(row => row.id);
    assert.equal(ids.length, fixture.collaborators);
    // Rewriting an unchanged field can move a tuple in PostgreSQL without
    // changing business data. Full DTO/cache comparisons must keep their order.
    await database.pontoPeriodSummary.update({ where: { id: ids[0] }, data: { rawName: before.periods[0].rawName } });
    const after = await loadMonthlyPontoSources(database, [fixture.importId], options);
    assert.deepEqual(after.periods, before.periods);
  });
  await database.pontoExternalEmployee.createMany({ data: [
    { externalEmployeeId: fixture.prefix + '-ignored-a', externalName: 'Ignorado A', ignoredAt: new Date('2026-09-01') },
    { externalEmployeeId: fixture.prefix + '-ignored-b', externalName: 'Ignorado B', ignoredAt: new Date('2026-09-02') },
    { externalEmployeeId: fixture.prefix + '-ignored-active', externalName: 'Não ignorado' }
  ] });
  await database.workforceHoliday.createMany({ data: [
    { id: fixture.prefix + '-calendar-holiday', holidayDate: new Date('2026-09-08'), name: 'Feriado sintético' },
    { id: fixture.prefix + '-calendar-deleted', holidayDate: new Date('2026-09-09'), name: 'Excluído', deletedAt: new Date() }
  ] });
  await t.test('financial-only calculations preserve every cost field without unused workforce annotations', async () => {
    const full = await computeCollaboratorRates(fixture.importId);
    const originalRaw = database.$queryRaw;
    const queries = [];
    database.$queryRaw = (...args) => {
      const sql = Array.isArray(args[0]) ? Prisma.sql(args[0], ...args.slice(1)) : args[0];
      queries.push(sql.text);
      return originalRaw.apply(database, args);
    };
    let financial;
    try { financial = await computeCollaboratorRates(fixture.importId, { includeWorkforceDetails: false }); }
    finally { database.$queryRaw = originalRaw; }
    assert.doesNotMatch(queries.join('\n'), /CollaboratorAbsence|WorkforceHoliday|WorkforceCalendarState/,
      'Actual PostgreSQL statements must omit the three unused workforce sources');
    assert.ok(queries.some(sql => sql.includes('CollaboratorJobRoleHistory')));
    assert.ok(queries.some(sql => sql.includes('PontoExternalEmployee')));
    const strip = rate => {
      const { workforceDays: _days, workforceConflicts: _conflicts, workforceCalendarRevision: _revision, ...cost } = rate;
      return cost;
    };
    assert.deepEqual(financial, { ...full, rates: full.rates.map(strip),
      byCollaboratorId: new Map([...full.byCollaboratorId].map(([id, rate]) => [id, strip(rate)])) });
    assert.equal(financial.rates[0], financial.byCollaboratorId.get(financial.rates[0].collaboratorId));
    assert.ok(full.rates.every(rate => rate.workforceDays && Array.isArray(rate.workforceConflicts)));
  });
  for (const includeIgnoredNames of [false, true]) {
    const references = await loadLaborPeriodReferences(database, { startDate: '2026-09-01', endDate: '2026-09-30', includeIgnoredNames });
    assert.deepEqual(references.ignoredEmployees, await database.pontoExternalEmployee.findMany({
      where: { ignoredAt: { not: null } }, select: { externalEmployeeId: true, ...(includeIgnoredNames ? { externalName: true } : {}) }
    }));
    assert.deepEqual(references.calendar, await loadCorporateCalendar(database, '2026-09-01', '2026-09-30'),
      'Prefetched holidays/revision retain the existing national/calendar rules and deleted/range filters');
  }
  const roleId = fixture.prefix + '-role', unconfiguredRoleId = fixture.prefix + '-unconfigured';
  await database.jobRole.create({ data: { id: unconfiguredRoleId, name: 'Sem perfil ' + fixture.prefix, normalizedKey: unconfiguredRoleId } });
  await database.collaboratorJobRoleHistory.createMany({ data: [
    { collaboratorId: fixture.prefix + '-person-0', jobRoleId: roleId, effectiveDate: new Date('2026-09-01') },
    { collaboratorId: fixture.prefix + '-person-0', jobRoleId: roleId, effectiveDate: new Date('2026-09-15') },
    { collaboratorId: fixture.prefix + '-person-1', jobRoleId: unconfiguredRoleId, effectiveDate: new Date('2026-09-01') }
  ] });
  await database.collaborator.update({ where: { id: fixture.prefix + '-person-2' }, data: { jobRoleId: unconfiguredRoleId } });
  const nativePeriods = await database.pontoPeriodSummary.findMany({
    where: { importId: { in: [fixture.importId] }, collaboratorId: { not: null } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { collaborator: { select: { id: true, name: true, jobRoleId: true,
      jobRoleHistory: { select: { jobRoleId: true, effectiveDate: true }, orderBy: { effectiveDate: 'asc' } }
    } } }
  });
  const monthlySources = await loadMonthlyPontoSources(database, [fixture.importId], { startDate: '2026-09-01', endDate: '2026-09-30' });
  assert.deepEqual(monthlySources.periods, nativePeriods,
    'The stable period order, all scalar/JSON values and complete role history equal the nested Prisma selection');
  assert.deepEqual(monthlySources.absences, []);
  // Salary and base-model changes must retain their exact effective dates.
  await database.costParameterSet.createMany({ data: [
    { costProfileId: fixture.prefix + '-role-profile', version: 2, effectiveDate: new Date('2026-09-15'), params: { salarioBase: 4500, baseModel: fixture.prefix + '-model' } },
    { costProfileId: fixture.prefix + '-model', version: 2, effectiveDate: new Date('2026-09-20'), params: { cargaHoraria: 220, confinamentoPct: .5 } }
  ] });
  const roles = await database.jobRole.findMany({ include: { costProfile: { include: { parameterSets: true } } } });
  const models = await database.costProfile.findMany({ where: { jobRoleId: null }, include: { parameterSets: true } });
  const references = await loadCostReferenceSources(database);
  const nativeProfiles = await database.costProfile.findMany({ select: { key: true, jobRoleId: true,
    parameterSets: { select: { version: true, effectiveDate: true, createdAt: true, params: true } } } });
  const sortProfiles = rows => rows.map(row => ({ ...row,
    parameterSets: [...row.parameterSets].sort((a, b) => a.version - b.version)
  })).sort((a, b) => a.key.localeCompare(b.key));
  assert.deepEqual(sortProfiles(references.profiles), sortProfiles(nativeProfiles),
    'The batch preserves native Prisma types, parameter JSON, UTC dates and every profile version');
  assert.deepEqual([...references.roles].sort((a,b) => a.id.localeCompare(b.id)),
    roles.map(({ id, name }) => ({ id, name })).sort((a,b) => a.id.localeCompare(b.id)));
  const nativeSettings = await database.acompanhamentoSetting.findMany({
    where: { key: { in: ['epiAnnualCost', 'examsTrainingAnnualCost', 'offshoreExamsTrainingAnnualCost'] } },
    select: { key: true, numberValue: true }
  });
  assert.deepEqual([...references.settings].sort((a,b) => a.key.localeCompare(b.key)),
    nativeSettings.sort((a,b) => a.key.localeCompare(b.key)));
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
  const rosterQueries = sqlQueries.filter(query => query.sqlSnippet.includes('"ReportCollaborator"'));
  assert.equal(rosterQueries.length, 1, 'Period and annual report sources share one nominal roster read');
  assert.equal(rosterQueries[0].parameterCount, 1, 'Nominal roster SQL binds one typed array for the exact selected parents');
  const roleQueries = sqlQueries.filter(query => query.sqlSnippet.includes('labor.cost-reference-rows'));
  assert.equal(roleQueries.length, 1, 'Role names, parameters and annual settings share one catalog statement');
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
  await t.test('reduced period sources preserve identities and financial results with real absences and role history', async () => {
    const range = { startDate: '2026-09-01', endDate: '2026-09-30' };
    const complete = await loadMonthlyPontoSources(database, [fixture.importId], range);
    assert.deepEqual(complete.absences, await database.collaboratorAbsence.findMany({
      where: { collaboratorId: { in: complete.periods.map(row => row.collaboratorId) }, deletedAt: null,
        startDate: { lte: new Date(range.endDate) }, endDate: { gte: new Date(range.startDate) } },
      select: { id: true, collaboratorId: true, startDate: true, endDate: true }
    }));
    assert.equal(complete.absences.length, 1);
    const reduced = await loadMonthlyPontoSources(database, [fixture.importId], { ...range, includeWorkforceDetails: false });
    assert.deepEqual(reduced, { periods: complete.periods, absences: [] });
    const financial = await computeCollaboratorRates(fixture.importId, { includeWorkforceDetails: false });
    const strip = rate => {
      const { workforceDays: _days, workforceConflicts: _conflicts, workforceCalendarRevision: _revision, ...cost } = rate;
      return cost;
    };
    assert.deepEqual(financial, { ...refreshed, rates: refreshed.rates.map(strip),
      byCollaboratorId: new Map([...refreshed.byCollaboratorId].map(([id, rate]) => [id, strip(rate)])) });
  });

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
    assert.equal(Object.hasOwn(args[0].include ?? {}, 'import'), false, 'Reuse scoped import dates in all three consumers');
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
        assert.equal(queries.filter(query => query.sqlSnippet.includes('labor.cost-reference-rows')).length, 1,
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

  const axesProjects = [fixture.projectId, effectiveFixture.projectIds[0]], axesPerson = fixture.prefix + '-person-0';
  axesGroupId = fixture.prefix + '-axes-group'; axesReportId = fixture.prefix + '-axes-report';
  await database.acompanhamentoMissionGroup.create({ data: { id: axesGroupId, name: 'Grupo sintético', laborAllocationMode: 'SHARED_EXECUTION',
    members: { create: axesProjects.map((projectId, order) => ({ projectId, activeProjectId: projectId, order })) } } });
  await database.report.create({ data: { id: axesReportId, projectId: axesProjects[1], reportType: 'RDO', status: 'APPROVED',
    reportDate: new Date('2026-09-21'), arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1,
    daytimeWorkedMinutes: 240, collaborators: { create: { collaboratorId: axesPerson } } } });
  const assertSeparateAxes = async reason => {
    const rate = (await computeCollaboratorRates(fixture.importId)).byCollaboratorId.get(axesPerson);
    const accounting = rate.allocationTrail.find(row => row.date === '2026-09-21');
    const analytical = rate.analyticalAllocationTrail.find(row => row.date === '2026-09-21');
    assert.equal(accounting.reason, reason);
    assert.equal(accounting.allocations.reduce((sum,row)=>sum+row.weight,0), 1);
    assert.equal(analytical.allocations.reduce((sum,row)=>sum+row.weight,0), 2);
  };
  await assertSeparateAxes('SHARED_EXECUTION_ACCOUNTING');
  await database.pontoDayProjectOverride.createMany({ data: axesProjects.map(projectId => ({ collaboratorId: axesPerson,
    externalEmployeeId: axesPerson, workDate: new Date('2026-09-21'), projectId })) });
  await assertSeparateAxes('MANUAL_SHARED_OVERRIDE');
  axesWeekId = fixture.prefix + '-axes-week';
  await database.allocationReviewWeek.create({ data: { id: axesWeekId, weekStart: new Date('2026-09-21'),
    rows: { create: { collaboratorId: axesPerson, confirmedAt: new Date(), days: { create: {
      collaboratorId: axesPerson, workDate: new Date('2026-09-21'), kind: 'PROJECT',
      projects: { create: axesProjects.map(projectId => ({ projectId })) }
    } } } } } });
  await assertSeparateAxes('REVIEW_SHARED_CONFIRMED');

  await database.reportCollaborator.updateMany({ where: { reportId: fixture.prefix + '-annual' }, data: { collaboratorId: fixture.prefix + '-person-19' } });
  const rosterRefresh = await loadLaborReportSources({ database, projects: await database.project.findMany(),
    periodStart: new Date('2026-09-01'), periodEnd: new Date('2026-09-30') });
  assert.deepEqual(rosterRefresh.offshoreReports.find(report => report.reportDate.toISOString().startsWith('2026-01-10')).collaborators,
    [{ collaboratorId: fixture.prefix + '-person-19' }], 'Annual-only roster edits are observed in the next source read');

  const { withProjectAccess } = await import('../src/lib/projects/access-scope.js');
  await database.project.update({ where: { id: axesProjects[1] }, data: { managerOnly: true } });
  const originalRaw = database.$queryRaw;
  database.$queryRaw = (...args) => {
    assert.ok(!args[1].includes(axesReportId), 'Raw roster IDs must come only from the protected parent reads');
    return originalRaw.apply(database, args);
  };
  try {
    const restricted = await withProjectAccess({ accountType: 'INTERNAL' }, async () => loadLaborReportSources({
      database, projects: await database.project.findMany(), periodStart: new Date('2026-09-01'), periodEnd: new Date('2026-09-30')
    }));
    assert.ok(restricted.reports.some(report => report.projectId === fixture.projectId));
    assert.equal(restricted.reports.some(report => report.projectId === axesProjects[1]), false);
    assert.equal(restricted.offshoreReports.some(report => report.projectId === axesProjects[1]), false);
  } finally { database.$queryRaw = originalRaw; }
});
