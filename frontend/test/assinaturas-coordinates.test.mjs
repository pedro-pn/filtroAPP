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

test('campo redimensiona pelas quatro bordas e cantos mantendo a borda oposta', async () => {
  const { resizeNormalizedRect } = await loadUtils();
  const rect = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 };
  const check = (direction, dx, dy, expected) => {
    const actual = resizeNormalizedRect(rect, direction, dx, dy);
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${direction}: ${key}`);
  };
  check('w', 0.1, 0, { x: 0.3, y: 0.3, width: 0.3, height: 0.2 });
  check('n', 0, -0.1, { x: 0.2, y: 0.2, width: 0.4, height: 0.3 });
  check('e', 0.1, 0, { x: 0.2, y: 0.3, width: 0.5, height: 0.2 });
  check('s', 0, 0.1, { x: 0.2, y: 0.3, width: 0.4, height: 0.3 });
  check('nw', -0.1, -0.1, { x: 0.1, y: 0.2, width: 0.5, height: 0.3 });
  check('se', 0.1, 0.1, { x: 0.2, y: 0.3, width: 0.5, height: 0.3 });
  check('ne', 0.1, -0.1, { x: 0.2, y: 0.2, width: 0.5, height: 0.3 });
  check('sw', -0.1, 0.1, { x: 0.1, y: 0.3, width: 0.5, height: 0.3 });
  check('w', 1, 0, { x: 0.58, y: 0.3, width: 0.02, height: 0.2 });
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

test('leitura do fragmento é pura e sobrevive a uma renderização repetida', async () => {
  const { inviteTokenFromFragment } = await loadUtils();
  const token = 'a'.repeat(64);
  const location = { hash: `#convite=${token}` };

  assert.equal(inviteTokenFromFragment(location), token);
  assert.equal(inviteTokenFromFragment(location), token);
  assert.equal(location.hash, `#convite=${token}`);
});

test('novo fragmento pode substituir um convite já capturado na mesma aba', async () => {
  const { captureInviteFromFragment } = await loadUtils();
  const location = {
    hash: `#convite=${'a'.repeat(64)}`,
    pathname: '/assinaturas/assinar',
    search: ''
  };
  const replacements = [];
  const history = {
    replaceState(_state, _title, url) {
      replacements.push(url);
      location.hash = '';
    }
  };

  assert.equal(captureInviteFromFragment(location, history), 'a'.repeat(64));
  location.hash = `#convite=${'b'.repeat(64)}`;
  assert.equal(captureInviteFromFragment(location, history), 'b'.repeat(64));
  assert.deepEqual(replacements, ['/assinaturas/assinar', '/assinaturas/assinar']);
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
  assert.match(hookSource, /\[token\]/);
  assert.equal((pageSource.match(/confirmPublicSignature\(/g) || []).length, 1);
  assert.match(pageSource, /useState\(\(\) => inviteTokenFromFragment\(window\.location\)\)/);
  assert.doesNotMatch(pageSource, /useState\(\(\) => captureInviteFromFragment/);
  assert.match(pageSource, /addEventListener\('hashchange', captureRenewedInvite\)/);
  assert.match(pageSource, /captureRenewedInvite\(\);/);
  assert.match(pageSource, /setToken\(nextToken\)/);
  assert.match(pageSource, /setPolling\(result\.documentStatus === 'FINALIZANDO'\)/);
});
