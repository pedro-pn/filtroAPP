import assert from 'node:assert/strict';
import test from 'node:test';
import { laborReportQuery, loadLaborReportSources } from '../src/lib/acompanhamento/labor-report-sources.js';
import { offshoreYearsByCollaboratorFromReports, rdoDataByCollaboratorFromReports } from '../src/lib/acompanhamento/labor-cost.js';

function fixture() {
  const projects = [{ id: 'p1', code: '1001', offshore: true, mobilizationDate: '2025-05-01',
    laborSleepModeByCollaborator: Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`person-${index}`, 'FORA'])) },
  { id: 'p2', code: '1002', offshore: false, laborSleepModeByCollaborator: {} }];
  const report = (reportType, date, extra = {}) => ({ reportType, reportDate: new Date(date), projectId: 'p1',
    daytimeWorkedMinutes: 480, nighttimeWorkedMinutes: 0, sequenceNumber: 1,
    collaborators: [{ collaboratorId: 'person-1' }], services: [], ...extra });
  const reports = [
    report('RDO', '2025-05-02'), report('RDO', '2026-09-02'), report('RDO', '2027-01-02'),
    report('RTP', '2026-01-02', { daytimeWorkedMinutes: 0, collaborators: [{ collaboratorId: 'annual-only' }] }),
    report('RLQ', '2026-09-03'), report('RLQ', '2026-09-04', { projectId: 'p2' }),
    report('RTP', '2026-09-05', { daytimeWorkedMinutes: 0, services: [{ startTime: '08:00', endTime: '09:00' }] }),
    report('RDO', '2026-09-06', { deletedAt: new Date() })
  ];
  const calls = [];
  const database = { report: { findMany: async args => {
    const selected = reports.filter(row => {
      if (row.deletedAt) return false;
      const project = projects.find(item => item.id === row.projectId);
      if (args.where.OR) {
        const range = args.where.OR[1].reportDate;
        return row.reportType === 'RDO' || (row.reportDate >= range.gte && row.reportDate < range.lt
          && (row.daytimeWorkedMinutes > 0 || row.nighttimeWorkedMinutes > 0 || row.services.some(service => service.startTime != null && service.endTime != null)));
      }
      return (!args.where.reportType || row.reportType !== 'RDO') && project.offshore
        && row.reportDate >= args.where.reportDate.gte && row.reportDate < args.where.reportDate.lt;
    }).map(row => Object.fromEntries(Object.entries(args.select).map(([key, value]) => [key,
      key === 'project' ? Object.fromEntries(Object.keys(value.select).map(field => [field, projects.find(item => item.id === row.projectId)[field]])) : row[key]
    ])));
    calls.push({ args, bytes: Buffer.byteLength(JSON.stringify(selected)) });
    return selected;
  } } };
  return { projects, reports, database, calls };
}

test('labor sources preserve historical evidence and annual offshore eligibility without repeating project JSON', async () => {
  const state = fixture();
  const periodStart = new Date('2026-09-01'), periodEnd = new Date('2026-09-30');
  const legacy = await state.database.report.findMany(laborReportQuery(periodStart, new Date('2026-10-01'), { includeProject: true }));
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
  assert.ok(offshoreYearsByCollaboratorFromReports(current.offshoreReports).get('annual-only').has('2026'));
  assert.ok(current.reports.filter(row => row.projectId === 'p1').every(row => row.project === state.projects[0]));
  assert.equal(state.calls[0].args.select.project, undefined);
  assert.equal(state.calls[1].args.select.project, undefined);
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
  assert.equal(state.calls.length, 4);
});
