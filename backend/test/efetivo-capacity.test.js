import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateDailyCapacity, calculateUtilization90Days } from '../src/lib/efetivo/planning/capacity.js';
import { businessDatesInclusive, holidayDateSet, isBusinessDay } from '../src/lib/efetivo/planning/business-days.js';

test('posição operacional respeita ciclos abertos e o cálculo prospectivo conserva o término previsto', () => {
  const input = {
    date: '2026-10-16', endDate: '2026-10-16',
    jobRoles: [{ id: 'r1', name: 'Operador', isActive: true, isOperational: true }],
    collaborators: [{ id: 'c1', name: 'Pessoa', jobRoleId: 'r1', isActive: true }],
    missions: [{
      id: 'm1', stage: 'EXECUTION', scheduleStatus: 'CONFIRMED',
      mobilizationDate: '2026-07-06', executionEndDate: '2026-08-20', returnDate: null,
      cycles: [{ isDefault: true, mobilizationDate: '2026-07-06', demobilizationDate: null }],
      demands: [{ jobRoleId: 'r1', requiredCount: 1 }], allocations: [{ collaboratorId: 'c1' }]
    }]
  };
  assert.equal(calculateDailyCapacity(input).totals.free, 1);
  assert.equal(calculateDailyCapacity({ ...input, includeOpenCycles: true }).totals.allocated, 1);
  assert.equal(calculateUtilization90Days(input).committedPersonDays, 0);
});

for (const stage of ['MOBILIZATION', 'EXECUTION', 'FINAL_MEASUREMENT']) {
  test(`registro antigo sem ciclos nem saída efetiva continua mobilizado em ${stage}`, () => {
    const mission = {
      id: 'current', stage, scheduleStatus: 'CONFIRMED',
      mobilizationDate: '2026-10-04', executionEndDate: '2026-10-21', returnDate: null,
      demands: [{ jobRoleId: 'role', requiredCount: 2 }],
      allocations: [
        { collaboratorId: 'inherited' },
        { collaboratorId: 'individual', mobilizationDate: '2026-10-05', demobilizationDate: null }
      ]
    };
    const input = {
      date: '2026-10-27',
      jobRoles: [{ id: 'role', name: 'Operador', isActive: true, isOperational: true }],
      collaborators: ['inherited', 'individual'].map(id => ({ id, jobRoleId: 'role', isActive: true })),
      missions: [mission], includeOpenCycles: true
    };
    const result = calculateDailyCapacity(input);
    assert.equal(result.totals.allocated, 2);
    assert.equal(result.totals.demand, 2);
    assert.ok(result.statuses.every(person => person.mission.id === 'current'));

    mission.returnDate = '2026-10-26';
    mission.allocations[1].demobilizationDate = '2026-10-26';
    const demobilized = calculateDailyCapacity(input);
    assert.equal(demobilized.totals.allocated, 0);
    assert.equal(demobilized.totals.free, 2);
    assert.equal(demobilized.totals.demand, 0);
  });
}

test('fadiga offshore reduz capacidade e dias disponíveis, respeitando exclusão lógica', () => {
  const input = {
    date: '2026-09-01', endDate: '2026-09-04',
    jobRoles: [{ id: 'r1', name: 'Operador', isActive: true, isOperational: true }],
    collaborators: [{ id: 'c1', name: 'Ana', jobRoleId: 'r1', isActive: true }],
    absences: [{ id: 'a1', collaboratorId: 'c1', type: 'FADIGA_OFFSHORE', startDate: '2026-09-02', endDate: '2026-09-03' }]
  };
  assert.equal(calculateDailyCapacity({ ...input, date: '2026-09-02' }).totals.unavailable, 1);
  assert.equal(calculateUtilization90Days(input).availablePersonDays, 2);
  input.absences[0].deletedAt = new Date();
  assert.equal(calculateDailyCapacity({ ...input, date: '2026-09-02' }).totals.free, 1);
  assert.equal(calculateUtilization90Days(input).availablePersonDays, 4);
});

test('dia útil exclui fim de semana e feriado administrável', () => {
  const holidays = holidayDateSet([{ holidayDate: '2026-08-21', deletedAt: null }]);
  assert.equal(isBusinessDay('2026-08-21', holidays), false);
  assert.equal(isBusinessDay('2026-08-22', holidays), false);
  assert.deepEqual(businessDatesInclusive('2026-08-20', '2026-08-24', holidays), ['2026-08-20', '2026-08-24']);
});

test('capacidade aplica precedência indisponível sobre alocado e não duplica pessoa', () => {
  const result = calculateDailyCapacity({
    date: '2026-08-21',
    jobRoles: [{ id: 'r1', name: 'Operador', isActive: true, isOperational: true }],
    collaborators: [{ id: 'c1', name: 'Ana', role: 'Operador', jobRoleId: 'r1', admissionDate: '2026-01-01', isActive: true }, { id: 'c2', name: 'Bia', role: 'Operador', jobRoleId: 'r1', admissionDate: '2026-01-01', isActive: true }],
    absences: [{ id: 'a1', collaboratorId: 'c1', type: 'FOLGA', startDate: '2026-08-21', endDate: '2026-08-21', deletedAt: null }],
    missions: [{ id: 'm1', scheduleStatus: 'CONFIRMED', mobilizationDate: '2026-08-21', returnDate: '2026-08-22', demands: [{ jobRoleId: 'r1', requiredCount: 2 }], allocations: [{ collaboratorId: 'c1' }, { collaboratorId: 'c2' }] }]
  });
  assert.deepEqual(result.totals, { jobRoleId: 'all', jobRoleName: 'Total', active: 2, allocated: 1, unavailable: 1, free: 0, demand: 2, deficit: 1 });
  assert.equal(result.statuses.filter(item => item.collaborator.id === 'c1')[0].status, 'UNAVAILABLE');
});

test('função normalizada ambígua permanece pendente sem contaminar capacidade ou utilização', () => {
  const input = {
    date: '2026-08-21',
    jobRoles: [
      { id: 'r1', name: 'Operador', isActive: true, isOperational: true },
      { id: 'r2', name: ' operador ', isActive: true, isOperational: true }
    ],
    collaborators: [{
      id: 'c1',
      name: 'Ana',
      role: 'OPERADOR',
      jobRoleId: null,
      admissionDate: '2026-01-01',
      isActive: true
    }],
    missions: [],
    absences: [],
    holidays: []
  };

  const daily = calculateDailyCapacity(input);
  const utilization = calculateUtilization90Days(input);

  assert.equal(daily.statuses.length, 0);
  assert.equal(daily.totals.active, 0);
  assert.equal(utilization.availablePersonDays, 0);
  assert.deepEqual(utilization.byRole.map(item => item.availablePersonDays), [0]);
});

test('capacidade consolida níveis romanos na mesma família de cargo', () => {
  const result = calculateDailyCapacity({
    date: '2026-08-21',
    jobRoles: [
      { id: 'r1', name: 'Assistente de Operações I', isActive: true, isOperational: true },
      { id: 'r2', name: 'Assistente de Operações II', isActive: true, isOperational: true }
    ],
    collaborators: [
      { id: 'c1', name: 'Ana', jobRoleId: 'r1', admissionDate: '2026-01-01', isActive: true },
      { id: 'c2', name: 'Bia', jobRoleId: 'r2', admissionDate: '2026-01-01', isActive: true }
    ],
    missions: [{ id: 'm1', scheduleStatus: 'CONFIRMED', mobilizationDate: '2026-08-21', returnDate: '2026-08-21', demands: [
      { jobRoleId: 'r1', requiredCount: 1 }, { jobRoleId: 'r2', requiredCount: 1 }
    ], allocations: [{ collaboratorId: 'c1' }]}],
    absences: [],
    holidays: []
  });
  assert.equal(result.byRole.length, 1);
  assert.equal(result.byRole[0].jobRoleName, 'Assistente de Operações');
  assert.deepEqual(result.byRole[0].jobRoleIds, ['r1', 'r2']);
  assert.deepEqual({ active: result.byRole[0].active, allocated: result.byRole[0].allocated, demand: result.byRole[0].demand }, { active: 2, allocated: 1, demand: 2 });
});

test('capacidade considera somente o período individual do colaborador na missão', () => {
  const input = {
    jobRoles: [{ id: 'r1', name: 'Operador', isActive: true, isOperational: true }],
    collaborators: [{ id: 'c1', name: 'Ana', jobRoleId: 'r1', admissionDate: '2025-01-01', isActive: true }],
    absences: [],
    missions: [{
      id: 'm1',
      scheduleStatus: 'CONFIRMED',
      mobilizationDate: '2026-09-01',
      returnDate: '2026-09-30',
      demands: [{ jobRoleId: 'r1', requiredCount: 1 }],
      allocations: [{
        collaboratorId: 'c1',
        mobilizationDate: '2026-09-05',
        demobilizationDate: '2026-09-20'
      }]
    }]
  };
  assert.equal(calculateDailyCapacity({ ...input, date: '2026-09-04' }).statuses[0].status, 'FREE');
  assert.equal(calculateDailyCapacity({ ...input, date: '2026-09-05' }).statuses[0].status, 'ALLOCATED');
  assert.equal(calculateDailyCapacity({ ...input, date: '2026-09-20' }).statuses[0].status, 'ALLOCATED');
  assert.equal(calculateDailyCapacity({ ...input, date: '2026-09-21' }).statuses[0].status, 'FREE');
});
