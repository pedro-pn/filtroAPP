import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';

let server;
let calculateReportOvertimeSummary;
let getExpectedReportMinutes;
before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  ({ calculateReportOvertimeSummary, getExpectedReportMinutes } = await server.ssrLoadModule('/src/utils/reportOvertime.ts'));
});
after(async () => { await server?.close(); });

const policy = {
  workdayHours: '12:00',
  weekendWorkdayHours: '12:00',
  includesSaturday: true,
  includesSunday: true
};
const shift = {
  policy,
  reportDate: '2026-11-20',
  arrivalTime: '06:00',
  departureTime: '18:00',
  lunchBreak: '01:00:00',
  nightEnabled: false,
  nightArrivalTime: '',
  nightDepartureTime: '',
  nightBreak: '',
  isHoliday: true
};

test('prévia de 20/11 não indica hora extra para 11h trabalhadas numa jornada de 12h incluindo domingo', () => {
  const result = calculateReportOvertimeSummary(shift);
  assert.equal(result.isHoliday, true);
  assert.equal(result.expectedMinutes, 720);
  assert.equal(result.daytimeWorkedMinutes, 660);
  assert.equal(result.totalOvertimeMinutes, 0);
});

test('feriados em qualquer dia usam a jornada de domingo, inclusive com sábado desmarcado', () => {
  const schedule = { ...policy, workdayHours: '09:00', weekendWorkdayHours: '08:00', includesSaturday: false };
  for (const date of ['2026-04-21', '2026-11-15', '2026-03-16', '2026-08-15']) {
    assert.equal(getExpectedReportMinutes(schedule, date, true), 480, date);
  }
});

test('sem incluir domingo, a prévia mantém todas as horas do feriado como extras', () => {
  for (const includesSunday of [false, undefined, null]) {
    const result = calculateReportOvertimeSummary({ ...shift, policy: { ...policy, includesSunday } });
    assert.equal(result.expectedMinutes, 0);
    assert.equal(result.totalOvertimeMinutes, 660);
  }
});

test('prévia preserva jornadas de dias sem feriado', () => {
  const schedule = { ...policy, workdayHours: '09:00', weekendWorkdayHours: '08:00', includesSaturday: false };
  assert.equal(getExpectedReportMinutes(schedule, '2026-11-19', false), 540);
  assert.equal(getExpectedReportMinutes(schedule, '2026-10-30', false), 480);
  assert.equal(getExpectedReportMinutes(schedule, '2026-11-21', false), 0);
  assert.equal(getExpectedReportMinutes(schedule, '2026-11-22', false), 480);
});

test('prévia em feriado incluído preserva tolerância e excedente real', () => {
  for (const [departureTime, overtime] of [['19:30', 0], ['19:31', 31], ['20:00', 60]]) {
    const result = calculateReportOvertimeSummary({ ...shift, departureTime });
    assert.equal(result.totalOvertimeMinutes, overtime, departureTime);
  }
});

test('prévia noturna também respeita a jornada de domingo no feriado', () => {
  const result = calculateReportOvertimeSummary({
    ...shift, nightEnabled: true, nightArrivalTime: '18:00', nightDepartureTime: '08:00', nightBreak: '01:00'
  });
  assert.equal(result.daytimeOvertimeMinutes, 0);
  assert.equal(result.nighttimeWorkedMinutes, 780);
  assert.equal(result.nighttimeOvertimeMinutes, 60);
  assert.equal(result.totalOvertimeMinutes, 60);
});
