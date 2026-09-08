import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { createServer } from 'vite';

async function loadUtils() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom'
  });
  try {
    return await server.ssrLoadModule('/src/pages/assinaturas/utils/coordinates.ts');
  } finally {
    await server.close();
  }
}

test('coordenadas fazem round-trip, clamp e tamanho mínimo', async () => {
  const { clampNormalizedRect, normalizedToPercent, pixelToNormalized } = await loadUtils();
  assert.deepEqual(pixelToNormalized({ x: 50, y: 100, width: 200, height: 80 }, { width: 500, height: 400 }), {
    x: 0.1, y: 0.25, width: 0.4, height: 0.2
  });
  assert.deepEqual(normalizedToPercent({ x: 0.1, y: 0.25, width: 0.4, height: 0.2 }), {
    left: '10%', top: '25%', width: '40%', height: '20%'
  });
  assert.deepEqual(clampNormalizedRect({ x: -1, y: 2, width: 0.001, height: 2 }), {
    x: 0, y: 0, width: 0.02, height: 1
  });
});

test('fragmento é capturado, removido e nunca persistido', async () => {
  const { captureInviteFromFragment } = await loadUtils();
  const replacements = [];
  const storage = new Map();
  const token = 'a'.repeat(64);
  const result = captureInviteFromFragment({
    hash: `#convite=${token}`,
    pathname: '/assinaturas/assinar',
    search: ''
  }, {
    replaceState(_state, _title, url) {
      replacements.push(url);
    }
  });

  assert.equal(result, token);
  assert.deepEqual(replacements, ['/assinaturas/assinar']);
  assert.equal(storage.size, 0);
});

test('token público fica fora de URL, storage e query key; polling não reenvia assinatura', async () => {
  const apiSource = await fs.readFile(new URL('../src/api/assinaturas.ts', import.meta.url), 'utf8');
  const hookSource = await fs.readFile(new URL('../src/hooks/useAssinaturas.ts', import.meta.url), 'utf8');
  const pageSource = await fs.readFile(new URL('../src/pages/assinaturas/AssinaturasPublicSignPage.tsx', import.meta.url), 'utf8');
  const publicQueryKey = hookSource.match(/const queryKey[^\n]+/)?.[0] || '';

  assert.match(apiSource, /'X-Signature-Token': token/);
  assert.doesNotMatch(apiSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(publicQueryKey, /token/);
  assert.match(hookSource, /refetchInterval: polling \? 2_000 : false/);
  assert.equal((pageSource.match(/confirmPublicSignature\(/g) || []).length, 1);
  assert.match(pageSource, /setPolling\(result\.documentStatus === 'FINALIZANDO'\)/);
});
