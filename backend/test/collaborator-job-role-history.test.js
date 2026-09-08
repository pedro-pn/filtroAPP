import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collaboratorRoleAtDate,
  collaboratorRoleSegments,
  synchronizeCurrentCollaboratorJobRole,
  validateCollaboratorRoleEffectiveDate
} from '../src/lib/collaborators/job-role-history.js';

const collaborator = {
  id: 'collaborator-1',
  jobRoleId: 'role-2',
  jobRole: { id: 'role-2', name: 'Supervisor' },
  admissionDate: new Date('2026-01-01T00:00:00.000Z'),
  jobRoleHistory: [
    { jobRoleId: 'role-1', effectiveDate: new Date('2026-01-01T00:00:00.000Z'), jobRole: { id: 'role-1', name: 'Operador' } },
    { jobRoleId: 'role-2', effectiveDate: new Date('2026-01-15T00:00:00.000Z'), jobRole: { id: 'role-2', name: 'Supervisor' } }
  ]
};

test('cargo vigente é resolvido pela data da mudança', () => {
  assert.deepEqual(collaboratorRoleAtDate(collaborator, '2026-01-14'), {
    jobRoleId: 'role-1', roleName: 'Operador', effectiveDate: '2026-01-01'
  });
  assert.deepEqual(collaboratorRoleAtDate(collaborator, '2026-01-15'), {
    jobRoleId: 'role-2', roleName: 'Supervisor', effectiveDate: '2026-01-15'
  });
});

test('mudança de cargo divide o período sem sobreposição', () => {
  assert.deepEqual(collaboratorRoleSegments(collaborator, '2026-01-01', '2026-01-31'), [
    { jobRoleId: 'role-1', roleName: 'Operador', effectiveDate: '2026-01-01', startKey: '2026-01-01', endKey: '2026-01-14' },
    { jobRoleId: 'role-2', roleName: 'Supervisor', effectiveDate: '2026-01-15', startKey: '2026-01-15', endKey: '2026-01-31' }
  ]);
});

test('vigência rejeita data futura e data anterior à admissão', () => {
  const now = new Date('2026-09-01T12:00:00.000Z');
  assert.throws(() => validateCollaboratorRoleEffectiveDate(collaborator, '2026-09-02', now), /futuro/);
  assert.throws(() => validateCollaboratorRoleEffectiveDate(collaborator, '2025-12-31', now), /admissão/);
  assert.equal(
    validateCollaboratorRoleEffectiveDate(collaborator, '2026-08-31', now).toISOString(),
    '2026-08-31T00:00:00.000Z'
  );
});

test('sincronização mantém no cadastro o último cargo já vigente', async () => {
  let updatedData = null;
  const database = {
    collaboratorJobRoleHistory: {
      findFirst: async () => ({ jobRoleId: 'role-2' })
    },
    collaborator: {
      findUniqueOrThrow: async () => ({ id: 'collaborator-1', jobRoleId: 'role-1' }),
      update: async ({ data }) => {
        updatedData = data;
        return { id: 'collaborator-1', ...data };
      }
    }
  };

  const result = await synchronizeCurrentCollaboratorJobRole(database, 'collaborator-1', new Date('2026-09-01T12:00:00.000Z'));
  assert.equal(result.changed, true);
  assert.deepEqual(updatedData, { jobRoleId: 'role-2' });
});
