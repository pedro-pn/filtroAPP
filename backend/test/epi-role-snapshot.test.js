import assert from 'node:assert/strict';
import test from 'node:test';

import {
  effectiveEpiRoleData,
  epiRoleSnapshotData,
  roleNameForEpiRequest
} from '../src/lib/epi/collaborators.js';

const collaborator = {
  id: 'c1',
  jobRole: { id: 'r-current', name: 'Eletricista', isActive: true },
  epiProfile: {
    roleOverrideJobRole: { id: 'r-old', name: 'Auxiliar', isActive: false }
  }
};

test('override relacional do EPI não altera o cargo canônico', () => {
  const effective = effectiveEpiRoleData(collaborator);
  assert.deepEqual(effective, { jobRoleId: 'r-old', name: 'Auxiliar', source: 'EPI_OVERRIDE' });
  assert.equal(collaborator.jobRole.name, 'Eletricista');
});

test('snapshot EPI permanece após limpar o override ou trocar o cargo atual', () => {
  const snapshot = epiRoleSnapshotData(collaborator);
  const request = { ...snapshot, collaborator: { ...collaborator, epiProfile: null, jobRole: { id: 'r-next', name: 'Supervisor' } } };
  assert.equal(roleNameForEpiRequest(request), 'Auxiliar');
  assert.equal(request.roleSourceSnapshot, 'EPI_OVERRIDE');
});
