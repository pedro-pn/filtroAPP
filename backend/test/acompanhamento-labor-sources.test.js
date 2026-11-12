import assert from 'node:assert/strict';
import test from 'node:test';
import { laborReportQuery, loadLaborReportSources } from '../src/lib/acompanhamento/labor-report-sources.js';
import { offshoreYearsByCollaboratorFromReports, rdoDataByCollaboratorFromReports } from '../src/lib/acompanhamento/labor-cost.js';

function fixture() {
  const projects = [{ id: 'p1', code: '1001', offshore: true, mobilizationDate: '2025-05-01',
    laborSleepModeByCollaborator: Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`person-${index}`, 'FORA'])) },
  { id: 'p2', code: '1002', offshore: false, laborSleepModeByCollaborator: {} }];
  const report = (reportType, date, extra = {}) => ({ id: reportType + date, reportType, reportDate: new Date(date), projectId: 'p1',
    daytimeWorkedMinutes: 480, nighttimeWorkedMinutes: 0, sequenceNumber: 1,
    collaborators: [{ collaboratorId: 'person-1' }], services: [], ...extra });
  const reports = [
    report('RDO', '2025-05-02', { services: [{ startTime: '08:00', endTime: '18:00' }] }), report('RDO', '2026-09-02'), report('RDO', '2027-01-02'),
    report('RTP', '2026-01-02', { daytimeWorkedMinutes: 0, collaborators: [{ collaboratorId: 'annual-only' }] }),
    report('RLQ', '2026-09-03'), report('RLQ', '2026-09-04', { projectId: 'p2' }),
    report('RTP', '2026-09-05', { daytimeWorkedMinutes: 0, services: [{ startTime: '08:00', endTime: '09:00' }] }),
    report('RDO', '2026-09-06', { deletedAt: new Date() }),
    report('RDO', '2026-09-07', { daytimeWorkedMinutes: 0, collaborators: [{ collaboratorId: 'zero-rdo' }], services: [{ startTime: '08:00', endTime: '18:00' }] }),
    report('RDO', '2026-09-02', { id: 'tied-rdo', sequenceNumber: 200 }),
    report('RTP', '2026-09-08', { daytimeWorkedMinutes: -60, nighttimeWorkedMinutes: 60, services: [{ startTime: '23:00', endTime: '01:00' }] }),
    report('RLQ', '2026-10-01', { daytimeWorkedMinutes: 0, services: [{ startTime: '10:00', endTime: '11:00' }] }),
    report('RLQ', '2027-01-01', { daytimeWorkedMinutes: 0, services: [{ startTime: '10:00', endTime: '11:00' }] }),
    report('RLQ', '2026-10-02', { projectId: 'p2', daytimeWorkedMinutes: 0, services: [{ startTime: '10:00', endTime: '11:00' }] })
  ];
  const calls = [];
  const matches = (row, where) => {
    if (row.deletedAt) return false;
    const project = projects.find(item => item.id === row.projectId);
    if (where.OR) {
      const range = where.OR[1].reportDate;
      return row.reportType === 'RDO' || (row.reportDate >= range.gte && row.reportDate < range.lt
        && (row.daytimeWorkedMinutes > 0 || row.nighttimeWorkedMinutes > 0 || row.services.some(service => service.startTime != null && service.endTime != null)));
    }
    return (!where.reportType || row.reportType !== 'RDO') && project.offshore
      && row.reportDate >= where.reportDate.gte && row.reportDate < where.reportDate.lt;
  };
  const database = { report: { findMany: async args => {
    const selected = reports.filter(row => matches(row, args.where)).map(row => Object.fromEntries(Object.entries(args.select).map(([key, value]) => [key,
      key === 'project' ? Object.fromEntries(Object.keys(value.select).map(field => [field, projects.find(item => item.id === row.projectId)[field]])) : key === 'services' && value.where && row.reportType === value.where.report.reportType.not ? [] : row[key]
    ])));
    calls.push({ args, bytes: Buffer.byteLength(JSON.stringify(selected)) });
    return selected;
  } }, $queryRaw: async (query, reportIds) => {
    const rows = reports.filter(row => reportIds.includes(row.id))
      .flatMap(row => row.collaborators.map(({ collaboratorId }) => ({ reportId: row.id, collaboratorId })));
    calls.push({ query, reportIds, bytes: Buffer.byteLength(JSON.stringify(rows)) });
    return rows;
  }, reportService: { findMany: async ({ where }) => reports
    .filter(row => !row.deletedAt && row.reportType !== 'RDO' && row.reportDate >= where.report.reportDate.gte && row.reportDate < where.report.reportDate.lt)
    .flatMap(row => row.services.filter(service => service.startTime != null && service.endTime != null).map(service => ({ reportId: row.id, ...service }))) } };
  return { projects, reports, database, calls };
}

test('labor sources preserve historical evidence and annual offshore eligibility without repeating project JSON', async () => {
  const state = fixture();
  const periodStart = new Date('2026-09-01'), periodEnd = new Date('2026-09-30');
  const legacyQuery = laborReportQuery(periodStart, new Date('2026-10-01'), { includeProject: true });
  delete legacyQuery.select.services.where;
  const legacy = await state.database.report.findMany(legacyQuery);
  const annual = await state.database.report.findMany({
    where: { deletedAt: null, project: { offshore: true }, reportDate: { gte: new Date('2026-01-01'), lt: new Date('2027-01-01') } },
    select: { reportDate: true, project: { select: { offshore: true } }, collaborators: { select: { collaboratorId: true } } }
  });
  const oldBytes = state.calls.reduce((sum, call) => sum + call.bytes, 0);
  state.calls.length = 0;
  const current = await loadLaborReportSources({ database: state.database, projects: Promise.resolve(state.projects), periodStart, periodEnd });
  assert.deepEqual(rdoDataByCollaboratorFromReports(current.reports), rdoDataByCollaboratorFromReports(legacy));
  assert.deepEqual(offshoreYearsByCollaboratorFromReports(current.offshoreReports), offshoreYearsByCollaboratorFromReports(annual));
  assert.ok(current.reports.some(row => row.reportDate.getUTCFullYear() === 2025));
  assert.ok(current.reports.filter(row => row.reportType === 'RDO').every(row => row.services.length === 0));
  assert.equal(rdoDataByCollaboratorFromReports(current.reports).get('zero-rdo').dayProjects.get('2026-09-07').get('p1').hours, 0);
  assert.equal(rdoDataByCollaboratorFromReports(current.reports).get('person-1').dayProjects.get('2026-09-05').get('p1').hours, 1);
  assert.equal(rdoDataByCollaboratorFromReports(current.reports).get('person-1').dayProjects.get('2026-09-08').get('p1').hours, 2);
  assert.equal(rdoDataByCollaboratorFromReports(current.reports).get('person-1').dayProjects.get('2026-09-02').get('p1').rdoNumber, 1);
  assert.ok(!current.reports.some(report => report.reportType === 'RLQ' && report.reportDate.toISOString().startsWith('2026-10-01')));
  assert.ok(offshoreYearsByCollaboratorFromReports(current.offshoreReports).get('annual-only').has('2026'));
  assert.ok(current.reports.filter(row => row.projectId === 'p1').every(row => row.project === state.projects[0]));
  assert.equal(state.calls[0].args.select.project, undefined);
  assert.equal(state.calls[1].args.select.project, undefined);
  assert.equal(state.calls[0].args.select.collaborators, undefined);
  assert.equal(state.calls[1].args.select.collaborators, undefined);
  const ids = state.calls[2].reportIds;
  assert.equal(ids.length, new Set(ids).size, 'Overlapping period/annual sources read the same roster only once');
  for (const id of ['RDO2025-05-02', 'RDO2027-01-02', 'RTP2026-01-02', 'RLQ2026-09-04', 'RLQ2026-10-01']) assert.ok(ids.includes(id));
  for (const id of ['RDO2026-09-06', 'RLQ2027-01-01', 'RLQ2026-10-02']) assert.equal(ids.includes(id), false);
  assert.equal(state.calls[2].query.length, 2, 'One bound array rather than a placeholder per report');
  assert.deepEqual(state.calls[1].args.where.reportType, { not: 'RDO' });
  const newBytes = state.calls.reduce((sum, call) => sum + call.bytes, 0);
  assert.ok(newBytes < oldBytes / 2, `${oldBytes} -> ${newBytes}`);
});

test('a new source read observes worker changes without a process cache', async () => {
  const state = fixture();
  const options = { database: state.database, projects: state.projects, periodStart: new Date('2026-09-01'), periodEnd: new Date('2026-09-30') };
  const before = await loadLaborReportSources(options);
  state.reports[1].deletedAt = new Date();
  const after = await loadLaborReportSources(options);
  assert.equal(after.reports.length, before.reports.length - 1);
  assert.equal(state.calls.length, 6);
});

test('interval edits are observed and a failed interval read rejects instead of dropping worked hours', async () => {
  const state = fixture();
  const options = { database: state.database, projects: state.projects, periodStart: new Date('2026-09-01'), periodEnd: new Date('2026-09-30') };
  const workedHours = sources => rdoDataByCollaboratorFromReports(sources.reports).get('person-1').dayProjects.get('2026-09-05').get('p1').hours;
  assert.equal(workedHours(await loadLaborReportSources(options)), 1);
  state.reports.find(report => report.id === 'RTP2026-09-05').services[0].endTime = '10:00';
  const read = state.database.reportService.findMany;
  state.database.reportService.findMany = async () => { throw new Error('interval read failed'); };
  await assert.rejects(loadLaborReportSources(options), /interval read failed/);
  state.database.reportService.findMany = read;
  assert.equal(workedHours(await loadLaborReportSources(options)), 2);
});

test('shared roster observes changed links and a failed read rejects instead of losing nominal evidence', async () => {
  const state = fixture();
  const options = { database: state.database, projects: state.projects, periodStart: new Date('2026-09-01'), periodEnd: new Date('2026-09-30') };
  const first = await loadLaborReportSources(options);
  const row = state.reports.find(row => row.id === 'RTP2026-01-02');
  row.collaborators = [{ collaboratorId: 'new-annual-person' }];
  state.reports.find(row => row.id === 'RDO2026-09-02').collaborators = [{ collaboratorId: 'new-rdo-person' }];
  const original = state.database.$queryRaw;
  state.database.$queryRaw = async () => { throw new Error('roster unavailable'); };
  await assert.rejects(loadLaborReportSources(options), /roster unavailable/);
  state.database.$queryRaw = original;
  const second = await loadLaborReportSources(options);
  assert.ok(offshoreYearsByCollaboratorFromReports(first.offshoreReports).has('annual-only'));
  assert.equal(offshoreYearsByCollaboratorFromReports(second.offshoreReports).has('annual-only'), false);
  assert.ok(offshoreYearsByCollaboratorFromReports(second.offshoreReports).has('new-annual-person'));
  assert.equal(rdoDataByCollaboratorFromReports(first.reports).has('new-rdo-person'), false);
  assert.ok(rdoDataByCollaboratorFromReports(second.reports).get('new-rdo-person').nominalRdoProjectsByDate.get('2026-09-02').has('p1'));
});

test('empty scoped report sources do not query a nominal roster', async () => {
  const database = { report: { findMany: async () => [] }, reportService: { findMany: async () => [] } };
  assert.deepEqual(await loadLaborReportSources({ database, projects: [], periodStart: new Date('2026-09-01'), periodEnd: new Date('2026-09-30') }),
    { reports: [], offshoreReports: [] });
});
