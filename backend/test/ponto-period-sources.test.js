import assert from 'node:assert/strict';
import test from 'node:test';
import { withPontoImportDates } from '../src/lib/acompanhamento/ponto-period-sources.js';

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
