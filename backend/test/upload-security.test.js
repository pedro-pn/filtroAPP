import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { trustedClientAccessScopeForUser } from '../src/lib/client-project-access.js';
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

test('stored upload access rejects client reports under soft-deleted linked projects', () => {
  assert.equal(
    canAccessReport({
      user: {
        id: 'client-1',
        username: 'client@example.com',
        role: 'CLIENT',
        accountType: 'CLIENT',
        moduleRoles: ['rdo:client']
      },
      rawUser: {}
    }, {
      id: 'report-1',
      deletedAt: null,
      project: {
        deletedAt: new Date(),
        managerOnly: false,
        clientCnpj: '11222333000144',
        clientEmailPrimary: 'client@example.com',
        clientEmailCc: []
      }
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

test('protected upload route uses shared auth middleware', () => {
  const source = fs.readFileSync(new URL('../src/routes/resources/uploads.js', import.meta.url), 'utf8');

  assert.match(source, /router\.get\('\/file\/\*', requireAuth,/);
  assert.doesNotMatch(source, /function authenticateFileRequest/);
});

test('stored upload access allows trusted legacy client email scope', async t => {
  const originals = {
    projectFindMany: prisma.project.findMany,
    userFindMany: prisma.user.findMany,
    queryRaw: prisma.$queryRaw,
    reportFindMany: prisma.report.findMany
  };
  const rawUser = {
    id: 'client-1',
    username: '11222333000144',
    name: 'Cliente',
    email: 'cliente@example.com',
    role: 'CLIENT',
    accountType: 'CLIENT',
    isActive: true,
    moduleRoles: [{ role: 'RDO_CLIENT' }]
  };
  prisma.project.findMany = async args => {
    if (args?.select?.clientEmailPrimary) {
      return [{
        clientEmailPrimary: 'cliente@example.com',
        clientEmailCc: [],
        clientSigners: []
      }];
    }
    return [];
  };
  prisma.user.findMany = async () => [];
  prisma.$queryRaw = async () => [{ id: 'report-1' }];
  prisma.report.findMany = async () => [{
    id: 'report-1',
    deletedAt: null,
    createdByUserId: 'other-user',
    specialConditions: {
      photo: '/api/rdo/uploads/file/protected/photo.jpg'
    },
    project: {
      deletedAt: null,
      managerOnly: false,
      clientCnpj: '00999000199',
      clientEmailPrimary: 'cliente@example.com',
      clientEmailCc: [],
      clientSigners: [],
      authorizedUsers: []
    },
    collaborators: [],
    attachments: [],
    services: []
  }];
  t.after(() => {
    prisma.project.findMany = originals.projectFindMany;
    prisma.user.findMany = originals.userFindMany;
    prisma.$queryRaw = originals.queryRaw;
    prisma.report.findMany = originals.reportFindMany;
  });

  const trustedScope = await trustedClientAccessScopeForUser(prisma, rawUser);
  const allowedWithoutTrustedScope = await authorizeStoredFile({
    auth: {
      user: {
        id: rawUser.id,
        username: rawUser.username,
        email: rawUser.email,
        role: rawUser.role,
        accountType: rawUser.accountType,
        moduleRoles: ['rdo:client']
      },
      rawUser
    }
  }, 'protected/photo.jpg');
  const allowedWithTrustedScope = await authorizeStoredFile({
    auth: {
      user: {
        id: rawUser.id,
        username: rawUser.username,
        email: rawUser.email,
        role: rawUser.role,
        accountType: rawUser.accountType,
        moduleRoles: ['rdo:client'],
        trustedClientEmails: trustedScope.emails,
        trustedClientCnpjs: trustedScope.cnpjs
      },
      rawUser
    }
  }, 'protected/photo.jpg');

  assert.deepEqual(trustedScope.emails, ['cliente@example.com']);
  assert.equal(allowedWithoutTrustedScope, false);
  assert.equal(allowedWithTrustedScope, true);
});
