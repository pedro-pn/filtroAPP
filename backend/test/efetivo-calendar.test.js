import assert from 'node:assert/strict';
import test from 'node:test';

import { getPlanningCalendar } from '../src/lib/efetivo/planning/calendar.js';

test('calendário combina missão e três tipos de indisponibilidade com caminhos', async () => {
  const database = {
    efetivoPlan: { findFirst: async () => ({ id: 'p1' }) },
    efetivoMissionPlan: { findMany: async () => [{ id: 'm1', mobilizationDate: new Date('2026-08-20Z'), returnDate: new Date('2026-08-22Z'), project: { id: 'pr1', code: 'P-1', name: 'Obra', clientName: 'Cliente', location: 'RJ' }, demands: [{ jobRoleId: 'r1', requiredCount: 2 }], allocations: [{ collaborator: { id: 'c1', name: 'Ana' } }] }] },
    collaboratorAbsence: { findMany: async () => [{ id: 'a1', type: 'FOLGA', startDate: new Date('2026-08-21Z'), endDate: new Date('2026-08-21Z'), collaborator: { id: 'c2', name: 'Bia', role: 'Operador', jobRoleId: 'r1' } }] }
  };
  const result = await getPlanningCalendar({ startDate: '2026-08-01', endDate: '2026-08-31', jobRoleId: 'r1' }, { database });
  assert.deepEqual(result.events.map(item => item.type), ['MISSION', 'FOLGA']);
  assert.ok(result.events.every(item => item.entityPath.startsWith('/efetivo?')));
});

test('calendário aponta ausência sobreposta à missão e dupla alocação da mesma pessoa', async () => {
  const { collectCalendarConflicts } = await import('../src/lib/efetivo/planning/calendar.js');
  const ana = { id: 'c1', name: 'Ana' };
  const missions = [
    { id: 'm1', mobilizationDate: new Date('2026-08-20Z'), returnDate: new Date('2026-08-25Z'), allocations: [{ collaborator: ana }] },
    { id: 'm2', mobilizationDate: new Date('2026-08-24Z'), returnDate: new Date('2026-08-28Z'), allocations: [{ collaborator: ana }] }
  ];
  const absences = [{ id: 'a1', type: 'FERIAS', startDate: new Date('2026-08-21Z'), endDate: new Date('2026-08-22Z'), collaborator: ana }];
  const conflicts = collectCalendarConflicts(missions, absences);
  assert.deepEqual(conflicts.map(item => item.code), ['ABSENCE_FERIAS', 'DOUBLE_BOOKING']);
  const absence = conflicts[0];
  assert.equal(absence.startDate, '2026-08-21');
  assert.equal(absence.endDate, '2026-08-22');
  assert.ok(absence.entityPath.includes('missao=m1'));
  const double = conflicts.find(item => item.code === 'DOUBLE_BOOKING');
  assert.equal(double.startDate, '2026-08-24');
  assert.equal(double.endDate, '2026-08-25');
  assert.equal(double.collaboratorName, 'Ana');
  assert.ok(double.entityPath.includes('missao=m2'));
});

test('sem sobreposição o calendário não inventa conflito', async () => {
  const { collectCalendarConflicts } = await import('../src/lib/efetivo/planning/calendar.js');
  const conflicts = collectCalendarConflicts(
    [{ id: 'm1', mobilizationDate: new Date('2026-08-01Z'), returnDate: new Date('2026-08-05Z'), allocations: [{ collaborator: { id: 'c1', name: 'Ana' } }] }],
    [{ id: 'a1', type: 'FOLGA', startDate: new Date('2026-08-10Z'), endDate: new Date('2026-08-11Z'), collaborator: { id: 'c1', name: 'Ana' } }]
  );
  assert.deepEqual(conflicts, []);
});
