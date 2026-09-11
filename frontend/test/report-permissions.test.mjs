import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function load(path) {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try {
    return await server.ssrLoadModule(path);
  } finally {
    await server.close();
  }
}

test('o fluxo tradicional resolve somente RDO de obra', async () => {
  const permissions = await load('/src/auth/reportPermissions.ts');
  assert.equal(
    permissions.resolveSiteReportSelection(['SITE_RDO']),
    'obra'
  );
  assert.equal(
    permissions.resolveSiteReportSelection(['MAINTENANCE']),
    null
  );
  assert.equal(
    permissions.resolveSiteReportSelection(['SITE_RDO', 'MAINTENANCE', 'PRODUCTION']),
    'obra'
  );
});

test('abas do módulo seguem estritamente as permissões de manutenção e produção', async () => {
  const permissions = await load('/src/auth/reportPermissions.ts');
  assert.deepEqual(
    permissions.allowedOperationalModuleTabs(['MAINTENANCE']),
    ['manutencao', 'programacao-manutencao', 'historico-manutencao']
  );
  assert.deepEqual(
    permissions.allowedOperationalModuleTabs(['PRODUCTION']),
    ['producao']
  );
  assert.deepEqual(
    permissions.allowedOperationalModuleTabs(['MAINTENANCE', 'PRODUCTION']),
    [
      'manutencao',
      'producao',
      'programacao-manutencao',
      'historico-manutencao'
    ]
  );
  assert.deepEqual(permissions.allowedOperationalModuleTabs(['SITE_RDO']), []);
  assert.equal(
    permissions.resolveOperationalModuleTab(['PRODUCTION'], 'manutencao'),
    'producao'
  );
  assert.equal(
    permissions.resolveOperationalModuleTab([], 'producao'),
    null
  );
});

test('manutenção avulsa usa a mesma permissão de manutenção', async () => {
  const permissions = await load('/src/auth/reportPermissions.ts');
  assert.equal(
    permissions.canAccessReportSelection(['MAINTENANCE'], 'manutencao-avulsa'),
    true
  );
  assert.equal(
    permissions.canAccessReportSelection(['SITE_RDO'], 'manutencao-avulsa'),
    false
  );
});

test('o módulo só fica disponível com manutenção ou produção', async () => {
  const permissions = await load('/src/auth/reportPermissions.ts');
  assert.equal(permissions.canAccessOperationalModule(['SITE_RDO']), false);
  assert.equal(permissions.canAccessOperationalModule(['MAINTENANCE']), true);
  assert.equal(permissions.canAccessOperationalModule(['PRODUCTION']), true);
});
