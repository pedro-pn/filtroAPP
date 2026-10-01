import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeAlerts } from '../src/lib/acompanhamento/alerts.js';

const now = new Date('2026-07-02T00:00:00Z');
const codes = (alerts) => alerts.map(a => a.code).sort();

test('sem início: nenhum alerta de prazo/parado', () => {
  const alerts = computeAlerts({ startDate: null, plannedDays: 30, now });
  assert.deepEqual(codes(alerts), []);
});

test('prazo estourado (danger) quando dias corridos > previstos', () => {
  const alerts = computeAlerts({ startDate: '2026-05-01T00:00:00Z', plannedDays: 30, now });
  const prazo = alerts.find(a => a.code === 'PRAZO');
  assert.equal(prazo?.level, 'danger');
});

test('prazo em risco (warn) entre 90% e 100%', () => {
  const alerts = computeAlerts({ startDate: '2026-06-05T00:00:00Z', plannedDays: 30, now }); // ~27/30 dias
  const prazo = alerts.find(a => a.code === 'PRAZO');
  assert.equal(prazo?.level, 'warn');
});

test('custo acima do previsto (danger)', () => {
  const alerts = computeAlerts({ gasto: 120, plannedCost: 100, now });
  const custo = alerts.find(a => a.code === 'CUSTO');
  assert.equal(custo?.level, 'danger');
});

test('percentual zerado sinaliza custo realizado acima do previsto e não confunde orçamento ausente', () => {
  assert.ok(computeAlerts({ gasto: 1, plannedCost: 0 }).some(alert => alert.code === 'CUSTO' && alert.level === 'danger'));
  assert.deepEqual(computeAlerts({ gasto: 0, plannedCost: 0 }), []);
  assert.deepEqual(computeAlerts({ gasto: 1, plannedCost: null }), []);
});

test('parado há N dias (danger) quando último RDO é antigo', () => {
  const alerts = computeAlerts({
    startDate: '2026-06-01T00:00:00Z', lastRdoDate: '2026-06-20T00:00:00Z', now
  });
  const parado = alerts.find(a => a.code === 'PARADO');
  assert.equal(parado?.level, 'danger');
});

test('último dia em standby (warn) quando RDO recente', () => {
  const alerts = computeAlerts({
    startDate: '2026-06-01T00:00:00Z', lastRdoDate: '2026-07-01T00:00:00Z', lastDayStatus: 'PARADO', now
  });
  assert.ok(alerts.some(a => a.code === 'STANDBY' && a.level === 'warn'));
  assert.ok(!alerts.some(a => a.code === 'PARADO'));
});

test('projeto concluído (100%) suprime prazo/parado', () => {
  const alerts = computeAlerts({
    startDate: '2026-05-01T00:00:00Z', plannedDays: 30, lastRdoDate: '2026-06-01T00:00:00Z',
    progressPct: 100, now
  });
  assert.ok(!alerts.some(a => a.code === 'PRAZO' || a.code === 'PARADO'));
});
