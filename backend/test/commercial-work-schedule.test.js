import test from 'node:test';
import assert from 'node:assert/strict';
import { commercialProjectWorkSchedule } from '../src/lib/projects/commercial-work-schedule.js';
import { getExpectedMinutes } from '../src/lib/overtime.js';

function snapshot() {
  return { costBreakdown: { projectWorkScheduleContextId: 'execution',
    projectWorkSchedule: { workdayHours: 9, weekendWorkdayHours: 8 },
    laborContexts: [{ id: 'execution', hoursPerDay: 8.8, saturdayCount: 2, sundayCount: 0,
      saturdayHoursPerDay: 12, sundayHoursPerDay: 11, includeSaturday: true, includeSunday: false }] } };
}

test('o cadastro usa 9h/8h independentes das horas de cálculo e mantém os dias da fase escolhida', () => {
  const input = snapshot();
  const result = commercialProjectWorkSchedule(input);
  assert.deepEqual(result, { workdayHours: '09:00', weekendWorkdayHours: '08:00', includesSaturday: true, includesSunday: false });
  assert.equal(getExpectedMinutes(result, '2026-10-26'), 540);
  assert.equal(getExpectedMinutes(result, '2026-10-30'), 480);
  assert.equal(getExpectedMinutes(result, '2026-10-31'), 480);
  assert.equal(getExpectedMinutes(result, '2026-11-01'), 0);
  input.costBreakdown.projectWorkSchedule = { workdayHours: 7.5, weekendWorkdayHours: 6.25 };
  assert.equal(commercialProjectWorkSchedule(input).workdayHours, '07:30');
  assert.equal(commercialProjectWorkSchedule(input).weekendWorkdayHours, '06:15');
  input.costBreakdown.laborContexts[0].includeSunday = true;
  assert.equal(commercialProjectWorkSchedule(input).includesSunday, true);
});

test('cadastro inválido não recai silenciosamente nas horas do orçamento; ausência preserva o contrato anterior', () => {
  for (const schedule of [null, {}, { workdayHours: 9, weekendWorkdayHours: 0 },
    { workdayHours: 25, weekendWorkdayHours: 8 }, { workdayHours: '9', weekendWorkdayHours: 8 }]) {
    const input = snapshot();
    input.costBreakdown.projectWorkSchedule = schedule;
    assert.deepEqual(commercialProjectWorkSchedule(input), {});
  }
  const input = snapshot();
  delete input.costBreakdown.projectWorkSchedule;
  assert.equal(commercialProjectWorkSchedule(input).workdayHours, '08:48');
  input.costBreakdown.scopeConfirmations = { noLabor: true };
  assert.deepEqual(commercialProjectWorkSchedule(input), {});
});
