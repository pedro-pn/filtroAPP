import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lastDayStatus } from '../src/lib/acompanhamento-project-cards.js';

const project = { workdayHours: '09:00', weekendWorkdayHours: '08:00' };
// Quarta-feira (dia útil, jornada 9h)
const weekday = new Date('2026-07-01T00:00:00Z');

test('lastDayStatus: sem RDO', () => {
  assert.deepEqual(lastDayStatus(null, project), { date: null, status: 'SEM_RDO' });
});

test('lastDayStatus: dia com trabalho (sem standby)', () => {
  const report = { reportDate: weekday, specialConditions: {} };
  assert.equal(lastDayStatus(report, project).status, 'TRABALHADO');
});

test('lastDayStatus: standby cobrindo a jornada cheia = parado', () => {
  const report = { reportDate: weekday, specialConditions: { standby: true, standbyDetails: { total: '09:00' } } };
  assert.equal(lastDayStatus(report, project).status, 'PARADO');
});

test('lastDayStatus: standby parcial ainda é trabalhado', () => {
  const report = { reportDate: weekday, specialConditions: { standby: true, standbyDetails: { total: '02:00' } } };
  assert.equal(lastDayStatus(report, project).status, 'TRABALHADO');
});

test('lastDayStatus: fim de semana usa jornada de 8h', () => {
  const saturday = new Date('2026-07-04T00:00:00Z'); // sábado
  const report = { reportDate: saturday, specialConditions: { standby: true, standbyDetails: { total: '08:00' } } };
  assert.equal(lastDayStatus(report, project).status, 'PARADO');
});
