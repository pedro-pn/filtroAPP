import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReportCollaboratorRows, reportCollaboratorCreateData } from '../src/lib/report-collaborators.js';

test('novo vínculo do RDO captura cargo canônico como snapshot', () => {
  assert.deepEqual(reportCollaboratorCreateData({
    id: 'c1',
    jobRoleId: 'r1',
    jobRole: { id: 'r1', name: 'Operador' }
  }), {
    collaboratorId: 'c1',
    jobRoleIdSnapshot: 'r1',
    roleNameSnapshot: 'Operador'
  });
});

test('reprodução histórica usa snapshot mesmo após cargo canônico mudar', () => {
  const rows = buildReportCollaboratorRows({
    collaborators: [{
      collaboratorId: 'c1',
      roleNameSnapshot: 'Operador',
      collaborator: { name: 'Ana', jobRole: { name: 'Supervisora' } }
    }]
  });
  assert.equal(rows[0].collaboratorposition, 'Operador');
});
