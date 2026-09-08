import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVacationAlert } from '../src/lib/efetivo/planning/vacation-alerts.js';

test('janela concessiva encerrada sem férias gera alerta vencido', () => {
  const alert = buildVacationAlert({ id: 'c1', admissionDate: '2024-01-01' }, [], '2026-01-01');
  assert.equal(alert.type, 'OVERDUE');
  assert.equal(alert.concessionDeadline, '2025-12-31');
});

test('férias registradas na janela eliminam o alerta daquele ciclo', () => {
  const alert = buildVacationAlert({ id: 'c1', admissionDate: '2024-01-01' }, [{ collaboratorId: 'c1', type: 'FERIAS', startDate: '2025-07-01', endDate: '2025-07-30' }], '2025-10-01');
  assert.equal(alert, null);
});

test('múltiplos ciclos vencidos priorizam o prazo mais antigo ainda aberto', () => {
  const alert = buildVacationAlert({ id: 'c1', admissionDate: '2022-01-01' }, [], '2026-08-21');
  assert.equal(alert.type, 'OVERDUE');
  assert.equal(alert.concessionDeadline, '2023-12-31');
});
