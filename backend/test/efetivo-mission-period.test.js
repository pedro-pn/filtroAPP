import assert from 'node:assert/strict';
import test from 'node:test';

import { missionEndDate, missionEndsOnOrAfter, missionPeriod, missionStartsOnOrBefore } from '../src/lib/efetivo/planning/mission-period.js';

test('período usa fim previsto enquanto a desmobilização real está vazia', () => {
  const mission = { mobilizationDate: '2026-01-01', executionEndDate: '2026-01-10', returnDate: null };
  assert.equal(missionEndDate(mission), '2026-01-10');
  assert.deepEqual(missionPeriod(mission), { startDate: '2026-01-01', endDate: '2026-01-10' });
  assert.equal(missionEndDate({ ...mission, returnDate: '2026-01-12' }), '2026-01-12');
});

test('filtro de sobreposição contempla desmobilização vazia com fim previsto', () => {
  const position = new Date('2026-01-05T00:00:00.000Z');
  assert.deepEqual(missionEndsOnOrAfter(position), {
    OR: [
      { returnDate: { gte: position } },
      { returnDate: null, executionEndDate: { gte: position } },
      { cycles: { some: { demobilizationDate: { gte: position } } } },
      { cycles: { some: { mobilizationDate: { gte: position } } } },
      { allocations: { some: { deletedAt: null, cycles: { some: { OR: [
        { demobilizationDate: { gte: position } },
        { mobilizationDate: { gte: position } }
      ] } } } } }
    ]
  });
});

test('consulta inclui missões com mobilização individual anterior ao ciclo geral', () => {
  const position = new Date('2026-01-05T00:00:00.000Z');
  assert.deepEqual(missionStartsOnOrBefore(position), { AND: [{ OR: [
    { mobilizationDate: { lte: position } },
    { cycles: { some: { mobilizationDate: { lte: position } } } },
    { allocations: { some: { deletedAt: null, cycles: { some: { mobilizationDate: { lte: position } } } } } }
  ] }] });
});
