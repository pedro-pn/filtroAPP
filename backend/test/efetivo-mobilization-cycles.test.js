import assert from 'node:assert/strict';
import test from 'node:test';

import { validateNewCycle } from '../src/lib/efetivo/planning/cycles.js';

const mission = {
  mobilizationDate: '2026-07-01',
  executionEndDate: '2026-09-30',
  returnDate: '2026-09-30'
};

test('nova mobilização é bloqueada enquanto o colaborador possui ciclo aberto', () => {
  assert.throws(() => validateNewCycle([
    { id: 'cycle-open', mobilizationDate: '2026-07-07', demobilizationDate: null }
  ], {
    mobilizationDate: '2026-08-07',
    demobilizationDate: '2026-08-09'
  }, mission, 'Fellipe de Souza Drummond'), error => {
    assert.equal(error.code, 'OPEN_MOBILIZATION_CYCLE');
    assert.match(error.message, /Fellipe de Souza Drummond/);
    assert.match(error.message, /Registre a desmobilização.*antes de criar uma nova mobilização/i);
    return true;
  });
});

test('novo ciclo fechado é aceito depois da desmobilização anterior', () => {
  assert.deepEqual(validateNewCycle([
    { id: 'cycle-closed', mobilizationDate: '2026-07-07', demobilizationDate: '2026-07-09' }
  ], {
    mobilizationDate: '2026-08-07',
    demobilizationDate: '2026-08-09'
  }, mission, 'Colaborador'), {
    startDate: '2026-08-07',
    endDate: '2026-08-09'
  });
});

test('ciclos sobrepostos continuam bloqueados mesmo quando ambos estão fechados', () => {
  assert.throws(() => validateNewCycle([
    { id: 'cycle-closed', mobilizationDate: '2026-07-07', demobilizationDate: '2026-07-15' }
  ], {
    mobilizationDate: '2026-07-14',
    demobilizationDate: '2026-07-20'
  }, mission, 'Colaborador'), error => error.code === 'OVERLAPPING_MOBILIZATION_CYCLE');
});
