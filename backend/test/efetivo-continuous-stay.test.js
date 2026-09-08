import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultContinuousWorkLimitDays, mergeContinuousMissionIntervals, splitIntervalsByRestDays } from '../src/lib/efetivo/planning/continuous-stay.js';

test('missões sobrepostas ou adjacentes formam uma sequência; lacuna quebra', () => {
  const merged = mergeContinuousMissionIntervals([{ missionId: 'm1', startDate: '2026-01-01', endDate: '2026-01-10' }, { missionId: 'm2', startDate: '2026-01-11', endDate: '2026-01-20' }, { missionId: 'm3', startDate: '2026-01-22', endDate: '2026-01-25' }]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].missionIds, ['m1', 'm2']);
});

test('FOLGA explícita divide a sequência no dia registrado', () => {
  const split = splitIntervalsByRestDays([{ startDate: '2026-01-01', endDate: '2026-01-10', missionIds: ['m1'] }], [{ type: 'FOLGA', startDate: '2026-01-05', endDate: '2026-01-05' }]);
  assert.deepEqual(split.map(item => [item.startDate, item.endDate]), [['2026-01-01', '2026-01-04'], ['2026-01-06', '2026-01-10']]);
});

test('fallback empresarial de permanência varia por categoria da função', () => {
  assert.equal(defaultContinuousWorkLimitDays('Operador de Guindaste'), 90);
  assert.equal(defaultContinuousWorkLimitDays('Encarregado'), 90);
  assert.equal(defaultContinuousWorkLimitDays('Supervisor de Operações'), 60);
  assert.equal(defaultContinuousWorkLimitDays('Coordenador de Contrato'), 30);
  assert.equal(defaultContinuousWorkLimitDays('Engenheira Mecânica'), 30);
});
