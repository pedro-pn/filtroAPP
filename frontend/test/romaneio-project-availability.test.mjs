import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createServer } from 'vite';

async function loadNavigation() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try {
    return await server.ssrLoadModule('/src/auth/moduleNavigation.ts');
  } finally {
    await server.close();
  }
}

test('formulário consulta projetos pelo tipo e limita código manual à Entrada', async () => {
  const [api, page] = await Promise.all([
    readFile(new URL('../src/api/romaneio.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/romaneio/NewRomaneioPage.tsx', import.meta.url), 'utf8')
  ]);
  assert.match(api, /listRomaneioProjects\(filters/);
  assert.match(api, /params:\s*filters/);
  assert.match(page, /\['romaneio-projects', romaneioType\]/);
  assert.match(page, /listRomaneioProjects\(\{ type: romaneioType \}\)/);
  assert.match(page, /romaneioType === 'INBOUND'.*MANUAL_PROJECT_OPTION/s);
  assert.match(page, /Somente obras autorizadas para mobilização e obras antigas não concluídas/);
  assert.match(page, /Todas as obras acessíveis ficam disponíveis para entrada/);
});

test('campanha temporária aponta os controles reais do formulário', async () => {
  const [novelty, page, navigation] = await Promise.all([
    readFile(new URL('../src/pages/romaneio/RomaneioProjectAvailabilityNovelty.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/romaneio/NewRomaneioPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/auth/moduleNavigation.ts', import.meta.url), 'utf8')
  ]);
  assert.match(novelty, /Projetos disponíveis por tipo/);
  assert.match(novelty, /data-romaneio-project-type/);
  assert.match(novelty, /data-romaneio-project-select/);
  assert.match(page, /<RomaneioProjectAvailabilityNovelty/);
  assert.match(page, /data-romaneio-project-type/);
  assert.match(page, /data-romaneio-project-select/);
  assert.match(navigation, /ROMANEIO_PROJECT_AVAILABILITY_IMPLEMENTED_AT = '2026-09-09'/);
  assert.match(navigation, /2026-09-19T23:59:59-03:00/);
});

test('campanha é individual e expira globalmente após dez dias', async () => {
  const stored = new Map();
  const originalNow = Date.now;
  globalThis.window = {
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value)
    }
  };
  try {
    Date.now = () => new Date('2026-09-19T12:00:00-03:00').getTime();
    const navigation = await loadNavigation();
    assert.equal(navigation.shouldShowRomaneioProjectAvailabilityNovelty({ id: 'operator-1' }), true);
    navigation.markRomaneioProjectAvailabilityNoveltySeen({ id: 'operator-1' });
    assert.equal(navigation.shouldShowRomaneioProjectAvailabilityNovelty({ id: 'operator-1' }), false);
    assert.equal(navigation.shouldShowRomaneioProjectAvailabilityNovelty({ id: 'operator-2' }), true);
    Date.now = () => new Date('2026-09-20T00:00:00-03:00').getTime();
    assert.equal(navigation.shouldShowRomaneioProjectAvailabilityNovelty({ id: 'operator-3' }), false);
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
  }
});
