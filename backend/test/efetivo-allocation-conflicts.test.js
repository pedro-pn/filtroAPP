import assert from 'node:assert/strict';
import test from 'node:test';

import { collectAllocationConflicts, ensureNoPlanningConflicts } from '../src/lib/efetivo/planning/conflicts.js';

test('elegibilidade identifica função, vínculo, ausência e missão com IDs navegáveis', () => {
  const collaborator = { id: 'c1', name: 'Ana', jobRoleId: 'r2', admissionDate: '2026-02-01', terminationDate: null };
  const conflicts = collectAllocationConflicts({ collaborator, jobRoleId: 'r1', period: { startDate: '2026-01-15', endDate: '2026-02-10' }, absences: [{ id: 'a1', type: 'FERIAS', startDate: '2026-02-03', endDate: '2026-02-04' }], allocations: [{ id: 'al1', mission: { id: 'm1', scheduleStatus: 'CONFIRMED', mobilizationDate: '2026-02-05', returnDate: '2026-02-07' } }] });
  assert.deepEqual(new Set(conflicts.map(item => item.code)), new Set(['OUTSIDE_EMPLOYMENT', 'WRONG_JOB_ROLE', 'ABSENCE_FERIAS', 'MISSION_OVERLAP']));
  assert.ok(conflicts.every(item => item.sourceId && item.entityPath));
  assert.throws(() => ensureNoPlanningConflicts(conflicts), /conflito/i);
});

test('colaborador sem função canônica não é elegível por compatibilidade textual', () => {
  const conflicts = collectAllocationConflicts({
    collaborator: { id: 'c2', name: 'Bia', role: 'Operador', jobRoleId: null, admissionDate: '2025-01-01' },
    jobRoleId: 'r1',
    period: { startDate: '2026-01-15', endDate: '2026-02-10' }
  });
  assert.equal(conflicts.some(item => item.code === 'WRONG_JOB_ROLE'), true);
});

test('datas individuais encerradas antes do novo período não geram conflito entre missões', () => {
  const conflicts = collectAllocationConflicts({
    collaborator: { id: 'c3', name: 'Caio', jobRoleId: 'r1', admissionDate: '2025-01-01' },
    jobRoleId: 'r1',
    period: { startDate: '2026-09-11', endDate: '2026-09-30' },
    allocations: [{
      id: 'al2',
      mobilizationDate: '2026-09-01',
      demobilizationDate: '2026-09-10',
      mission: { id: 'm2', scheduleStatus: 'CONFIRMED', mobilizationDate: '2026-09-01', returnDate: '2026-09-30' }
    }]
  });
  assert.equal(conflicts.some(item => item.code === 'MISSION_OVERLAP'), false);
});

test('sobreposição entre missões exige confirmação explícita e pode ser aceita', () => {
  const input = {
    collaborator: { id: 'c4', name: 'Dora', jobRoleId: 'r1', admissionDate: '2025-01-01' },
    jobRoleId: 'r1',
    period: { startDate: '2026-09-10', endDate: '2026-09-20' },
    allocations: [{
      id: 'al3',
      mission: { id: 'm3', scheduleStatus: 'CONFIRMED', mobilizationDate: '2026-09-01', returnDate: '2026-09-15' }
    }],
    requireCandidateMissionOverlapConfirmation: true
  };
  assert.equal(collectAllocationConflicts(input).some(item => item.code === 'MISSION_OVERLAP'), true);
  assert.equal(collectAllocationConflicts({ ...input, allowMissionOverlap: true }).some(item => item.code === 'MISSION_OVERLAP'), false);
});
