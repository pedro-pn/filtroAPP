import assert from 'node:assert/strict';
import test from 'node:test';

import {
  actualWorkforceConflictSummary,
  annotateActualRowsWithWorkforceConflicts,
  classifyActualWorkforceDays
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
