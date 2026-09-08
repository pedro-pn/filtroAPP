import assert from 'node:assert/strict';
import test from 'node:test';

import { planJobRoleBackfill } from '../scripts/backfill-efetivo-job-roles.js';
import { collectCollaboratorUpdateConflicts } from '../src/lib/efetivo/planning/collaborators.js';
import { listPlanningCollaborators, listPlanningCoordinators } from '../src/lib/efetivo/planning/read-model.js';

test('backfill vincula somente nome de função inequívoco e preserva pendências', () => {
  const result = planJobRoleBackfill([{ id: 'c1', role: 'Operador', jobRoleId: null }, { id: 'c2', role: 'Ambíguo', jobRoleId: null }], [{ id: 'r1', name: 'operador' }, { id: 'r2', name: 'Ambíguo' }, { id: 'r3', name: 'ambíguo' }]);
  assert.deepEqual(result.matches, [{ collaboratorId: 'c1', jobRoleId: 'r1', jobRoleName: 'operador' }]);
  assert.deepEqual(result.unresolved, [{
    collaboratorId: 'c2',
    collaboratorName: null,
    legacyRole: 'Ambíguo',
    reason: 'AMBIGUOUS',
    candidateIds: ['r2', 'r3']
  }]);
});

test('edição cadastral não pode invalidar função ou vínculo de alocação confirmada', () => {
  const allocation = { jobRoleId: 'r1', mission: { id: 'm1', mobilizationDate: '2026-09-01', returnDate: '2026-09-10' } };
  const roleConflicts = collectCollaboratorUpdateConflicts({ id: 'c1', name: 'Ana', jobRoleId: 'r2', admissionDate: '2025-01-01' }, [allocation]);
  const employmentConflicts = collectCollaboratorUpdateConflicts({ id: 'c1', name: 'Ana', jobRoleId: 'r1', admissionDate: '2025-01-01', terminationDate: '2026-09-05' }, [allocation]);
  assert.equal(roleConflicts.some(item => item.code === 'WRONG_JOB_ROLE'), true);
  assert.equal(employmentConflicts.some(item => item.code === 'OUTSIDE_EMPLOYMENT'), true);
});

test('lista de colaboradores serializa datas Prisma como data civil para o navegador', async () => {
  const database = {
    efetivoPlan: { findFirst: async () => ({ id: 'p1' }) },
    collaborator: { findMany: async () => [{ id: 'c1', name: 'Ana', jobRoleId: 'r1', jobRole: { id: 'r1', name: 'Operadora' }, admissionDate: new Date('2025-07-04T15:00:00.000Z'), terminationDate: null, isActive: true }] },
    jobRole: { findMany: async () => [{ id: 'r1', name: 'Operadora', isActive: true, isOperational: true }] },
    efetivoMissionPlan: { findMany: async () => [] },
    collaboratorAbsence: { findMany: async () => [] },
    workforceHoliday: { findMany: async () => [] },
    workforceCalendarState: { findUnique: async () => ({ id: 'global', revision: 1 }) },
    efetivoSetting: { findUnique: async () => null },
    efetivoPlannedHire: { findMany: async () => [] }
  };
  const rows = await listPlanningCollaborators({ date: '2026-08-21' }, { database });
  assert.equal(rows[0].admissionDate, '2025-07-04');
});

test('lista de responsáveis aceita contas coordenadoras legadas e modulares', async () => {
  let query;
  const expected = [{ id: 'u1', name: 'Coordenação', collaborator: null }];
  const database = { user: { findMany: async value => { query = value; return expected; } } };
  assert.deepEqual(await listPlanningCoordinators({ database }), expected);
  assert.deepEqual(query.where.OR, [
    { role: 'COORDINATOR' },
    { moduleRoles: { some: { role: 'RDO_COORDINATOR' } } }
  ]);
});
