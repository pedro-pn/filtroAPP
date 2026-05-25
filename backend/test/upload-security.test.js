import assert from 'node:assert/strict';
import test from 'node:test';

import prisma from '../src/lib/prisma.js';
import { authorizeStoredFile, canAccessReport } from '../src/routes/resources/uploads.js';

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

test('stored upload access ignores arbitrary self-owned draft payload references', async t => {
  const originalDraftFindMany = prisma.reportDraft.findMany;
  const originalQueryRaw = prisma.$queryRaw;
  prisma.reportDraft.findMany = async () => {
    throw new Error('draft payloads must not authorize stored-file access');
  };
  prisma.$queryRaw = async () => [];
  t.after(() => {
    prisma.reportDraft.findMany = originalDraftFindMany;
    prisma.$queryRaw = originalQueryRaw;
  });

  const allowed = await authorizeStoredFile({
    auth: {
      user: {
        id: 'collaborator-1',
        role: 'COLLABORATOR',
        moduleRoles: ['rdo:collaborator']
      },
      rawUser: { collaboratorId: 'collab-1' }
    }
  }, 'private/report.pdf');

  assert.equal(allowed, false);
});
