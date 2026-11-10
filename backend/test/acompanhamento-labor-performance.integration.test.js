import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { seedLaborPerformanceFixture } from '../scripts/fixtures/labor-performance.js';
import { captureLaborQueries } from '../scripts/fixtures/labor-query-profile.js';

const databaseUrl = process.env.LABOR_PERFORMANCE_TEST_DATABASE_URL;
test('PostgreSQL: fontes enxutas preservam folha, rateio, trilhas e atualização após gravação', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl);
  assert.match(url.pathname, /_test$/);
  process.env.DATABASE_URL = url.toString();
  const { default: database } = await import('../src/lib/prisma.js');
  const { computeCollaboratorRates, rdoDataByCollaboratorFromReports, getRoleParamsResolver, buildRoleParamsResolver } = await import('../src/lib/acompanhamento/labor-cost.js');
  const { laborReportQuery, loadLaborReportSources } = await import('../src/lib/acompanhamento/labor-report-sources.js');
  let fixture;
  t.after(async () => { if (fixture) await fixture.cleanup(); await database.$disconnect(); });
  fixture = await seedLaborPerformanceFixture(database, { reportCount: 120, servicesPerRdo: 4 });
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
  assert.deepEqual(after, before);
  assert.equal(after.rates.length, 21);
  assert.ok(after.rates.every(row => row.hasCostProfile && row.totalMensal > 0));
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
});
