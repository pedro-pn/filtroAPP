import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildWorkedHoursProgress,
  deriveProjectCardCategory,
  deriveProjectTrackingState,
  lastDayStatus
} from '../src/lib/acompanhamento/project-cards.js';

test('arquivamento do acompanhamento é independente do status de relatórios', () => {
  assert.deepEqual(deriveProjectTrackingState({ archivedInReports: false, archivedAt: '2026-08-06' }), {
    archived: true,
    archivedInReports: false,
    archivedInAcompanhamento: true,
    reviewed: false,
    reviewedAt: null
  });
  assert.equal(deriveProjectTrackingState({ archivedInReports: true }).archived, true);
});

test('conferência só aparece para projeto efetivamente arquivado', () => {
  const reviewedAt = '2026-08-06T12:00:00.000Z';
  assert.equal(deriveProjectTrackingState({ reviewedAt }).reviewed, false);
  assert.equal(deriveProjectTrackingState({ archivedInReports: true, reviewedAt }).reviewed, true);
  assert.equal(deriveProjectTrackingState({ archivedAt: '2026-08-06', reviewedAt }).reviewedAt, reviewedAt);
});

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

test('buildWorkedHoursProgress separa horas normais e extras sobre o previsto total', () => {
  const out = buildWorkedHoursProgress({
    normalWorkedMinutes: 480,
    overtimeWorkedMinutes: 120,
    plannedNormalHours: 10,
    plannedOvertimeHours: 2
  });

  assert.deepEqual(out, {
    normalWorkedHours: 8,
    overtimeWorkedHours: 2,
    totalWorkedHours: 10,
    plannedNormalHours: 10,
    plannedOvertimeHours: 2,
    plannedTotalHours: 12,
    normalPct: 67,
    overtimePct: 17,
    totalPct: 83
  });
});

test('buildWorkedHoursProgress sem previsto não calcula percentuais', () => {
  const out = buildWorkedHoursProgress({ normalWorkedMinutes: 60, overtimeWorkedMinutes: 30 });

  assert.equal(out.plannedTotalHours, null);
  assert.equal(out.normalPct, null);
  assert.equal(out.overtimePct, null);
  assert.equal(out.totalPct, null);
});

test('deriveProjectCardCategory: arquivado sempre fica em arquivados', () => {
  assert.equal(deriveProjectCardCategory({
    archived: true,
    workedDays: 0,
    workedHours: { totalWorkedHours: 0 },
    progressPct: 0
  }), 'ARQUIVADO');
});

test('deriveProjectCardCategory: ativo sem dias, horas e avanço fica em futuros', () => {
  assert.equal(deriveProjectCardCategory({
    archived: false,
    workedDays: 0,
    workedHours: { totalWorkedHours: 0 },
    progressPct: null
  }), 'FUTURO');
});

test('deriveProjectCardCategory: dias, horas ou avanço tiram de futuros', () => {
  assert.equal(deriveProjectCardCategory({
    archived: false,
    workedDays: 1,
    workedHours: { totalWorkedHours: 0 },
    progressPct: 0
  }), 'ANDAMENTO');
  assert.equal(deriveProjectCardCategory({
    archived: false,
    workedDays: 0,
    workedHours: { totalWorkedHours: 0.5 },
    progressPct: 0
  }), 'ANDAMENTO');
  assert.equal(deriveProjectCardCategory({
    archived: false,
    workedDays: 0,
    workedHours: { totalWorkedHours: 0 },
    progressPct: 0.1
  }), 'ANDAMENTO');
});
