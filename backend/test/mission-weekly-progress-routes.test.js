import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import app from '../src/app.js';
import prisma from '../src/lib/prisma.js';
import { buildWeeklyProgressComparison } from '../../shared/modules/mission-weekly-progress.js';

const payload = { weekStartDate: '2026-09-28', plannedPctPoints: 10, expectedRevision: 0 };
const projectPath = '/api/acompanhamento/comercial/projetos/p1/metas-semanais';
const missionPath = '/api/efetivo/planning/missions/m1/weekly-targets';

test('APIs das duas áreas compartilham metas, validam entradas e preservam permissões de leitura', async t => {
  let manager = true;
  let productiveEndTime = '16:00';
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
  stub(prisma.acompanhamentoMissionGroupMember, 'findMany', async () => [{ projectId: 'p1' }]);
  stub(prisma.projectPlannedService, 'findMany', async () => []);
  stub(prisma.project, 'findMany', async () => [{ id: 'p1', workdayHours: '09:30', weekendWorkdayHours: '04:00' }]);
  stub(prisma.projectManualProgressHistory, 'findMany', async () => []);
  stub(prisma.historicalServiceReport, 'findMany', async () => []);
  stub(prisma.projectRealizedCorrection, 'findMany', async () => []);
  stub(prisma.reportService, 'findMany', async () => [{
    id: 's1', finalized: true, serviceType: 'Filtragem', extraData: { volumeOleo: 12000 },
    report: { id: 'r1', projectId: 'p1', reportDate: new Date('2026-09-28'), reportType: 'RDO' }
  }]);
  stub(prisma.report, 'findMany', async ({ where }) => {
    assert.deepEqual(where, { projectId: { in: ['p1'] }, reportType: 'RDO', deletedAt: null });
    return [{ reportType: 'RDO', reportDate: '2026-09-28', arrivalTime: '08:00', departureTime: '16:00', lunchBreak: 'sem intervalo',
      collaborators: [{ collaboratorId: 'c1', jobRoleSnapshot: { isOperational: true } }],
      services: [{ serviceType: 'Filtragem', startTime: '08:00', endTime: productiveEndTime, extraData: { serviceCollaboratorIds: ['c1'] } }] }];
  });
  stub(prisma.missionWeeklyProgressTarget, 'findFirst', async ({ where }) => records.filter(row => row.projectId === where.projectId && row.groupId === where.groupId && +row.weekStartDate === +where.weekStartDate).sort((a, b) => b.revision - a.revision)[0] ?? null);
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
  assert.equal(listed.data.defaultReferenceDayHours, 9.5);
  assert.deepEqual(listed.data.targets.map(row => row.plannedPctPoints), [10, 15]);
  assert.equal((await request('PUT', projectPath, payload)).status, 409);
  assert.equal((await request('PUT', missionPath, { ...payload, plannedPctPoints: -1 })).status, 400);
  assert.equal((await request('PUT', projectPath, { ...payload, weekStartDate: '2026-09-30' })).status, 400);
  const groupPath = '/api/acompanhamento/comercial/grupos-missoes/g1/metas-semanais';
  assert.equal((await request('PUT', groupPath, payload)).status, 200);
  assert.equal((await request('GET', groupPath)).data.targets.length, 1);

  const rate = { metric: 'L', basis: 'PER_PRODUCTIVE_DAY', scenarios: [{ name: 'Filtragem', condition: { kind: 'ALWAYS' },
    goals: [{ serviceType: 'FILTRAGEM', value: 1000 }] }] };
  const flexible = await request('PUT', projectPath, { weekStartDate: payload.weekStartDate, expectedRevision: 2, definition: rate });
  assert.equal(flexible.status, 200);
  assert.equal(flexible.data.plannedPctPoints, null);
  assert.deepEqual(flexible.data.definition, rate);
  const physical = await request('GET', `${projectPath}?services=true`);
  assert.deepEqual(physical.data.serviceHistory, [{ date: '2026-09-28', serviceType: 'FILTRAGEM', quantities: { M: 0, L: 12000, UN: 0 } }, { date: '2026-09-28', serviceType: 'FILTRAGEM', quantities: { M: 0, L: 0, UN: 0 }, productivePersonMinutes: 480, productivityIssues: [] }]);
  const mission = await request('GET', `${missionPath}?services=true`);
  assert.equal(mission.data.defaultReferenceDayHours, 9.5);
  assert.equal(mission.status, 200);
  assert.deepEqual(mission.data.serviceHistory, physical.data.serviceHistory);
  assert.deepEqual(mission.data.targets, physical.data.targets);
  const grouped = await request('GET', `${groupPath}?services=true`);
  assert.equal(grouped.data.defaultReferenceDayHours, 9.5);
  assert.deepEqual(grouped.data.serviceHistory, physical.data.serviceHistory);
  const compare = data => buildWeeklyProgressComparison({ ...data, today: '2026-10-02' }).find(row => row.weekStartDate === payload.weekStartDate);
  assert.equal(compare(physical.data).plannedValue, 1000);
  productiveEndTime = '12:00';
  const updatedRdo = await request('GET', `${projectPath}?services=true`);
  assert.equal(compare(updatedRdo.data).plannedValue, 500);
  assert.deepEqual(updatedRdo.data.targets, physical.data.targets);
  assert.equal((await request('PUT', projectPath, { weekStartDate: payload.weekStartDate, definition: { ...rate, scenarios: [] }, expectedRevision: 3 })).status, 400);

  const deletion = { weekStartDate: payload.weekStartDate, expectedRevision: 3 };
  assert.equal((await request('DELETE', projectPath, { ...deletion, expectedRevision: 2 })).status, 409);
  assert.equal((await request('DELETE', projectPath, { ...deletion, weekStartDate: '2026-09-29' })).status, 400);
  const removed = await request('DELETE', missionPath, deletion);
  assert.equal(removed.status, 200);
  assert.equal(removed.data.isDeleted, true);
  assert.equal(removed.data.revision, 4);
  assert.deepEqual(removed.data.author, { id: 'u1', name: 'Gestora' });
  const afterDelete = await request('GET', projectPath);
  assert.equal(compare(afterDelete.data).status, 'NO_TARGET');
  assert.equal(afterDelete.data.targets.length, 4);
  assert.equal((await request('DELETE', projectPath, { ...deletion, expectedRevision: 4 })).status, 404);
  assert.equal((await request('DELETE', groupPath, { ...deletion, expectedRevision: 1 })).status, 200);
  assert.equal(compare((await request('GET', groupPath)).data).status, 'NO_TARGET');
  assert.equal((await request('PUT', projectPath, { ...payload, expectedRevision: 4 })).data.revision, 5);
  assert.equal(compare((await request('GET', missionPath)).data).plannedValue, 10);

  manager = false;
  assert.equal((await request('GET', projectPath)).status, 200);
  assert.equal((await request('GET', groupPath)).status, 200);
  assert.equal((await request('PUT', projectPath, payload)).status, 403);
  assert.equal((await request('PUT', groupPath, payload)).status, 403);
  assert.equal((await request('PUT', missionPath, payload)).status, 403);
  assert.equal((await request('DELETE', projectPath, { ...deletion, expectedRevision: 5 })).status, 403);
  assert.equal((await request('DELETE', groupPath, deletion)).status, 403);
  assert.equal((await request('DELETE', missionPath, { ...deletion, expectedRevision: 5 })).status, 403);
  assert.equal(records.length, 7);
});
