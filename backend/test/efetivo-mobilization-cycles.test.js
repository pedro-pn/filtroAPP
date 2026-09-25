import assert from 'node:assert/strict';
import test from 'node:test';

import { assertCycleCreationStage, validateNewCycle } from '../src/lib/efetivo/planning/cycles.js';
import { allocationPeriods } from '../src/lib/efetivo/planning/allocation-period.js';

const mission = {
  mobilizationDate: '2026-07-01',
  executionEndDate: '2026-09-30',
  returnDate: '2026-09-30'
};

test('primeiro ciclo geral começa na mobilização e vale para todos os colaboradores sem datas individuais', () => {
  const plannedMission = {
    ...mission,
    cycles: [{ id: 'first', mobilizationDate: mission.mobilizationDate, demobilizationDate: mission.executionEndDate }]
  };
  for (const collaboratorId of ['c1', 'c2']) {
    assert.deepEqual(allocationPeriods({ collaboratorId, cycles: [], mobilizationDate: null, demobilizationDate: null }, plannedMission), [{
      id: 'first', startDate: '2026-07-01', endDate: '2026-09-30', isOpen: false
    }]);
  }
});

test('novos ciclos da programação oficial só são criados na execução', () => {
  for (const stage of ['STANDBY', 'MOBILIZATION', 'FINAL_MEASUREMENT']) {
    assert.throws(() => assertCycleCreationStage({ plan: { kind: 'OFFICIAL' }, stage }), error => error.code === 'MISSION_CYCLE_EXECUTION_REQUIRED');
  }
  assert.doesNotThrow(() => assertCycleCreationStage({ plan: { kind: 'OFFICIAL' }, stage: 'EXECUTION' }));
  assert.doesNotThrow(() => assertCycleCreationStage({ plan: { kind: 'SCENARIO' }, stage: 'STANDBY' }));
});

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
