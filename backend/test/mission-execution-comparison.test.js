import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMissionExecutionComparison } from '../src/lib/efetivo/planning/execution-comparison.js';

test('comparação separa planejado, observado e exceções sem mutar entradas', () => {
  const mission = {
    id: 'm1', projectId: 'p1', stage: 'MOBILIZATION', updatedAt: '2026-08-01T00:00:00Z',
    mobilizationDate: '2026-08-01', executionStartDate: '2026-08-02', executionEndDate: '2026-08-10', returnDate: '2026-08-11',
    allocations: [{ collaboratorId: 'c1', collaborator: { name: 'Ana' }, jobRoleNameSnapshot: 'Técnica', deletedAt: null }]
  };
  const reports = [{
    reportDate: '2026-08-03', updatedAt: '2026-08-03T18:00:00Z', daytimeWorkedMinutes: 480, nighttimeWorkedMinutes: 0, totalOvertimeMinutes: 30,
    specialConditions: { workforceContext: { conflicts: [{ code: 'WORK_DURING_ABSENCE' }] } },
    collaborators: [{ collaboratorId: 'c2', roleNameSnapshot: 'Operador', collaborator: { name: 'Bruno' } }]
  }];
  const before = JSON.stringify({ mission, reports });
  const result = buildMissionExecutionComparison(mission, reports, { pct: 50 });
  assert.deepEqual(result.divergences.missingPlannedCollaboratorIds, ['c1']);
  assert.deepEqual(result.divergences.unplannedObservedCollaboratorIds, ['c2']);
  assert.equal(result.observed.totalWorkedMinutes, 480);
  assert.equal(result.suggestion.stage, 'EXECUTION');
  assert.equal(JSON.stringify({ mission, reports }), before);
});

test('avanço completo apenas sugere etapa final, sem mover a missão', () => {
  const mission = {
    id: 'm1', projectId: 'p1', stage: 'EXECUTION', updatedAt: new Date(),
    mobilizationDate: '2026-08-01', executionStartDate: '2026-08-02', executionEndDate: '2026-08-10', returnDate: '2026-08-11', allocations: []
  };
  const result = buildMissionExecutionComparison(mission, [{ reportDate: '2026-08-10', collaborators: [] }], { progressPct: 100 });
  assert.equal(result.suggestion.stage, 'FINISHED');
  assert.equal(mission.stage, 'EXECUTION');
});
