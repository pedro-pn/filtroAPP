import assert from 'node:assert/strict';
import test from 'node:test';
import { countStoppedReportDays, projectElapsedDays, reportDayStatus } from '../src/lib/acompanhamento/project-time-summary.js';

test('dias úteis seguem o período decorrido, excluindo fins de semana e a referência', () => {
  assert.deepEqual(projectElapsedDays('2026-09-01', '2026-09-10'), { elapsedDays: 9, businessDays: 7 });
  assert.deepEqual(projectElapsedDays('2026-09-04', '2026-09-07'), { elapsedDays: 3, businessDays: 1 });
  assert.deepEqual(projectElapsedDays('2026-09-01T12:00:00Z', '2026-09-15T03:00:00Z'), { elapsedDays: 13, businessDays: 10 });
  assert.deepEqual(projectElapsedDays('2024-02-28', '2024-03-04'), { elapsedDays: 5, businessDays: 3 });
});

test('dias não inventam início e não ficam negativos em missões futuras', () => {
  for (const value of [null, undefined, '', 'inválida']) {
    assert.deepEqual(projectElapsedDays(value, '2026-09-10'), { elapsedDays: null, businessDays: null });
  }
  assert.deepEqual(projectElapsedDays('2026-09-11', '2026-09-10'), { elapsedDays: 0, businessDays: 0 });
  assert.deepEqual(projectElapsedDays('2026-09-10', '2026-09-10'), { elapsedDays: 0, businessDays: 0 });
});

test('referência encerrada congela o período de projetos arquivados e divisões', () => {
  assert.deepEqual(projectElapsedDays('2026-09-01', new Date('2026-09-04T12:00:00Z')), { elapsedDays: 3, businessDays: 3 });
});

test('dias parados contam todo o histórico agregado, com a jornada de cada data', () => {
  const byDay = new Map(Array.from({ length: 20 }, (_, index) => {
    const reportDate = new Date(Date.UTC(2026, 8, index + 1));
    return [reportDate.toISOString().slice(0, 10), { reportDate, statusStandbyMin: index === 0 ? 540 : index === 4 ? 480 : index === 12 ? 120 : 0 }];
  }));
  const journey = date => [0, 6].includes(date.getUTCDay()) ? 480 : 540;
  assert.equal(countStoppedReportDays(byDay, journey), 2);
  assert.equal(reportDayStatus(120, 540), 'STANDBY');
  assert.equal(reportDayStatus(540, 540), 'PARADO');
  assert.equal(reportDayStatus(480, 480), 'PARADO');
  assert.equal(reportDayStatus(0, 540), 'TRABALHADO');
  assert.equal(reportDayStatus(540, 0), 'STANDBY');
});
