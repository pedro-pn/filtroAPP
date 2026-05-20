import assert from 'node:assert/strict';
import test from 'node:test';

import { canAccessReport } from '../src/routes/resources/uploads.js';

const managerAuth = {
  user: {
    id: 'manager-1',
    role: 'MANAGER',
    moduleRoles: ['rdo:manager']
  },
  rawUser: {}
};

test('stored upload access rejects soft-deleted reports and projects', () => {
  assert.equal(
    canAccessReport(managerAuth, {
      id: 'report-1',
      deletedAt: new Date(),
      project: { deletedAt: null }
    }),
    false
  );
  assert.equal(
    canAccessReport(managerAuth, {
      id: 'report-1',
      deletedAt: null,
      project: { deletedAt: new Date() }
    }),
    false
  );
});
