import assert from 'node:assert/strict';
import test from 'node:test';

import { projectExecutionStartSuggestion } from '../src/utils/projectExecutionStart.ts';

const today = '2026-10-09';

test('início real já registrado prevalece ao retornar à execução', () => {
  assert.deepEqual(projectExecutionStartSuggestion({
    startDate: '2026-09-12T00:00:00.000Z',
    operationalMission: { executionStartDate: '2026-09-10' }
  }, '2026-09-08', today), { suggestedStartDate: '2026-09-12', futureDate: null });
});

test('sem início real, a sugestão vem da missão e depois do planejamento do projeto', () => {
  assert.deepEqual(projectExecutionStartSuggestion({
    startDate: null,
    operationalMission: { executionStartDate: '2026-09-10T00:00:00.000Z' }
  }, '2026-09-08', today), { suggestedStartDate: '2026-09-10', futureDate: null });
  assert.deepEqual(projectExecutionStartSuggestion({ startDate: null, operationalMission: null }, '2026-09-08', today), { suggestedStartDate: '2026-09-08', futureDate: null });
  assert.deepEqual(projectExecutionStartSuggestion({}, null, today), { suggestedStartDate: '', futureDate: null });
});

test('previsão de 22/10 não preenche início real em 09/10 nem usa uma previsão anterior como substituta', () => {
  assert.deepEqual(projectExecutionStartSuggestion({
    startDate: null,
    operationalMission: { executionStartDate: '2026-10-22T00:00:00.000Z' }
  }, '2026-10-01', today), { suggestedStartDate: '', futureDate: '2026-10-22' });
  assert.deepEqual(projectExecutionStartSuggestion({}, '2026-10-22', today), { suggestedStartDate: '', futureDate: '2026-10-22' });
});

test('início real existente prevalece sobre programação futura e a data de hoje é aceita', () => {
  assert.deepEqual(projectExecutionStartSuggestion({
    startDate: '2026-10-09',
    operationalMission: { executionStartDate: '2026-10-22' }
  }, '2026-10-23', today), { suggestedStartDate: today, futureDate: null });
});

test('início real legado preenchido no futuro também exige uma nova data válida', () => {
  assert.deepEqual(projectExecutionStartSuggestion({
    startDate: '2026-10-22',
    operationalMission: { executionStartDate: '2026-10-01' }
  }, '2026-10-02', today), { suggestedStartDate: '', futureDate: '2026-10-22' });
});
