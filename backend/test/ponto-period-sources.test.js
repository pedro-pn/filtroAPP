import assert from 'node:assert/strict';
import test from 'node:test';
import { withPontoImportDates, loadMonthlyPontoSources } from '../src/lib/acompanhamento/ponto-period-sources.js';
const range = { startDate: '2026-09-01', endDate: '2026-09-30' };

test('scoped import dates preserve overlap precedence and input order without mutating periods', () => {
  const imports = [{ id: 'new', createdAt: new Date('2026-10-02') }, { id: 'old', createdAt: new Date('2026-10-01') }];
  const rows = [
    { importId: 'new', createdAt: new Date('2026-09-01'), workedMinutes: 60 },
    { importId: 'old', createdAt: new Date('2026-11-01'), workedMinutes: 30 }
  ];
  const original = structuredClone(rows), hydrated = withPontoImportDates(rows, imports);
  assert.deepEqual(rows, original);
  assert.deepEqual(hydrated.map(row => row.importId), ['new', 'old']);
  const latest = [...hydrated].sort((a, b) => a.import.createdAt - b.import.createdAt).at(-1);
  assert.equal(latest.workedMinutes, 60, 'Import time, not period row creation time, decides which overlapping source wins');
  const adapted = { import: { createdAt: new Date('2026-08-01') } };
  assert.deepEqual(withPontoImportDates([adapted], imports), [adapted]);
});

test('monthly identities bind only selected people and retain parent order and UTC role dates', async () => {
  const periods = [{ id: 'new', collaboratorId: "c'1", workedMinutes: 60 },
    { id: 'old', collaboratorId: 'c2', workedMinutes: 30 }, { id: 'repeat', collaboratorId: "c'1", workedMinutes: 10 }];
  const original = structuredClone(periods);
  const database = {
    pontoPeriodSummary: { findMany: async args => {
      assert.deepEqual(args, { where: { importId: { in: ['i2','i1'] }, collaboratorId: { not: null } } });
      return periods;
    } },
    $queryRaw: async (sql, ids) => {
      assert.deepEqual(ids, ["c'1", 'c2']);
      assert.ok(!sql.join('').includes("c'1"));
      return [{ collaborators: [{ id: "c'1", name: 'Ana', jobRoleId: 'r2', jobRoleHistory: [
        { jobRoleId: 'r1', effectiveDate: '2026-09-01' }, { jobRoleId: 'r2', effectiveDate: '2026-09-15' }
      ] }], absences: [{ id: 'a', collaboratorId: "c'1", startDate: '2026-09-01', endDate: '2026-09-10' }] }];
    }
  };
  const { periods: result, absences } = await loadMonthlyPontoSources(database, ['i2','i1'], range);
  assert.equal(absences[0].endDate.toISOString(), '2026-09-10T00:00:00.000Z');
  assert.deepEqual(result.map(row => row.id), ['new','old','repeat']);
  assert.deepEqual(periods, original);
  assert.equal(result[1].collaborator, null, 'An identity removed between reads stays missing');
  assert.equal(result[0].collaborator.jobRoleHistory[1].effectiveDate.toISOString(), '2026-09-15T00:00:00.000Z');
  assert.deepEqual(Object.keys(result[0].collaborator).sort(), ['id','jobRoleHistory','jobRoleId','name']);
});

test('empty periods skip identity SQL and identity failures reject the read', async () => {
  const database = { pontoPeriodSummary: { findMany: async () => [] }, $queryRaw: () => { throw new Error('identity unavailable'); } };
  assert.deepEqual(await loadMonthlyPontoSources(database, [], range), { periods: [], absences: [] });
  database.pontoPeriodSummary.findMany = async () => [{ collaboratorId: 'c1' }];
  await assert.rejects(loadMonthlyPontoSources(database, ['i1'], range), /identity unavailable/);
});
