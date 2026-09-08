import assert from 'node:assert/strict';
import test from 'node:test';

import { addCalendarDays, eachDateInclusive, parseDateKey, periodsOverlap } from '../src/lib/efetivo/planning/date-only.js';
import { conflictDescriptor, conflictError } from '../src/lib/efetivo/planning/errors.js';
import { lockOfficialPlanningState } from '../src/lib/efetivo/planning/plan-context.js';
import { absenceInputSchema, intervalQuerySchema, missionInputSchema } from '../src/lib/efetivo/planning/schemas.js';

test('datas civis validam ano bissexto e rejeitam data impossível', () => {
  assert.equal(parseDateKey('2024-02-29'), '2024-02-29');
  assert.throws(() => parseDateKey('2026-02-29'), /válida/i);
  assert.throws(() => parseDateKey('2026-02-30'), /válida/i);
});

test('iteração UTC e sobreposição usam limites inclusivos', () => {
  assert.equal(addCalendarDays('2026-10-31', 1), '2026-11-01');
  assert.deepEqual(eachDateInclusive('2026-01-30', '2026-02-01'), ['2026-01-30', '2026-01-31', '2026-02-01']);
  assert.equal(periodsOverlap({ startDate: '2026-01-01', endDate: '2026-01-10' }, { startDate: '2026-01-10', endDate: '2026-01-11' }), true);
  assert.equal(periodsOverlap({ startDate: '2026-01-01', endDate: '2026-01-09' }, { startDate: '2026-01-10', endDate: '2026-01-11' }), false);
});

test('schemas liberam somente os três tipos de indisponibilidade definidos', () => {
  const base = { collaboratorId: 'c1', startDate: '2026-01-01', endDate: '2026-01-02' };
  for (const type of ['FERIAS', 'FOLGA', 'AFASTAMENTO']) assert.equal(absenceInputSchema.parse({ ...base, type }).type, type);
  assert.equal(absenceInputSchema.safeParse({ ...base, type: 'ASO' }).success, false);
});

test('schema de missão exige campos completos e erro preserva conflito navegável', () => {
  assert.equal(missionInputSchema.safeParse({}).success, false);
  const descriptor = conflictDescriptor({ collaborator: { id: 'c1', name: 'Ana' }, startDate: '2026-01-01', endDate: '2026-01-02', sourceType: 'MISSION', sourceId: 'm1', entityPath: '/efetivo?missao=m1' });
  const error = conflictError('Conflito', [descriptor]);
  assert.equal(error.statusCode, 409);
  assert.equal(error.conflicts[0].collaboratorName, 'Ana');
  assert.equal(error.conflicts[0].entityPath, '/efetivo?missao=m1');
});

test('calendário limita consultas extensas sem restringir o ano operacional', () => {
  assert.equal(intervalQuerySchema.safeParse({ startDate: '2026-01-01', endDate: '2027-01-06' }).success, true);
  assert.equal(intervalQuerySchema.safeParse({ startDate: '2026-01-01', endDate: '2027-01-07' }).success, false);
});

test('lock oficial usa executeRaw para não desserializar o retorno void do PostgreSQL', async () => {
  const calls = [];
  await lockOfficialPlanningState({ $executeRawUnsafe: async (...args) => calls.push(args) });
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /pg_advisory_xact_lock/);
  assert.equal(calls[0][1], 'efetivo-planning-official');
});
