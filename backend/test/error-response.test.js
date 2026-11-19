import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

import { errorCodeForStatus, requestIdMiddleware, sendError, standardErrorBodyMiddleware } from '../src/lib/http/error-response.js';

async function withApp(configure, run) {
  const app = express();
  app.use('/api', requestIdMiddleware, standardErrorBodyMiddleware);
  configure(app);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('internal API errors always carry code and the same requestId as the header', async () => {
  await withApp(app => {
    app.get('/api/legacy', (_req, res) => res.status(403).json({ error: 'Acesso restrito ao módulo.' }));
    app.get('/api/coded', (_req, res) => res.status(409).json({ error: 'Já existe.', code: 'DUPLICATE_RECORD', conflicts: [1] }));
    app.get('/api/helper', (_req, res) => sendError(res, 422, null, 'Não processável.', { field: 'x' }));
    app.get('/api/ok', (_req, res) => res.json({ error: 'campo de dado, não erro' }));
  }, async base => {
    const legacy = await fetch(`${base}/api/legacy`);
    const legacyBody = await legacy.json();
    assert.equal(legacyBody.error, 'Acesso restrito ao módulo.', 'a mensagem que o frontend mostra não muda');
    assert.equal(legacyBody.code, 'FORBIDDEN');
    assert.equal(legacyBody.requestId, legacy.headers.get('x-request-id'));

    const coded = await (await fetch(`${base}/api/coded`)).json();
    assert.equal(coded.code, 'DUPLICATE_RECORD', 'código já existente é preservado');
    assert.deepEqual(coded.conflicts, [1], 'campos extras são preservados');

    const helper = await (await fetch(`${base}/api/helper`)).json();
    assert.deepEqual({ ...helper, requestId: undefined }, { error: 'Não processável.', code: 'UNPROCESSABLE_ENTITY', details: { field: 'x' }, requestId: undefined });

    const ok = await (await fetch(`${base}/api/ok`)).json();
    assert.deepEqual(ok, { error: 'campo de dado, não erro' }, 'respostas 2xx ficam intactas');
  });
});

test('a valid incoming X-Request-Id is reused; an invalid one is replaced', async () => {
  await withApp(app => {
    app.get('/api/x', (_req, res) => res.status(404).json({ error: 'Não encontrado.' }));
  }, async base => {
    const reused = await fetch(`${base}/api/x`, { headers: { 'x-request-id': 'proxy-1234abcd' } });
    assert.equal((await reused.json()).requestId, 'proxy-1234abcd');
    const replaced = await fetch(`${base}/api/x`, { headers: { 'x-request-id': 'bad id <script>' } });
    const id = (await replaced.json()).requestId;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(replaced.headers.get('x-request-id'), id);
  });
});

test('the public v1 integration API keeps its own error envelope', async () => {
  await withApp(app => {
    app.get('/api/integracoes/v1/x', (_req, res) => res.status(401).json({ error: 'token', other: true }));
  }, async base => {
    assert.deepEqual(await (await fetch(`${base}/api/integracoes/v1/x`)).json(), { error: 'token', other: true });
  });
});

test('generic codes by HTTP status', () => {
  assert.equal(errorCodeForStatus(400), 'BAD_REQUEST');
  assert.equal(errorCodeForStatus(429), 'TOO_MANY_REQUESTS');
  assert.equal(errorCodeForStatus(418), 'BAD_REQUEST');
  assert.equal(errorCodeForStatus(599), 'INTERNAL_ERROR');
});
