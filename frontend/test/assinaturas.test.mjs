import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadRegistry() {
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

test('assinaturas is registered in the module registry', async () => {
  const { moduleDefinition, moduleRoutePath } = await loadRegistry();

  assert.equal(moduleDefinition('assinaturas')?.title, 'Assinaturas');
  assert.equal(moduleRoutePath('assinaturas', 'index'), '/assinaturas');
});
