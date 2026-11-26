import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  reportAllCollaboratorIds,
  reportPersonTimeMetrics,
  reportWorkedMinutesByCollaborator
} from '../src/lib/acompanhamento/report-time.js';

test('reportPersonTimeMetrics multiplica horas diurnas, HE e stand-by pela equipe do dia', () => {
  const metrics = reportPersonTimeMetrics({
    daytimeCount: 3,
    daytimeWorkedMinutes: 8 * 60,
    nighttimeWorkedMinutes: 0,
    daytimeOvertimeMinutes: 60,
    nighttimeOvertimeMinutes: 0,
    specialConditions: {
      standby: true,
      standbyDetails: { total: '02:00' }
    }
  }, ['c1', 'c2', 'c3']);

  assert.equal(metrics.normalWorkedMinutes, 7 * 60 * 3);
  assert.equal(metrics.overtimeWorkedMinutes, 60 * 3);
  assert.equal(metrics.standbyPersonMinutes, 2 * 60 * 3);
});

test('reportPersonTimeMetrics deduplica colaboradores diurnos antes de multiplicar', () => {
  const metrics = reportPersonTimeMetrics({
    daytimeWorkedMinutes: 8 * 60,
    nighttimeWorkedMinutes: 0,
    specialConditions: {}
  }, ['c1', 'c1', 'c2']);

  assert.equal(metrics.normalWorkedMinutes, 8 * 60 * 2);
});

test('reportPersonTimeMetrics multiplica cada turno pela propria equipe', () => {
  const report = {
    daytimeCount: 2,
    daytimeWorkedMinutes: 8 * 60,
    nighttimeWorkedMinutes: 6 * 60,
    daytimeOvertimeMinutes: 60,
    nighttimeOvertimeMinutes: 30,
    specialConditions: {
      standby: true,
      standbyDetails: { total: '01:00' },
      noturnoDetails: { collaboratorIds: ['n1'] }
    }
  };
  const metrics = reportPersonTimeMetrics(report, ['d1', 'd2']);

  assert.equal(metrics.normalWorkedMinutes, (7 * 60 * 2) + (330 * 1));
  assert.equal(metrics.overtimeWorkedMinutes, (60 * 2) + 30);
  assert.equal(metrics.standbyPersonMinutes, 60 * 2);
  assert.deepEqual(reportAllCollaboratorIds(report, ['d1', 'd2']), ['d1', 'd2', 'n1']);
});

test('reportPersonTimeMetrics usa equipe noturna para relatório sem turno diurno', () => {
  const metrics = reportPersonTimeMetrics({
    daytimeCount: 0,
    daytimeWorkedMinutes: 0,
    nighttimeWorkedMinutes: 6 * 60,
    nighttimeOvertimeMinutes: 60,
    specialConditions: {
      standby: true,
      standbyDetails: { total: '01:30' },
      noturnoDetails: { collaboratorIds: ['n1', 'n2'] }
    }
  }, []);

  assert.equal(metrics.normalWorkedMinutes, 5 * 60 * 2);
  assert.equal(metrics.overtimeWorkedMinutes, 60 * 2);
  assert.equal(metrics.standbyPersonMinutes, 90 * 2);
});

test('reportWorkedMinutesByCollaborator acumula horas por pessoa em cada turno', () => {
  const report = {
    daytimeWorkedMinutes: 480,
    nighttimeWorkedMinutes: 360,
    specialConditions: {
      noturnoDetails: { collaboratorIds: ['n1'] }
    }
  };

  assert.deepEqual(
    Object.fromEntries(reportWorkedMinutesByCollaborator(report, ['d1', 'd2'])),
    {
      d1: 480,
      d2: 480,
      n1: 360
    }
  );
});

test('reportWorkedMinutesByCollaborator ignora colaboradores diurnos duplicados', () => {
  const report = {
    daytimeWorkedMinutes: 480,
    nighttimeWorkedMinutes: 0
  };

  assert.deepEqual(
    Object.fromEntries(reportWorkedMinutesByCollaborator(report, ['d1', 'd1', 'd2'])),
    {
      d1: 480,
      d2: 480
    }
  );
});

test('reportPersonTimeMetrics separa pausa por nossa conta do standby do cliente', () => {
  const metrics = reportPersonTimeMetrics({
    daytimeCount: 2,
    daytimeWorkedMinutes: 8 * 60,
    nighttimeWorkedMinutes: 0,
    specialConditions: {
      standby: true,
      standbyDetails: { total: '01:00' },
      internalStandby: true,
      internalStandbyDetails: { total: '00:30' }
    }
  }, ['c1', 'c2']);

  assert.equal(metrics.standbyDurationMinutes, 60);
  assert.equal(metrics.standbyPersonMinutes, 60 * 2);
  assert.equal(metrics.internalStandbyDurationMinutes, 30);
  assert.equal(metrics.internalStandbyPersonMinutes, 30 * 2);

  const disabled = reportPersonTimeMetrics({
    daytimeCount: 2,
    daytimeWorkedMinutes: 8 * 60,
    specialConditions: { internalStandby: false, internalStandbyDetails: { total: '00:30' } }
  }, ['c1', 'c2']);
  assert.equal(disabled.internalStandbyPersonMinutes, 0);
});
