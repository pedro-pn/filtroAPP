import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCorporateHoliday,
  nationalBrazilHolidays,
  resolveCorporateCalendar
} from '../src/lib/calendar/corporate-calendar.js';
import { calculateReportOvertime } from '../src/lib/overtime.js';

test('calendário corporativo reúne feriados fixos, móveis e manuais sem duplicar datas', () => {
  const calendar = resolveCorporateCalendar({
    startDate: '2026-02-01',
    endDate: '2026-05-05',
    revision: 7,
    manualHolidays: [
      { id: 'h1', holidayDate: '2026-03-16', name: 'Feriado da empresa' },
      { id: 'h2', holidayDate: '2026-04-21', name: 'Duplicado de Tiradentes' }
    ]
  });
  assert.equal(calendar.revision, 7);
  assert.equal(calendar.holidays.filter(item => item.date === '2026-04-21').length, 1);
  assert.equal(isCorporateHoliday('2026-03-16', calendar), true);
  assert.ok(nationalBrazilHolidays(2026).some(item => item.name === 'Paixão de Cristo'));
});

test('hora extra e Efetivo compartilham o mesmo feriado manual resolvido', () => {
  const calendar = resolveCorporateCalendar({
    startDate: '2026-03-16', endDate: '2026-03-16',
    manualHolidays: [{ holidayDate: '2026-03-16', name: 'Feriado da empresa' }]
  });
  const result = calculateReportOvertime({ workdayHours: '09:00' }, {
    reportDate: '2026-03-16', arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', specialConditions: {}
  }, calendar);
  assert.equal(result.isHoliday, true);
  assert.equal(result.expectedMinutes, 0);
  assert.equal(result.totalOvertimeMinutes, 480);
});
