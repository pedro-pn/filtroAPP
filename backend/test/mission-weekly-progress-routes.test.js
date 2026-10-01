import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import app from '../src/app.js';
import prisma from '../src/lib/prisma.js';

const payload = { weekStartDate: '2026-09-28', plannedPctPoints: 10, expectedRevision: 0 };
const projectPath = '/api/acompanhamento/comercial/projetos/p1/metas-semanais';
const missionPath = '/api/efetivo/planning/missions/m1/weekly-targets';

test('APIs das duas áreas compartilham metas, validam entradas e preservam permissões de leitura', async t => {
  let manager = true;
  const records = [];
  const originals = [];
  const stub = (model, method, fn) => {
    originals.push([model, method, model[method]]);
    model[method] = fn;
  };
  stub(prisma.userSession, 'findUnique', async () => ({
    id: 'weekly-target-session', expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: 'u1', username: 'weekly', name: 'Gestora', email: 'weekly@example.com', isActive: true,
      role: manager ? 'MANAGER' : 'COLLABORATOR', accountType: manager ? 'ADMIN' : 'INTERNAL',
      moduleRoles: manager ? [] : [{ role: 'ACOMPANHAMENTO_VIEWER' }, { role: 'EFETIVO_VIEWER' }]
    }
  }));
  stub(prisma.project, 'findFirst', async () => ({ id: 'p1' }));
  stub(prisma.efetivoMissionPlan, 'findFirst', async () => ({ projectId: 'p1' }));
  stub(prisma.acompanhamentoMissionGroup, 'findFirst', async () => ({ id: 'g1' }));
  stub(prisma.missionWeeklyProgressTarget, 'findFirst', async ({ where }) => records.filter(row => row.projectId === where.projectId && +row.weekStartDate === +where.weekStartDate).sort((a, b) => b.revision - a.revision)[0] ?? null);
  stub(prisma.missionWeeklyProgressTarget, 'findMany', async ({ where }) => records.filter(row => row.projectId === where.projectId && row.groupId === where.groupId));
  stub(prisma.missionWeeklyProgressTarget, 'create', async ({ data }) => {
    const row = { ...data, id: `target-${records.length}`, createdAt: new Date() };
    records.push(row);
    return row;
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    for (const [model, method, original] of originals) model[method] = original;
  });
  await once(server, 'listening');
  const request = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { authorization: 'Bearer weekly-target-token', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: res.status, data: await res.json() };
  };

  const created = await request('PUT', projectPath, payload);
  assert.equal(created.status, 200);
  assert.equal(created.data.plannedPctPoints, 10);
  assert.deepEqual(created.data.author, { id: 'u1', name: 'Gestora' });
  const edited = await request('PUT', missionPath, { ...payload, plannedPctPoints: 15, expectedRevision: 1 });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.revision, 2);
  const listed = await request('GET', projectPath);
  assert.deepEqual(listed.data.targets.map(row => row.plannedPctPoints), [10, 15]);
  assert.equal((await request('PUT', projectPath, payload)).status, 409);
  assert.equal((await request('PUT', missionPath, { ...payload, plannedPctPoints: -1 })).status, 400);
  assert.equal((await request('PUT', projectPath, { ...payload, weekStartDate: '2026-09-30' })).status, 400);
  const groupPath = '/api/acompanhamento/comercial/grupos-missoes/g1/metas-semanais';
  assert.equal((await request('PUT', groupPath, payload)).status, 200);
  assert.equal((await request('GET', groupPath)).data.targets.length, 1);

  manager = false;
  assert.equal((await request('GET', projectPath)).status, 200);
  assert.equal((await request('GET', groupPath)).status, 200);
  assert.equal((await request('PUT', projectPath, payload)).status, 403);
  assert.equal((await request('PUT', groupPath, payload)).status, 403);
  assert.equal((await request('PUT', missionPath, payload)).status, 403);
  assert.equal(records.length, 3);
});
