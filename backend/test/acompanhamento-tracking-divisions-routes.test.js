import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import app from '../src/app.js';
import prisma from '../src/lib/prisma.js';
import { divisionKey } from '../src/lib/acompanhamento/tracking-divisions.js';

test('API cria divisões por datas sem escopo ou mobilização e mantém permissão de gestão', async t => {
  let manager = true;
  let project = { id: 'p1', trackingDivisions: [] };
  const originals = [];
  const stub = (model, method, fn) => { originals.push([model, method, model[method]]); model[method] = fn; };
  stub(prisma.userSession, 'findUnique', async () => ({ expiresAt: new Date(Date.now() + 60000), user: {
    id: 'u1', username: 'division', name: 'Gestora', isActive: true, role: manager ? 'MANAGER' : 'COLLABORATOR',
    accountType: manager ? 'ADMIN' : 'INTERNAL', moduleRoles: manager ? [] : [{ role: 'ACOMPANHAMENTO_VIEWER' }]
  } }));
  stub(prisma.project, 'findFirst', async () => project);
  stub(prisma.project, 'update', async ({ data }) => { project = { ...project, ...data }; return project; });
  stub(prisma.projectPlannedService, 'findMany', async () => []);
  stub(prisma, '$transaction', async callback => callback(prisma));
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    for (const [model, method, original] of originals) model[method] = original;
  });
  await once(server, 'listening');
  const request = async (method, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/acompanhamento/comercial/projetos/p1/divisoes`, {
      method, headers: { authorization: 'Bearer division-test', 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, data: await response.json() };
  };
  const division = { key: divisionKey('DATE', 'period-1'), label: 'Primeira etapa', startDate: '2026-09-01', endDate: '2026-09-30' };
  const created = await request('PUT', { divisions: [division] });
  assert.equal(created.status, 200);
  assert.equal(created.data.divisions[0].mobilizationDate, division.startDate);
  assert.equal(created.data.candidates[0].kind, 'DATE');
  assert.equal((await request('GET')).data.candidates[0].label, division.label);
  assert.equal((await request('PATCH', { division: { ...division, label: 'Etapa revisada' } })).status, 200);
  assert.equal(project.trackingDivisions[0].label, 'Etapa revisada');
  for (const patch of [{ endDate: '2026-08-31' }, { label: '' }, { startDate: '2026-02-30' }, { key: '["DATE",null,null]' }]) {
    assert.equal((await request('PUT', { divisions: [{ ...division, ...patch }] })).status, 400);
  }
  assert.equal(project.trackingDivisions[0].label, 'Etapa revisada');
  manager = false;
  assert.equal((await request('GET')).status, 200);
  assert.equal((await request('PUT', { divisions: [] })).status, 403);
  assert.equal((await request('PATCH', { division })).status, 403);
  manager = true;
  const cleared = await request('PUT', { divisions: [] });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.data, { candidates: [], divisions: [] });
});
