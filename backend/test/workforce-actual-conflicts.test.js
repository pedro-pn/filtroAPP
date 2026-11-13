import assert from 'node:assert/strict';
import test from 'node:test';

import {
  actualWorkforceConflictSummary,
  annotateActualRowsWithWorkforceConflicts,
  classifyActualWorkforceDays,
  createActualWorkforceDayClassifier
} from '../src/lib/workforce/actual-conflicts.js';

const absenceConflict = {
  code: 'WORK_DURING_ABSENCE', collaboratorId: 'c1', sourceId: 'a1',
  startDate: '2026-08-10', endDate: '2026-08-12', policy: 'REQUIRE_JUSTIFICATION'
};

test('RDO exige justificativa para trabalho durante ausência e preserva o conflito auditável', () => {
  assert.throws(
    () => actualWorkforceConflictSummary({ revision: 3, conflicts: [absenceConflict] }),
    error => error.code === 'WORKFORCE_JUSTIFICATION_REQUIRED'
  );
  const result = actualWorkforceConflictSummary({ calendarRevision: 3, conflicts: [absenceConflict] }, 'Atendimento emergencial');
  assert.equal(result.justification, 'Atendimento emergencial');
  assert.deepEqual(result.conflicts, [absenceConflict]);
});

test('Ponto/Acompanhamento recebem sinalização sem alterar horas ou custos realizados', () => {
  const rows = [{ collaboratorId: 'c1', workedMinutes: 480, laborCost: 1200 }];
  const annotated = annotateActualRowsWithWorkforceConflicts(rows, [absenceConflict]);
  assert.equal(annotated[0].workedMinutes, 480);
  assert.equal(annotated[0].laborCost, 1200);
  assert.equal(annotated[0].workforceConflicts[0].code, 'WORK_DURING_ABSENCE');
});

test('Acompanhamento separa ausência, feriado e folga residual sem reclassificar fatos trabalhados', () => {
  const holidayConflict = {
    code: 'WORK_ON_HOLIDAY', collaboratorId: 'c1', sourceId: 'h1',
    startDate: '2026-08-11', endDate: '2026-08-11', policy: 'WARN'
  };
  const result = classifyActualWorkforceDays({
    startDate: '2026-08-10',
    endDate: '2026-08-14',
    workedDates: ['2026-08-10', '2026-08-11'],
    conflicts: [absenceConflict, holidayConflict]
  });
  assert.deepEqual(result.workedDuringAbsence, ['2026-08-10', '2026-08-11']);
  assert.deepEqual(result.workedOnHoliday, ['2026-08-11']);
  assert.deepEqual(result.absence, ['2026-08-12']);
  assert.deepEqual(result.residualDaysOff, ['2026-08-13', '2026-08-14']);
});

test('classificação compartilhada mantém fatos de fim de semana e ordem inclusiva no ano bissexto', () => {
  const classifyDays = createActualWorkforceDayClassifier({ startDate: '2024-02-28', endDate: '2024-03-04' });
  assert.deepEqual(classifyDays({
    workedDates: ['2024-03-03', '2024-02-29', '2024-03-02', '2024-02-28', '2024-02-29', '2024-03-05'],
    conflicts: [
      { code: 'WORK_DURING_ABSENCE', startDate: '2024-02-28', endDate: '2024-03-03' },
      ...['2024-02-29', '2024-03-02', '2024-03-04'].map(startDate => ({ code: 'WORK_ON_HOLIDAY', startDate }))
    ]
  }), {
    workedDuringAbsence: ['2024-02-28', '2024-02-29', '2024-03-02', '2024-03-03'],
    workedOnHoliday: ['2024-02-29', '2024-03-02'],
    absence: ['2024-03-01'], holiday: ['2024-03-04'], residualDaysOff: []
  });
  // Reusing the calendar must not retain the previous collaborator's facts.
  assert.deepEqual(classifyDays({
    workedDates: ['2024-03-04'], conflicts: [{ code: 'WORK_ON_HOLIDAY', startDate: '2024-03-01' }]
  }), {
    workedDuringAbsence: [], workedOnHoliday: [], absence: [], holiday: ['2024-03-01'],
    residualDaysOff: ['2024-02-28', '2024-02-29']
  });
});

test('ausência precede feriado sem trabalho e preserva limites de intervalos sobrepostos', () => {
  const classifyDays = createActualWorkforceDayClassifier({ startDate: '2024-02-28', endDate: '2024-03-04' });
  assert.deepEqual(classifyDays({ conflicts: [
    { code: 'WORK_DURING_ABSENCE', startDate: '2024-02-01', endDate: '2024-02-28' },
    { code: 'WORK_DURING_ABSENCE', startDate: '2024-02-28', endDate: '2024-02-29' },
    { code: 'WORK_ON_HOLIDAY', startDate: '2024-02-29' },
    { code: 'WORK_ON_HOLIDAY', startDate: '2024-03-04' },
    { code: 'UNRELATED', startDate: '2024-03-01', endDate: '2024-03-01' }
  ] }), {
    workedDuringAbsence: [], workedOnHoliday: [], absence: ['2024-02-28', '2024-02-29'],
    holiday: ['2024-03-04'], residualDaysOff: ['2024-03-01']
  });
});

test('resultados e fatos de colaboradores permanecem independentes entre chamadas', () => {
  const classifyDays = createActualWorkforceDayClassifier({ startDate: '2026-08-10', endDate: '2026-08-12' });
  const workedDates = ['2026-08-10'];
  const conflicts = [{ ...absenceConflict }];
  const first = classifyDays({ workedDates, conflicts });
  assert.deepEqual(first, {
    workedDuringAbsence: ['2026-08-10'], workedOnHoliday: [],
    absence: ['2026-08-11', '2026-08-12'], holiday: [], residualDaysOff: []
  });
  for (const values of Object.values(first)) values.push('mutated');
  workedDates.push('2026-08-11');
  conflicts[0].endDate = '2026-08-11';
  assert.deepEqual(classifyDays({ workedDates, conflicts }), {
    workedDuringAbsence: ['2026-08-10', '2026-08-11'], workedOnHoliday: [],
    absence: [], holiday: [], residualDaysOff: ['2026-08-12']
  });
  assert.deepEqual(classifyDays(), {
    workedDuringAbsence: [], workedOnHoliday: [], absence: [], holiday: [],
    residualDaysOff: ['2026-08-10', '2026-08-11', '2026-08-12']
  });
});

test('calendários não compartilham intervalos e preservam a virada do ano em UTC', () => {
  const yearEnd = createActualWorkforceDayClassifier({ startDate: '2023-12-29', endDate: '2024-01-01' });
  const leapDay = createActualWorkforceDayClassifier({ startDate: '2024-02-29', endDate: '2024-02-29' });
  assert.deepEqual(yearEnd().residualDaysOff, ['2023-12-29', '2024-01-01']);
  assert.deepEqual(leapDay().residualDaysOff, ['2024-02-29']);
  assert.deepEqual(yearEnd().residualDaysOff, ['2023-12-29', '2024-01-01']);
});

test('classificador mantém intervalo vazio, dia único e fins de semana sem trabalho', () => {
  const empty = { workedDuringAbsence: [], workedOnHoliday: [], absence: [], holiday: [], residualDaysOff: [] };
  for (const [startDate, endDate] of [
    ['2026-08-12', '2026-08-10'], ['2026-08-08', '2026-08-09'], ['2026-08-08', '2026-08-08']
  ]) {
    assert.deepEqual(classifyActualWorkforceDays({ startDate, endDate }), empty);
    assert.deepEqual(createActualWorkforceDayClassifier({ startDate, endDate })(), empty);
  }
  assert.deepEqual(classifyActualWorkforceDays({ startDate: '2026-08-10', endDate: '2026-08-10' }), {
    ...empty, residualDaysOff: ['2026-08-10']
  });
});
