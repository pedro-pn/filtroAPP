import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
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

test('campanha do botão Tirar foto dura 5 dias corridos a partir de 21/09/2026', async () => {
  const navigation = await loadNavigation();
  const start = new Date(`${navigation.PHOTO_CAPTURE_NOVELTY_IMPLEMENTED_AT}T00:00:00-03:00`).getTime();
  const days = (navigation.PHOTO_CAPTURE_NOVELTY_EXPIRES_AT.getTime() - start) / 86400000;
  assert.equal(Math.ceil(days), 5);
  assert.equal(navigation.PHOTO_CAPTURE_NOVELTY_EXPIRES_AT.toISOString(), '2026-09-26T02:59:59.000Z');
});

test('novidade aparece uma vez por usuário em cada tela e expira globalmente', async () => {
  const stored = new Map();
  const originalNow = Date.now;
  globalThis.window = { localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) } };

  try {
    Date.now = () => new Date('2026-09-21T12:00:00-03:00').getTime();
    const { shouldShowPhotoCaptureNovelty: show, markPhotoCaptureNoveltySeen: mark } = await loadNavigation();
    const user = { id: 'colaborador-1' };

    assert.equal(show(user, 'rdo-new'), true);
    mark(user, 'rdo-new');
    assert.equal(show(user, 'rdo-new'), false, 'já vista nesta tela');
    assert.equal(show(user, 'rdo-edit'), true, 'cada tela tem a sua própria exibição');
    assert.equal(show(user, 'maintenance'), true);
    assert.equal(show({ id: 'colaborador-2' }, 'rdo-new'), true, 'outro usuário ainda não viu');
    assert.equal(show(null, 'rdo-new'), false);

    Date.now = () => new Date('2026-09-25T23:59:00-03:00').getTime();
    assert.equal(show(user, 'maintenance'), true, 'ainda vale no último dia');
    Date.now = () => new Date('2026-09-26T00:00:01-03:00').getTime();
    assert.equal(show(user, 'maintenance'), false, 'expirou');
    assert.equal(show({ id: 'colaborador-2' }, 'rdo-new'), false);
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
  }
});

test('toda página que exibe o botão Tirar foto monta a novidade com a sua posição', async () => {
  const pagesRoot = new URL('../src/pages/', import.meta.url);
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) await walk(url);
      else if (entry.name.endsWith('.tsx')) files.push(url);
    }
  }
  await walk(pagesRoot);

  const expected = new Map([
    ['collaborator/NewReportPage.tsx', 'rdo-new'],
    ['ReportDetailPage.tsx', 'rdo-edit'],
    ['collaborator/OperationalReportFormPage.tsx', 'maintenance']
  ]);
  // Páginas que renderizam o botão, direta ou indiretamente (UploadField e ServiceFields o contêm).
  const rendersButton = /<(?:UploadField|PhotoCaptureButton|ServiceFields)\b/;
  const found = new Map();
  for (const url of files) {
    const source = await readFile(url, 'utf8');
    const name = url.pathname.slice(pagesRoot.pathname.length);
    if (rendersButton.test(source)) found.set(name, source);
  }

  assert.deepEqual([...found.keys()].sort(), [...expected.keys()].sort());
  for (const [name, placement] of expected) {
    assert.match(found.get(name), new RegExp(`<PhotoCaptureNovelty[^>]*placement="${placement}"`), name);
  }
});

test('o botão Tirar foto expõe a âncora usada pelo destaque', async () => {
  const source = await readFile(new URL('../src/components/ui/PhotoCaptureButton.tsx', import.meta.url), 'utf8');
  assert.match(source, /data-photo-capture\b/);
});
