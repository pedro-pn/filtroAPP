import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildProjectStandbyHistory } from '../src/lib/acompanhamento/standby-history.js';

function report({
  id,
  date,
  total,
  reason = null,
  daytimeCount = 0,
  reportType = 'RDO',
  parentRdoId = null,
  standby = true,
  nightCollaboratorIds = []
}) {
  return {
    id,
    reportType,
    reportDate: date,
    daytimeCount,
    specialConditions: {
      standby,
      ...(parentRdoId ? { parentRdoId } : {}),
      standbyDetails: { total, motivo: reason },
      noturnoDetails: { collaboratorIds: nightCollaboratorIds }
    }
  };
}

test('histórico ignora dias sem standby positivo e ordena os restantes do mais recente', () => {
  const entries = buildProjectStandbyHistory([
    report({ id: 'r1', date: new Date('2026-08-21T00:00:00.000Z'), total: '00:00' }),
    report({ id: 'r2', date: new Date('2026-08-22T00:00:00.000Z'), total: '02:30', reason: 'Aguardando cliente' }),
    report({ id: 'r3', date: new Date('2026-08-23T00:00:00.000Z'), total: 'inválido' }),
    report({ id: 'r4', date: new Date('2026-08-24T00:00:00.000Z'), total: '01:15', standby: false })
  ], [
    { reportId: 'r2', collaboratorId: 'c1' },
    { reportId: 'r2', collaboratorId: 'c2' }
  ]);

  assert.deepEqual(entries, [{
    date: '2026-08-22',
    standbyMinutes: 150,
    internalStandbyMinutes: 0,
    collaboratorCount: 2,
    reason: 'Aguardando cliente',
    internalReason: null
  }]);
});

test('histórico agrega fontes do mesmo dia sem duplicar colaboradores ou motivos', () => {
  const entries = buildProjectStandbyHistory([
    report({
      id: 'rdo-1',
      date: new Date('2026-08-20T00:00:00.000Z'),
      total: '01:30',
      reason: 'Chuva',
      daytimeCount: 2
    }),
    report({
      id: 'service-1',
      reportType: 'SERVICE',
      date: new Date('2026-08-20T12:00:00.000Z'),
      total: 45,
      reason: 'Aguardando cliente',
      nightCollaboratorIds: ['c3']
    }),
    report({
      id: 'derived-1',
      reportType: 'SERVICE',
      parentRdoId: 'rdo-1',
      date: new Date('2026-08-20T13:00:00.000Z'),
      total: '01:30',
      reason: 'Chuva'
    })
  ], [
    { reportId: 'rdo-1', collaboratorId: 'c1' },
    { reportId: 'rdo-1', collaboratorId: 'c2' },
    { reportId: 'service-1', collaboratorId: 'c2' },
    { reportId: 'derived-1', collaboratorId: 'c4' }
  ]);

  assert.deepEqual(entries, [{
    date: '2026-08-20',
    standbyMinutes: 135,
    internalStandbyMinutes: 0,
    collaboratorCount: 3,
    reason: 'Chuva · Aguardando cliente',
    internalReason: null
  }]);
});

test('histórico usa efetivo legado sem inventar valor e preserva motivo ausente', () => {
  const entries = buildProjectStandbyHistory([
    report({ id: 'legacy-count', date: '2026-08-25', total: '01:00', daytimeCount: 5, reason: '  ' }),
    report({ id: 'legacy-empty', date: '2026-08-19', total: '00:30', daytimeCount: 0 }),
    report({ id: 'invalid-date', date: 'sem-data', total: '03:00', daytimeCount: 9 })
  ]);

  assert.deepEqual(entries, [
    {
      date: '2026-08-25',
      standbyMinutes: 60,
      internalStandbyMinutes: 0,
      collaboratorCount: 5,
      reason: null,
      internalReason: null
    },
    {
      date: '2026-08-19',
      standbyMinutes: 30,
      internalStandbyMinutes: 0,
      collaboratorCount: null,
      reason: null,
      internalReason: null
    }
  ]);
});

test('histórico separa standby do cliente e pausas por nossa conta no mesmo dia', () => {
  const entries = buildProjectStandbyHistory([
    {
      id: 'r1',
      reportType: 'RDO',
      reportDate: '2026-11-20',
      daytimeCount: 3,
      specialConditions: {
        standby: true,
        standbyDetails: { total: '02:00', motivo: 'Aguardando PT' },
        internalStandby: true,
        internalStandbyDetails: { total: '01:00', motivo: 'Falha na bomba' }
      }
    },
    {
      id: 'r2',
      reportType: 'RDO',
      reportDate: '2026-11-21',
      daytimeCount: 2,
      specialConditions: {
        standby: false,
        internalStandby: true,
        internalStandbyDetails: { total: '00:45', motivo: 'Acidente' }
      }
    }
  ]);

  assert.deepEqual(entries, [
    { date: '2026-11-21', standbyMinutes: 0, internalStandbyMinutes: 45, collaboratorCount: 2, reason: null, internalReason: 'Acidente' },
    { date: '2026-11-20', standbyMinutes: 120, internalStandbyMinutes: 60, collaboratorCount: 3, reason: 'Aguardando PT', internalReason: 'Falha na bomba' }
  ]);
});
