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

async function loadModuleNavigation() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/auth/moduleNavigation.ts');
  } finally {
    await server.close();
  }
}

async function loadModuleRegistry() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/modules/registry.ts');
  } finally {
    await server.close();
  }
}

async function loadRolePath() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });

  try {
    return await server.ssrLoadModule('/src/auth/rolePath.ts');
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

test('privacy requests route requires the dedicated privacy admin module role', async () => {
  const { isRouteAllowed } = await loadRouteAccess();
  const privacyRouteRule = {
    allowedModuleRoles: ['privacy:admin']
  };

  assert.equal(
    isRouteAllowed({
      id: 'privacy-admin',
      username: 'privacy-admin',
      name: 'Admin',
      email: null,
      role: 'MANAGER',
      accountType: 'ADMIN',
      moduleRoles: ['privacy:admin'],
      isActive: true
    }, privacyRouteRule),
    true
  );
  assert.equal(
    isRouteAllowed({
      id: 'internal-manager',
      username: 'internal-manager',
      name: 'Gestor',
      email: null,
      role: 'MANAGER',
      accountType: 'ADMIN',
      moduleRoles: ['rdo:manager'],
      isActive: true
    }, privacyRouteRule),
    false
  );
  assert.equal(
    isRouteAllowed({
      id: 'plain-admin',
      username: 'plain-admin',
      name: 'Admin sem LGPD',
      email: null,
      role: 'MANAGER',
      accountType: 'ADMIN',
      moduleRoles: [],
      isActive: true
    }, privacyRouteRule),
    false
  );
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

test('INTERNAL role normalization allows accounts without RDO roles', async () => {
  const { rolesForAccountType } = await loadAccountRoleRules();

  assert.deepEqual(rolesForAccountType('INTERNAL', []), []);
  assert.deepEqual(rolesForAccountType('INTERNAL', ['epi:technician']), ['epi:technician']);
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

test('module navigation maps legacy reports paths to the RDO module', async () => {
  const { moduleIdFromPath } = await loadModuleNavigation();

  assert.equal(moduleIdFromPath('/rdo/gestor'), 'rdo');
  assert.equal(moduleIdFromPath('/gestor'), 'rdo');
  assert.equal(moduleIdFromPath('/relatorios/report-1'), 'rdo');
  assert.equal(moduleIdFromPath('/romaneio'), 'romaneio');
  assert.equal(moduleIdFromPath('/epi'), 'epi');
  assert.equal(moduleIdFromPath('/equipamentos'), 'equipamentos');
  assert.equal(moduleIdFromPath('/privacidade/solicitacoes'), 'privacy');
  assert.equal(moduleIdFromPath('/privacidade/direitos'), null);
  assert.equal(moduleIdFromPath('/assinar/token'), null);
  assert.equal(moduleIdFromPath('/epi/assinar/token'), null);
});

test('module registry provides route paths and access groups', async () => {
  const { moduleRouteAccess, moduleRoutePath } = await loadModuleRegistry();

  assert.equal(moduleRoutePath('romaneio', 'new'), '/romaneio/novo');
  assert.deepEqual(moduleRouteAccess('romaneio'), {
    allowedAccountTypes: ['ADMIN', 'INTERNAL'],
    allowedModuleRoles: ['romaneio:manager', 'romaneio:operator']
  });
  assert.deepEqual(moduleRouteAccess('rdo', 'manager'), {
    allowedRoles: ['MANAGER'],
    allowedModuleRoles: ['rdo:manager']
  });
});

test('RDO role path helpers resolve paths from the registry', async () => {
  const { rdoReportDetailPath, roleHomePath } = await loadRolePath();

  assert.equal(roleHomePath('MANAGER'), '/rdo/gestor');
  assert.equal(roleHomePath('COORDINATOR'), '/rdo/coordenador');
  assert.equal(roleHomePath('CLIENT'), '/rdo/cliente');
  assert.equal(roleHomePath('COLLABORATOR'), '/rdo/home');
  assert.equal(rdoReportDetailPath({ role: 'MANAGER' }, 'report-1'), '/rdo/gestor/relatorio/report-1');
  assert.equal(rdoReportDetailPath({ role: 'CLIENT' }, 'report-1'), '/rdo/cliente/relatorio/report-1');
});

test('ADMIN accounts get the privacy hub module', async () => {
  const { hubModulesForUser } = await loadHubModules();
  const modules = hubModulesForUser({
    ...adminWithEpiOnly,
    moduleRoles: ['privacy:admin']
  });

  assert.equal(modules.some(module => module.id === 'privacy' && module.path === '/privacidade/solicitacoes'), true);
  assert.equal(hubModulesForUser(adminWithEpiOnly).some(module => module.id === 'privacy'), false);
});

test('preferred entry path uses the last accessible module for the signed-in account', async () => {
  const stored = new Map();
  globalThis.window = {
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value)
    }
  };

  try {
    const { markHubFirstLoginTutorialSeen, preferredEntryPath, rememberModuleAccess } = await loadModuleNavigation();
    const user = {
      id: 'admin-multi',
      username: 'admin-multi',
      name: 'Admin Multi',
      email: null,
      role: 'MANAGER',
      accountType: 'ADMIN',
      moduleRoles: ['rdo:manager', 'romaneio:manager', 'epi:technician'],
      isActive: true
    };

    rememberModuleAccess(user, '/romaneio');
    assert.equal(preferredEntryPath(user), '/modulos');
    markHubFirstLoginTutorialSeen(user);
    assert.equal(preferredEntryPath(user), '/romaneio');
    rememberModuleAccess(user, '/epi');
    assert.equal(preferredEntryPath(user), '/epi');
    rememberModuleAccess(user, '/conta');
    assert.equal(preferredEntryPath(user), '/epi');
  } finally {
    delete globalThis.window;
  }
});

test('multi-module internal accounts open the modules hub until the first-login tutorial is seen', async () => {
  const stored = new Map();
  globalThis.window = {
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value)
    }
  };

  try {
    const { markHubFirstLoginTutorialSeen, preferredEntryPath } = await loadModuleNavigation();
    const user = {
      id: 'internal-multi',
      username: 'internal-multi',
      name: 'Interno Multi',
      email: null,
      role: 'COLLABORATOR',
      accountType: 'INTERNAL',
      moduleRoles: ['rdo:collaborator', 'romaneio:operator', 'epi:technician'],
      isActive: true
    };

    assert.equal(preferredEntryPath(user), '/modulos');
    markHubFirstLoginTutorialSeen(user);
    assert.equal(preferredEntryPath(user), '/rdo/home');
  } finally {
    delete globalThis.window;
  }
});

test('acompanhamento grouping novelty is local once-per-user and expires globally', async () => {
  const stored = new Map();
  const originalNow = Date.now;
  globalThis.window = {
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value)
    }
  };

  try {
    Date.now = () => new Date('2026-07-16T12:00:00-03:00').getTime();
    const {
      markAcompanhamentoGroupingNoveltySeen,
      shouldShowAcompanhamentoGroupingNovelty
    } = await loadModuleNavigation();

    assert.equal(shouldShowAcompanhamentoGroupingNovelty({ id: 'manager-1' }), true);
    markAcompanhamentoGroupingNoveltySeen({ id: 'manager-1' });
    assert.equal(shouldShowAcompanhamentoGroupingNovelty({ id: 'manager-1' }), false);
    assert.equal(shouldShowAcompanhamentoGroupingNovelty({ id: 'manager-2' }), true);

    Date.now = () => new Date('2026-07-27T00:00:00-03:00').getTime();
    assert.equal(shouldShowAcompanhamentoGroupingNovelty({ id: 'manager-3' }), false);
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
  }
});

test('acompanhamento tracking campaigns last 10 days and finalized missions stay highlighted until seen', async () => {
  const stored = new Map();
  const originalNow = Date.now;
  globalThis.window = {
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value)
    }
  };

  try {
    Date.now = () => new Date('2026-08-06T12:00:00-03:00').getTime();
    const navigation = await loadModuleNavigation();
    const user = { id: 'manager-tracking' };
    assert.equal(navigation.shouldShowAcompanhamentoTrackingNovelty(user), true);
    assert.equal(navigation.shouldShowAcompanhamentoFinalizedNovelty(user), true);
    assert.equal(navigation.shouldShowAcompanhamentoReviewNovelty(user), true);

    navigation.markAcompanhamentoTrackingNoveltySeen(user);
    navigation.markAcompanhamentoFinalizedNoveltySeen(user);
    navigation.markAcompanhamentoReviewNoveltySeen(user);
    assert.equal(navigation.shouldShowAcompanhamentoTrackingNovelty(user), false);
    assert.equal(navigation.shouldShowAcompanhamentoFinalizedNovelty(user), false);
    assert.equal(navigation.shouldShowAcompanhamentoReviewNovelty(user), false);

    const archivedAt = '2026-08-06T14:00:00.000Z';
    assert.equal(navigation.hasSeenAcompanhamentoFinalizedMission(user, 'project-1', archivedAt), false);
    navigation.markAcompanhamentoFinalizedMissionSeen(user, 'project-1', archivedAt);
    assert.equal(navigation.hasSeenAcompanhamentoFinalizedMission(user, 'project-1', archivedAt), true);
    assert.equal(navigation.hasSeenAcompanhamentoFinalizedMission(user, 'project-1', '2026-08-07T14:00:00.000Z'), false);

    Date.now = () => new Date('2026-08-17T00:00:00-03:00').getTime();
    assert.equal(navigation.shouldShowAcompanhamentoTrackingNovelty({ id: 'manager-new' }), false);
    assert.equal(navigation.shouldShowAcompanhamentoFinalizedNovelty({ id: 'manager-new' }), false);
    assert.equal(navigation.shouldShowAcompanhamentoReviewNovelty({ id: 'manager-new' }), false);
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
  }
});

test('acompanhamento standby history novelty is local once-per-user and expires globally', async () => {
  const stored = new Map();
  const originalNow = Date.now;
  globalThis.window = {
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value)
    }
  };

  try {
    Date.now = () => new Date('2026-08-25T12:00:00-03:00').getTime();
    const {
      markAcompanhamentoStandbyHistoryNoveltySeen,
      shouldShowAcompanhamentoStandbyHistoryNovelty
    } = await loadModuleNavigation();

    assert.equal(shouldShowAcompanhamentoStandbyHistoryNovelty({ id: 'viewer-1' }), true);
    markAcompanhamentoStandbyHistoryNoveltySeen({ id: 'viewer-1' });
    assert.equal(shouldShowAcompanhamentoStandbyHistoryNovelty({ id: 'viewer-1' }), false);
    assert.equal(shouldShowAcompanhamentoStandbyHistoryNovelty({ id: 'viewer-2' }), true);

    Date.now = () => new Date('2026-09-05T00:00:00-03:00').getTime();
    assert.equal(shouldShowAcompanhamentoStandbyHistoryNovelty({ id: 'viewer-3' }), false);
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
  }
});

test('acompanhamento progress history novelty is local once-per-user and expires globally', async () => {
  const stored = new Map();
  const originalNow = Date.now;
  globalThis.window = {
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value)
    }
  };

  try {
    Date.now = () => new Date('2026-07-21T12:00:00-03:00').getTime();
    const {
      markAcompanhamentoProgressHistoryNoveltySeen,
      shouldShowAcompanhamentoProgressHistoryNovelty
    } = await loadModuleNavigation();

    assert.equal(shouldShowAcompanhamentoProgressHistoryNovelty({ id: 'viewer-1' }), true);
    markAcompanhamentoProgressHistoryNoveltySeen({ id: 'viewer-1' });
    assert.equal(shouldShowAcompanhamentoProgressHistoryNovelty({ id: 'viewer-1' }), false);
    assert.equal(shouldShowAcompanhamentoProgressHistoryNovelty({ id: 'viewer-2' }), true);

    Date.now = () => new Date('2026-08-01T00:00:00-03:00').getTime();
    assert.equal(shouldShowAcompanhamentoProgressHistoryNovelty({ id: 'viewer-3' }), false);
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
  }
});

test('acompanhamento manual cost novelty is local once-per-user and expires globally', async () => {
  const stored = new Map();
  const originalNow = Date.now;
  globalThis.window = {
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value)
    }
  };

  try {
    Date.now = () => new Date('2026-07-21T12:00:00-03:00').getTime();
    const {
      markAcompanhamentoManualCostNoveltySeen,
      shouldShowAcompanhamentoManualCostNovelty
    } = await loadModuleNavigation();

    assert.equal(shouldShowAcompanhamentoManualCostNovelty({ id: 'manager-1' }), true);
    markAcompanhamentoManualCostNoveltySeen({ id: 'manager-1' });
    assert.equal(shouldShowAcompanhamentoManualCostNovelty({ id: 'manager-1' }), false);
    assert.equal(shouldShowAcompanhamentoManualCostNovelty({ id: 'manager-2' }), true);

    Date.now = () => new Date('2026-08-01T00:00:00-03:00').getTime();
    assert.equal(shouldShowAcompanhamentoManualCostNovelty({ id: 'manager-3' }), false);
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
  }
});

test('single-module internal accounts keep entering their module directly', async () => {
  const { preferredEntryPath } = await loadModuleNavigation();

  assert.equal(preferredEntryPath({
    id: 'internal-epi',
    username: 'internal-epi',
    name: 'Interno EPI',
    email: null,
    role: 'COLLABORATOR',
    accountType: 'INTERNAL',
    moduleRoles: ['epi:technician'],
    isActive: true
  }), '/epi');
});

test('preferred entry path keeps client accounts inside the reports module', async () => {
  const { preferredEntryPath } = await loadModuleNavigation();

  assert.equal(preferredEntryPath({
    id: 'client-1',
    username: 'client',
    name: 'Client',
    email: 'client@example.com',
    role: 'CLIENT',
    accountType: 'CLIENT',
    moduleRoles: ['rdo:client'],
    isActive: true
  }), '/rdo/cliente');
});

test('account page back path prefers the route that opened account settings', async () => {
  const { accountBackPath, accountPageStateFromPath, backPathFromState, hasBackPathInState, navigationStateFromLocation, pathFromLocation } = await loadModuleNavigation();

  assert.deepEqual(accountPageStateFromPath('/admin/accounts'), { from: '/admin/accounts' });
  assert.equal(pathFromLocation({ pathname: '/rdo/gestor', search: '?tab=aprovados', hash: '#rdo-10' }), '/rdo/gestor?tab=aprovados#rdo-10');
  assert.deepEqual(
    navigationStateFromLocation({ pathname: '/rdo/gestor', search: '?tab=arquivados', hash: '' }),
    { from: '/rdo/gestor?tab=arquivados' }
  );
  assert.deepEqual(accountPageStateFromPath({ pathname: '/estoque', search: '?tab=itens', hash: '#filtro' }), { from: '/estoque?tab=itens#filtro' });
  assert.equal(accountBackPath(adminWithEpiOnly, { from: '/admin/accounts' }, '/rdo/gestor'), '/admin/accounts');
  assert.equal(backPathFromState({ from: { pathname: '/rdo/coordenador', search: '?tab=approved', hash: '#rel' } }, '/rdo/coordenador'), '/rdo/coordenador?tab=approved#rel');
  assert.equal(backPathFromState({ from: 'https://example.com' }, '/rdo/gestor'), '/rdo/gestor');
  assert.equal(backPathFromState({ from: '/conta?tab=perfil' }, '/rdo/gestor'), '/rdo/gestor');
  assert.equal(hasBackPathInState({ from: '/rdo/coordenador?tab=approved' }), true);
  assert.equal(hasBackPathInState({ from: '/conta?tab=perfil' }), false);
  assert.equal(accountBackPath(adminWithEpiOnly, undefined, '/rdo/gestor'), '/rdo/gestor');
  assert.equal(accountPageStateFromPath('/conta'), undefined);
  assert.equal(accountPageStateFromPath('/conta?tab=perfil'), undefined);
});
