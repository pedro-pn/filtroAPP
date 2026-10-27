import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import router from '../src/routes/efetivo-project-workflow.js';

test('rota de conversão recusa contas internas e valida a entrada de admins', async t => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { user: { id: 'user-1', accountType: req.get('x-test-account-type'), moduleRoles: ['efetivo:manager'] } };
    next();
  });
  app.use(router);
  app.use((error, _req, res, _next) => res.status(error.name === 'ZodError' ? 400 : 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/project-1/legacy-summary/convert`;
  for (const accountType of ['INTERNAL', 'CLIENT']) {
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-account-type': accountType },
      body: JSON.stringify({ version: 1, stage: 'FINISHED', reason: 'Obra concluída.' })
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /administrador/i);
  }
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-test-account-type': 'ADMIN' },
    body: JSON.stringify({ version: 1, stage: 'FINISHED', reason: '   ' })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /motivo da conversão/);
});
