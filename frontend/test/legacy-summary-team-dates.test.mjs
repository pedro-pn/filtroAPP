import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLegacySummaryTeamDates } from '../src/pages/efetivo/components/legacySummaryTeamDates.ts';

const emptyMission = {
  mobilizationDate: null,
  executionStartDate: null,
  executionEndDate: null,
  returnDate: null
};

test('o início informado no resumo libera o período da equipe quando a missão legada não tem datas', () => {
  const dates = resolveLegacySummaryTeamDates(null, emptyMission, {
    startDate: '2026-09-01', endDate: '', demobilizationDate: ''
  }, '2026-09-24');

  assert.deepEqual(dates, {
    mobilizationDate: '2026-09-01',
    executionStartDate: '2026-09-01',
    executionEndDate: '2026-09-24',
    returnDate: null,
    teamEndDate: '2026-09-24'
  });
});

test('datas existentes são normalizadas e delimitam a consulta e a edição da equipe', () => {
  const dates = resolveLegacySummaryTeamDates({
    mobilizationDate: '2026-03-01T00:00:00.000Z',
    executionStartDate: '2026-03-02T00:00:00.000Z',
    executionEndDate: '2026-03-25T00:00:00.000Z',
    returnDate: '2026-03-27T00:00:00.000Z'
  }, emptyMission, { startDate: '2026-03-02', endDate: '', demobilizationDate: '' }, '2026-09-24');

  assert.deepEqual(dates, {
    mobilizationDate: '2026-03-01',
    executionStartDate: '2026-03-02',
    executionEndDate: '2026-03-25',
    returnDate: '2026-03-27',
    teamEndDate: '2026-03-27'
  });
});

test('fim ausente ou anterior ao início não bloqueia a edição da equipe', () => {
  const dates = resolveLegacySummaryTeamDates({
    mobilizationDate: '2026-09-20',
    executionStartDate: '2026-10-01',
    executionEndDate: '2026-09-15',
    returnDate: '2026-09-18'
  }, emptyMission, { startDate: '2026-10-01', endDate: '', demobilizationDate: '' }, '2026-09-24');

  assert.equal(dates.executionEndDate, '2026-10-01');
  assert.equal(dates.teamEndDate, '2026-10-01');
  assert.equal(dates.returnDate, null);
});
