import assert from 'node:assert/strict';
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

async function loadPontoApi() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try {
    return await server.ssrLoadModule('/src/api/acompanhamentoPonto.ts');
  } finally {
    await server.close();
  }
}

test('novidade da sincronização aparece uma vez por usuário e expira globalmente em dez dias', async () => {
  const stored = new Map();
  const originalNow = Date.now;
  globalThis.window = {
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value)
    }
  };

  try {
    Date.now = () => new Date('2026-08-17T12:00:00-03:00').getTime();
    const navigation = await loadNavigation();
    assert.equal(navigation.shouldShowPontoMaisSyncNovelty({ id: 'manager-1' }), true);
    navigation.markPontoMaisSyncNoveltySeen({ id: 'manager-1' });
    assert.equal(navigation.shouldShowPontoMaisSyncNovelty({ id: 'manager-1' }), false);
    assert.equal(navigation.shouldShowPontoMaisSyncNovelty({ id: 'manager-2' }), true);

    Date.now = () => new Date('2026-08-28T00:00:00-03:00').getTime();
    assert.equal(navigation.shouldShowPontoMaisSyncNovelty({ id: 'manager-3' }), false);
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
  }
});

test('estado e origem da sincronização automática usam rótulos claros', async () => {
  const api = await loadPontoApi();
  assert.equal(api.pontoMaisSyncTriggerLabel('AUTOMATIC_BOOTSTRAP'), 'Carga histórica automática');
  assert.equal(api.pontoMaisSyncTriggerLabel('AUTOMATIC_DAILY'), 'Atualização diária automática');
  assert.equal(api.pontoMaisSyncTriggerLabel('MANUAL'), 'Contingência manual');
  assert.equal(api.pontoMaisBootstrapStatusLabel('RUNNING'), 'Carga histórica em andamento');
  assert.equal(api.pontoMaisBootstrapStatusLabel('FAILED'), 'Carga histórica aguardando nova tentativa automática');
  assert.equal(api.pontoMaisBootstrapStatusLabel('SUCCEEDED'), 'Carga histórica concluída');
  assert.equal(api.pontoMaisBootstrapStatusLabel('SUCCEEDED', true), 'Sincronização em andamento');
});

test('novidade da política de mão de obra expira em dez dias e é individual por gestor', async () => {
  const stored = new Map();
  const originalNow = Date.now;
  globalThis.window = {
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value)
    }
  };

  try {
    Date.now = () => new Date('2026-08-17T12:00:00-03:00').getTime();
    const navigation = await loadNavigation();
    assert.equal(navigation.shouldShowAcompanhamentoLaborPolicyNovelty({ id: 'manager-1' }), true);
    navigation.markAcompanhamentoLaborPolicyNoveltySeen({ id: 'manager-1' });
    assert.equal(navigation.shouldShowAcompanhamentoLaborPolicyNovelty({ id: 'manager-1' }), false);
    assert.equal(navigation.shouldShowAcompanhamentoLaborPolicyNovelty({ id: 'manager-2' }), true);

    Date.now = () => new Date('2026-08-28T00:00:00-03:00').getTime();
    assert.equal(navigation.shouldShowAcompanhamentoLaborPolicyNovelty({ id: 'manager-3' }), false);
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
  }
});
