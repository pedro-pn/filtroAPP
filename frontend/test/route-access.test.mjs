import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadRouteAccess() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/auth/routeAccess.ts');
  } finally {
    await server.close();
  }
}

async function loadAccountRoleRules() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/pages/admin/accountRoleRules.ts');
  } finally {
    await server.close();
  }
}

async function loadHubModules() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/pages/hubModules.ts');
  } finally {
    await server.close();
  }
}

const adminWithEpiOnly = {
  id: 'admin-epi',
  username: 'admin-epi',
  name: 'Admin EPI',
  email: null,
  role: 'MANAGER',
  accountType: 'ADMIN',
  moduleRoles: ['epi:technician'],
  isActive: true
};

test('admin accounts route accepts ADMIN accounts without rdo:manager', async () => {
  const { isRouteAllowed } = await loadRouteAccess();

  assert.equal(isRouteAllowed(adminWithEpiOnly, { allowedAccountTypes: ['ADMIN'] }), true);
});

test('RDO manager route still rejects ADMIN accounts without rdo:manager', async () => {
  const { isRouteAllowed } = await loadRouteAccess();

  assert.equal(
    isRouteAllowed(adminWithEpiOnly, {
      allowedRoles: ['MANAGER'],
      allowedModuleRoles: ['rdo:manager']
    }),
    false
  );
});

test('ADMIN role normalization does not add rdo:manager to EPI-only admins', async () => {
  const { rolesForAccountType } = await loadAccountRoleRules();

  assert.deepEqual(rolesForAccountType('ADMIN', ['epi:technician']), ['epi:technician']);
});

test('EPI-only internal accounts get a visible pending hub module', async () => {
  const { hubModulesForUser } = await loadHubModules();
  const modules = hubModulesForUser({
    role: 'COLLABORATOR',
    accountType: 'INTERNAL',
    moduleRoles: ['epi:technician']
  });

  assert.deepEqual(
    modules.map(module => module.id),
    ['epi']
  );
});

test('Romaneio-only internal accounts get a visible pending hub module', async () => {
  const { hubModulesForUser } = await loadHubModules();
  const modules = hubModulesForUser({
    role: 'COLLABORATOR',
    accountType: 'INTERNAL',
    moduleRoles: ['romaneio:operator']
  });

  assert.deepEqual(
    modules.map(module => module.id),
    ['romaneio']
  );
});

test('Romaneio route rejects internal accounts without romaneio module roles', async () => {
  const { isRouteAllowed } = await loadRouteAccess();

  assert.equal(
    isRouteAllowed({
      id: 'rdo-only',
      username: 'rdo-only',
      name: 'RDO Only',
      email: null,
      role: 'COLLABORATOR',
      accountType: 'INTERNAL',
      moduleRoles: ['rdo:collaborator'],
      isActive: true
    }, {
      allowedAccountTypes: ['ADMIN', 'INTERNAL'],
      allowedModuleRoles: ['romaneio:manager', 'romaneio:operator']
    }),
    false
  );
});

test('RDO-only internal accounts do not get the Romaneio hub module', async () => {
  const { hubModulesForUser } = await loadHubModules();
  const modules = hubModulesForUser({
    role: 'COLLABORATOR',
    accountType: 'INTERNAL',
    moduleRoles: ['rdo:collaborator']
  });

  assert.equal(modules.some(module => module.id === 'romaneio'), false);
});
