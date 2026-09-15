import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

let server;
let client;
let comercial;
const storageAnterior = globalThis.localStorage;

test.before(async () => {
  globalThis.localStorage = { getItem: () => null };
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom'
  });
  client = await server.ssrLoadModule('/src/api/client.ts');
  comercial = await server.ssrLoadModule('/src/api/comercial.ts');
});

test.after(async () => {
  globalThis.localStorage = storageAnterior;
  await server?.close();
});

function responderComErro(status, data) {
  client.apiClient.defaults.adapter = async config => {
    throw { isAxiosError: true, config, response: { status, data } };
  };
}

test('a validação do salvamento atravessa o interceptor com os campos pendentes', async () => {
  const issues = [{ path: 'title', message: 'Informe o nome.', severity: 'error' }];
  responderComErro(422, { error: 'O levantamento tem pendências.', issues });

  for (const gravar of [
    () => comercial.criarLevantamento({ status: 'SALVO', payload: {} }),
    () => comercial.atualizarLevantamento('e1', { status: 'SALVO', payload: {} }, {
      expectedUpdatedAt: '2026-09-15T12:00:00.000Z'
    })
  ]) {
    await assert.rejects(gravar, error => {
      assert.ok(error instanceof comercial.ComercialValidationError);
      assert.deepEqual(error.issues, issues);
      return true;
    });
  }
});

test('conflito entre gravações mantém a versão e o autor depois do interceptor', async () => {
  const conflict = {
    updatedAt: '2026-09-15T12:01:00.000Z',
    updatedByUserId: 'colega',
    updatedByLabel: 'Colega'
  };
  responderComErro(409, {
    error: 'O orçamento foi atualizado.',
    code: comercial.CONCURRENT_WRITE_CODE,
    conflict
  });
  await assert.rejects(
    () => comercial.atualizarLevantamento('e1', {}, {
      expectedUpdatedAt: '2026-09-15T12:00:00.000Z'
    }),
    error => {
      assert.ok(error instanceof comercial.ComercialConcurrentWriteError);
      assert.deepEqual(error.conflict, conflict);
      return true;
    }
  );
});

test('falha sem campos preserva a mensagem e o status HTTP', async () => {
  responderComErro(503, { error: 'Serviço indisponível.' });
  await assert.rejects(() => comercial.criarLevantamento({}), error => {
    assert.ok(error instanceof client.ApiClientError);
    assert.equal(error.status, 503);
    assert.equal(error.message, 'Serviço indisponível.');
    return true;
  });
});
