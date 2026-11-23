import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCorporateCalendar } from '../src/lib/calendar/corporate-calendar.js';
import { calculateReportOvertime, getExpectedMinutes } from '../src/lib/overtime.js';

const project = {
  workdayHours: '12:00',
  weekendWorkdayHours: '12:00',
  includesSaturday: true,
  includesSunday: true
};
const shift = {
  reportDate: '2026-11-20',
  arrivalTime: '06:00',
  departureTime: '18:00',
  lunchBreak: '01:00:00',
  specialConditions: {}
};

test('jornada de 12h incluindo domingo não gera extra em 20/11 para 06h–18h com 1h de intervalo', () => {
  const calendar = resolveCorporateCalendar({ startDate: shift.reportDate, endDate: shift.reportDate });
  for (const source of [null, calendar]) {
    const result = calculateReportOvertime(project, shift, source);
    assert.equal(result.isHoliday, true);
    assert.equal(result.expectedMinutes, 720);
    assert.equal(result.daytimeWorkedMinutes, 660);
    assert.equal(result.totalOvertimeMinutes, 0);
  }
});

for (const [date, name] of [
  ['2026-04-21', 'feriado nacional em dia útil'],
  ['2026-11-15', 'feriado nacional no domingo'],
  ['2026-03-16', 'feriado manual em dia útil'],
  ['2026-08-15', 'feriado manual no sábado sem incluir sábados']
]) {
  test(`${name} usa a jornada de domingo quando incluído`, () => {
    const calendar = resolveCorporateCalendar({
      startDate: date, endDate: date,
      manualHolidays: [{ holidayDate: date, name: 'Feriado da empresa' }]
    });
    const policy = { ...project, workdayHours: '09:00', weekendWorkdayHours: '08:00', includesSaturday: false };
    assert.equal(getExpectedMinutes(policy, date, calendar), 480);
  });
}

test('sem incluir domingo, feriados continuam com toda a jornada como hora extra', () => {
  for (const includesSunday of [false, undefined, null]) {
    const result = calculateReportOvertime({ ...project, includesSunday }, shift);
    assert.equal(result.isHoliday, true);
    assert.equal(result.expectedMinutes, 0);
    assert.equal(result.totalOvertimeMinutes, 660);
  }
});

test('dias sem feriado preservam jornadas e inclusão de sábado e domingo', () => {
  const policy = { ...project, workdayHours: '09:00', weekendWorkdayHours: '08:00', includesSaturday: false };
  assert.equal(getExpectedMinutes(policy, '2026-11-19'), 540);
  assert.equal(getExpectedMinutes(policy, '2026-10-30'), 480);
  assert.equal(getExpectedMinutes(policy, '2026-11-21'), 0);
  assert.equal(getExpectedMinutes(policy, '2026-11-22'), 480);
});

test('feriados incluídos preservam a tolerância e cobram o excedente real da jornada', () => {
  for (const [departureTime, overtime] of [['19:30', 0], ['19:31', 31], ['20:00', 60]]) {
    const result = calculateReportOvertime(project, { ...shift, departureTime });
    assert.equal(result.totalOvertimeMinutes, overtime, departureTime);
  }
});

test('turno noturno em feriado incluído também usa a jornada configurada', () => {
  const result = calculateReportOvertime(project, {
    ...shift,
    specialConditions: { noturno: true, noturnoDetails: { inicio: '18:00', termino: '08:00', intervalo: '01:00' } }
  });
  assert.equal(result.daytimeOvertimeMinutes, 0);
  assert.equal(result.nighttimeWorkedMinutes, 780);
  assert.equal(result.nighttimeOvertimeMinutes, 60);
  assert.equal(result.totalOvertimeMinutes, 60);
});
