import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import app from '../src/app.js';
import prisma from '../src/lib/prisma.js';

test('cronograma persiste a escolha manual, aceita zero e permite retomar cálculo automático', async t => {
  let project = { id: 'p1', manualProgressPct: null, forceManualProgress: false };
  const history = [];
  const originals = [];
  const stub = (model, method, fn) => { originals.push([model, method, model[method]]); model[method] = fn; };
  stub(prisma.userSession, 'findUnique', async () => ({ expiresAt: new Date(Date.now() + 60000), user: {
    id: 'u1', username: 'manual', name: 'Gestora', isActive: true, role: 'MANAGER', accountType: 'ADMIN', moduleRoles: []
  } }));
  stub(prisma.project, 'findUnique', async () => project);
  stub(prisma.project, 'update', async ({ data }) => { project = { ...project, ...data }; return project; });
  stub(prisma.projectManualProgressHistory, 'create', async ({ data }) => { history.push(data); return data; });
  stub(prisma, '$transaction', async callback => callback(prisma));
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    for (const [model, method, original] of originals) model[method] = original;
  });
  await once(server, 'listening');
  const request = async body => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/acompanhamento/comercial/projetos/p1/cronograma`, {
      method: 'PATCH', headers: { authorization: 'Bearer manual-test', 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await request({ forceManualProgress: true })).status, 400);
  assert.equal(project.forceManualProgress, false);
  assert.equal((await request({ manualProgressPct: 0, forceManualProgress: true })).status, 200);
  assert.equal(project.forceManualProgress, true);
  assert.equal(project.manualProgressPct, 0);
  assert.deepEqual(history.map(point => point.progressPct), [0]);
  assert.equal((await request({ manualProgressPct: 73.5 })).status, 200);
  assert.equal(project.manualProgressPct, 73.5);
  assert.deepEqual(history.map(point => point.progressPct), [0, 73.5]);
  for (const payload of [{ manualProgressPct: null }, { manualProgressPct: 101 }, { manualProgressPct: -1 }, { forceManualProgress: 'true' }]) {
    assert.equal((await request(payload)).status, 400);
  }
  assert.equal(project.manualProgressPct, 73.5);
  assert.equal((await request({ forceManualProgress: false })).status, 200);
  assert.equal(project.forceManualProgress, false);
  assert.equal(project.manualProgressPct, 73.5);
  assert.equal(history.length, 2);
  assert.equal((await request({ forceManualProgress: true })).status, 200);
  assert.equal(project.forceManualProgress, true);
  assert.equal((await request({ forceManualProgress: false, manualProgressPct: null })).status, 200);
  assert.equal(project.manualProgressPct, null);
  assert.equal(history.length, 2);
});
