import assert from 'node:assert/strict';
import test from 'node:test';

import { publicUser } from '../src/lib/auth.js';
import {
  hasModuleRole,
  moduleRoleRows,
  serializeModuleRoles
} from '../src/lib/module-roles.js';
import {
  requireInternalUser,
  requireHubAdmin,
  requireManager,
  requireModuleRole
} from '../src/middleware/auth.js';
import { resolveAccountPayload } from '../src/routes/resources/users.js';

test('publicUser exposes hub account fields with legacy fallback', () => {
  assert.deepEqual(
    publicUser({
      id: 'user-1',
      username: 'gestor',
      name: 'Gestor',
      email: null,
      emailVerifiedAt: null,
      role: 'MANAGER',
      isActive: true,
      collaboratorId: null,
      collaborator: null
    }),
    {
      id: 'user-1',
      username: 'gestor',
      name: 'Gestor',
      email: null,
      emailVerifiedAt: null,
      role: 'MANAGER',
      accountType: 'ADMIN',
      moduleRoles: ['rdo:manager'],
      isActive: true,
      clientCnpj: null,
      privacyPolicyAcceptedAt: null,
      privacyPolicyVersion: null,
      notificationPreferences: {
        reports: true,
        signatures: true,
        signatureReminders: true,
        surveyReminders: true
      },
      privacyPolicyRequired: false,
      requiredPrivacyPolicyVersion: 'client_account_privacy_v1',
      collaboratorId: null,
      collaborator: null
    }
  );
});

test('publicUser flags client accounts missing current privacy acceptance', () => {
  const user = publicUser({
    id: 'client-1',
    username: 'cliente@example.com',
    name: 'Cliente',
    email: 'cliente@example.com',
    role: 'CLIENT',
    accountType: 'CLIENT',
    isActive: true,
    clientCnpj: '11222333000144',
    privacyPolicyAcceptedAt: null,
    privacyPolicyVersion: null,
    collaboratorId: null,
    collaborator: null,
    moduleRoles: []
  });

  assert.equal(user.privacyPolicyRequired, true);
  assert.equal(user.requiredPrivacyPolicyVersion, 'client_account_privacy_v1');
});

test('serializeModuleRoles prefers persisted module roles', () => {
  assert.deepEqual(
    serializeModuleRoles({
      role: 'COLLABORATOR',
      moduleRoles: [
        { role: 'RDO_COORDINATOR' },
        { role: 'ROMANEIO_OPERATOR' }
      ]
    }),
    ['rdo:coordinator', 'romaneio:operator']
  );
});

test('serializeModuleRoles preserves an explicitly loaded empty role set', () => {
  assert.deepEqual(
    serializeModuleRoles({
      role: 'MANAGER',
      moduleRoles: []
    }),
    []
  );
});

test('moduleRoleRows converts public role codes for Prisma writes', () => {
  assert.deepEqual(
    moduleRoleRows('user-1', ['rdo:client', 'epi:technician', 'privacy:admin']),
    [
      { userId: 'user-1', module: 'RDO', role: 'RDO_CLIENT' },
      { userId: 'user-1', module: 'EPI', role: 'EPI_TECHNICIAN' },
      { userId: 'user-1', module: 'PRIVACY', role: 'PRIVACY_ADMIN' }
    ]
  );
});

test('hasModuleRole checks persisted module roles for hub admins and regular accounts', () => {
  assert.equal(hasModuleRole({ role: 'MANAGER', accountType: 'ADMIN', moduleRoles: ['epi:technician'] }, 'epi:technician'), true);
  assert.equal(hasModuleRole({ role: 'MANAGER', accountType: 'ADMIN', moduleRoles: ['privacy:admin'] }, 'privacy:admin'), true);
  assert.equal(hasModuleRole({ role: 'MANAGER', accountType: 'ADMIN', moduleRoles: ['epi:technician'] }, 'rdo:manager'), false);
  assert.equal(hasModuleRole({ role: 'MANAGER', accountType: 'ADMIN', moduleRoles: ['rdo:manager'] }, 'privacy:admin'), false);
  assert.equal(hasModuleRole({ role: 'MANAGER', accountType: 'ADMIN', moduleRoles: [] }, 'rdo:manager'), false);
  assert.equal(hasModuleRole({ role: 'COLLABORATOR', accountType: 'INTERNAL', moduleRoles: ['rdo:collaborator'] }, 'rdo:collaborator'), true);
  assert.equal(hasModuleRole({ role: 'COLLABORATOR', accountType: 'INTERNAL', moduleRoles: ['rdo:collaborator'] }, 'rdo:manager'), false);
});

test('module role checks do not fall back to legacy RDO role when explicit non-RDO roles exist', () => {
  const user = { role: 'COLLABORATOR', accountType: 'INTERNAL', moduleRoles: ['epi:technician'] };

  assert.equal(hasModuleRole(user, 'epi:technician'), true);
  assert.equal(hasModuleRole(user, 'rdo:collaborator'), false);
});

test('requireInternalUser rejects internal hub accounts without RDO roles', () => {
  const middleware = requireInternalUser;
  let statusCode = null;
  let body = null;
  const req = {
    auth: {
      user: { role: 'COLLABORATOR', accountType: 'INTERNAL', moduleRoles: ['romaneio:operator'] }
    }
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    }
  };
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
  assert.deepEqual(body, { error: 'Acesso restrito a usuários internos.' });
});

test('requireModuleRole rejects RDO access for EPI-only internal accounts', () => {
  const middleware = requireModuleRole('rdo:manager', 'rdo:coordinator', 'rdo:collaborator');
  let statusCode = null;
  const req = {
    auth: {
      user: { role: 'COLLABORATOR', accountType: 'INTERNAL', moduleRoles: ['epi:technician'] }
    }
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    }
  };
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
});

test('requireModuleRole rejects RDO access when persisted module roles are empty', () => {
  const middleware = requireModuleRole('rdo:manager', 'rdo:coordinator', 'rdo:collaborator');
  let statusCode = null;
  const req = {
    auth: {
      user: { role: 'MANAGER', accountType: 'ADMIN', moduleRoles: [] }
    }
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    }
  };
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
});

test('requireModuleRole rejects RDO access for EPI-only hub admins', () => {
  const middleware = requireModuleRole('rdo:manager', 'rdo:coordinator', 'rdo:collaborator');
  let statusCode = null;
  let body = null;
  const req = {
    auth: {
      user: { role: 'MANAGER', accountType: 'ADMIN', moduleRoles: ['epi:technician'] }
    }
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    }
  };
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
  assert.deepEqual(body, { error: 'Acesso restrito ao módulo.' });
});

test('report audit manager guard rejects admins without rdo manager role', () => {
  const middleware = requireModuleRole('rdo:manager');
  let statusCode = null;
  const req = {
    auth: {
      user: { role: 'MANAGER', accountType: 'ADMIN', moduleRoles: ['epi:technician'] }
    }
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    }
  };
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);

  req.auth.user.moduleRoles = ['rdo:manager'];
  middleware(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('requireManager rejects RDO manager mutations for EPI-only hub admins', () => {
  let statusCode = null;
  let body = null;
  const req = {
    auth: {
      user: { role: 'MANAGER', accountType: 'ADMIN', moduleRoles: ['epi:technician'] }
    }
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    }
  };
  let nextCalled = false;

  requireManager(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
  assert.deepEqual(body, { error: 'Acesso restrito ao gestor.' });
});

test('resolveAccountPayload rejects rdo:manager on INTERNAL accounts', () => {
  assert.throws(
    () => resolveAccountPayload({
      role: 'COLLABORATOR',
      accountType: 'INTERNAL',
      moduleRoles: ['rdo:manager']
    }),
    /Role de módulo rdo:manager incompatível com conta INTERNAL/
  );
});

test('resolveAccountPayload rejects COORDINATOR accounts with collaborator RDO role', () => {
  assert.throws(
    () => resolveAccountPayload({
      role: 'COORDINATOR',
      accountType: 'INTERNAL',
      moduleRoles: ['rdo:collaborator']
    }),
    /rdo:collaborator exige role legado COLLABORATOR/
  );
});

test('resolveAccountPayload rejects COLLABORATOR accounts with coordinator RDO role', () => {
  assert.throws(
    () => resolveAccountPayload({
      role: 'COLLABORATOR',
      accountType: 'INTERNAL',
      moduleRoles: ['rdo:coordinator']
    }),
    /rdo:coordinator exige role legado COORDINATOR/
  );
});

test('resolveAccountPayload preserves ADMIN module roles when update omits moduleRoles', () => {
  assert.deepEqual(
    resolveAccountPayload(
      {
        role: 'MANAGER',
        accountType: 'ADMIN'
      },
      {
        role: 'MANAGER',
        accountType: 'ADMIN',
        moduleRoles: [{ role: 'EPI_TECHNICIAN' }]
      }
    ).moduleRoles,
    ['epi:technician']
  );
});

test('resolveAccountPayload preserves INTERNAL module roles when update omits moduleRoles', () => {
  assert.deepEqual(
    resolveAccountPayload(
      {
        role: 'COLLABORATOR',
        accountType: 'INTERNAL'
      },
      {
        role: 'COLLABORATOR',
        accountType: 'INTERNAL',
        moduleRoles: [{ role: 'ROMANEIO_OPERATOR' }]
      }
    ).moduleRoles,
    ['romaneio:operator']
  );
});

test('resolveAccountPayload recomputes module roles when legacy role changes without moduleRoles', () => {
  assert.deepEqual(
    resolveAccountPayload(
      {
        role: 'COORDINATOR'
      },
      {
        role: 'COLLABORATOR',
        accountType: 'INTERNAL',
        moduleRoles: [{ role: 'RDO_COLLABORATOR' }]
      }
    ).moduleRoles,
    ['rdo:coordinator']
  );
});

test('resolveAccountPayload recomputes module roles when MANAGER changes to COORDINATOR without moduleRoles', () => {
  const payload = resolveAccountPayload(
    {
      role: 'COORDINATOR'
    },
    {
      role: 'MANAGER',
      accountType: 'ADMIN',
      moduleRoles: [{ role: 'RDO_MANAGER' }]
    }
  );

  assert.equal(payload.accountType, 'INTERNAL');
  assert.equal(payload.role, 'COORDINATOR');
  assert.deepEqual(payload.moduleRoles, ['rdo:coordinator']);
});

test('resolveAccountPayload allows explicit empty module role sets for INTERNAL accounts', () => {
  const payload = resolveAccountPayload({
    role: 'COLLABORATOR',
    accountType: 'INTERNAL',
    moduleRoles: []
  });

  assert.equal(payload.accountType, 'INTERNAL');
  assert.equal(payload.role, 'COLLABORATOR');
  assert.deepEqual(payload.moduleRoles, []);
});

test('resolveAccountPayload rejects explicit empty module role sets for ADMIN accounts', () => {
  assert.throws(
    () => resolveAccountPayload({
      role: 'MANAGER',
      accountType: 'ADMIN',
      moduleRoles: []
    }),
    /ao menos uma role de módulo/
  );
});

test('resolveAccountPayload does not grant privacy admin to new ADMIN accounts by default', () => {
  assert.deepEqual(
    resolveAccountPayload({
      role: 'MANAGER',
      accountType: 'ADMIN'
    }).moduleRoles,
    ['rdo:manager']
  );
});

test('resolveAccountPayload allows explicit privacy admin role for ADMIN accounts', () => {
  assert.deepEqual(
    resolveAccountPayload({
      role: 'MANAGER',
      accountType: 'ADMIN',
      moduleRoles: ['privacy:admin']
    }).moduleRoles,
    ['privacy:admin']
  );
});

test('resolveAccountPayload rejects ADMIN legacy role mismatch', () => {
  assert.throws(
    () => resolveAccountPayload({
      role: 'COLLABORATOR',
      accountType: 'ADMIN',
      moduleRoles: ['rdo:manager']
    }),
    /Contas ADMIN devem usar role legado MANAGER/
  );
});

test('resolveAccountPayload rejects INTERNAL legacy manager mismatch', () => {
  assert.throws(
    () => resolveAccountPayload({
      role: 'MANAGER',
      accountType: 'INTERNAL',
      moduleRoles: ['rdo:coordinator']
    }),
    /Contas INTERNAL não podem usar role legado MANAGER ou CLIENT/
  );
});

test('manager and hub-admin middleware reject inconsistent internal rdo:manager accounts', () => {
  const rdoManagerInternal = {
    auth: {
      user: {
        role: 'COLLABORATOR',
        accountType: 'INTERNAL',
        moduleRoles: ['rdo:manager']
      }
    }
  };
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  let managerNext = false;
  let hubNext = false;

  requireManager(rdoManagerInternal, res, () => {
    managerNext = true;
  });
  requireHubAdmin(rdoManagerInternal, res, () => {
    hubNext = true;
  });

  assert.equal(managerNext, false);
  assert.equal(hubNext, false);
  assert.equal(res.statusCode, 403);
});
