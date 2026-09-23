import assert from 'node:assert/strict';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import test from 'node:test';

test('HTTP + PostgreSQL: commercial forecast, divergence resolution, stale edits, permissions and all project views', {
  skip: !process.env.PLANNED_HOURS_TEST_DATABASE_URL
}, async t => {
  const url = new URL(process.env.PLANNED_HOURS_TEST_DATABASE_URL);
  assert.match(url.pathname, /_test$/);
  process.env.DATABASE_URL = url.toString();
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const { getProjectDetail } = await import('../src/lib/acompanhamento/project-detail.js');
  const { listProjectCards } = await import('../src/lib/acompanhamento/project-cards.js');
  const { getMissionGroupDetail } = await import('../src/lib/acompanhamento/project-detail-groups.js');
  const { clearProjectDerivedCaches } = await import('../src/lib/resource-list-cache.js');
  const suffix = randomUUID(), code = randomInt(1_000_000, 100_000_000);
  const users = [], proposals = [];
  let project, server, group;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (group) await prisma.acompanhamentoMissionGroup.delete({ where: { id: group.id } });
    // The dashboard can create pending projects for unmatched fixture proposals.
    await prisma.project.deleteMany({ where: { OR: [
      { id: project?.id ?? 'missing-fixture' },
      { commercialProposalCode: { in: proposals.map(p => String(p.codProp)) } }
    ] } });
    await prisma.commercialProposal.deleteMany({ where: { id: { in: proposals.map(p => p.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
    await prisma.$disconnect();
  });
  for (const role of ['ACOMPANHAMENTO_MANAGER', 'ACOMPANHAMENTO_VIEWER']) users.push(await prisma.user.create({ data: {
    username: `${role}-${suffix}`, name: role, passwordHash: 'test-only', role: 'COLLABORATOR', accountType: 'INTERNAL',
    moduleRoles: { create: { module: 'ACOMPANHAMENTO', role } }
  } }));
  const tokens = users.map(() => randomUUID());
  await prisma.userSession.createMany({ data: users.map((u, i) => ({ userId: u.id,
    tokenHash: createHash('sha256').update(tokens[i]).digest('hex'), expiresAt: new Date(Date.now() + 600_000) })) });
  proposals.push(await prisma.commercialProposal.create({ data: { codBd: code, codProp: code, rawRow: {}, salePrice: 1000, isComplete: true } }));
  project = await prisma.project.create({ data: { code: String(code), name: 'Teste horas previstas', clientName: 'Cliente', clientCnpj: '',
    contractCode: String(code), location: '', commercialProposalCode: String(code), budgets: { create: { sourceProposalCodBd: code } } } });
  group = await prisma.acompanhamentoMissionGroup.create({ data: { name: `Horas ${suffix}`,
    members: { create: { projectId: project.id, activeProjectId: project.id, order: 0 } } } });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `/api/acompanhamento/comercial/projetos/${project.id}`;
  const request = async (path, body, user = 0, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${base}${path}`, {
      method, headers: { authorization: `Bearer ${tokens[user]}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    return { status: response.status, data };
  };
  const scope = async () => { const r = await request('/escopo-previsto'); assert.equal(r.status, 200); return r.data; };
  const raw = (normal, extra = 0) => ({ hh_total: normal + extra, hh_util_diurno: normal, hh_util_noturno: 0,
    hh_util_extra_diurno: extra, hh_util_extra_noturno: 0, hh_sab_diurno: 0, hh_sab_noturno: 0, hh_dom_diurno: 0, hh_dom_noturno: 0 });
  const importHours = async value => {
    await prisma.commercialProposal.update({ where: { codBd: code }, data: { rawRow: value } });
    // Espelha a rota de importação comercial, que invalida os derivados após atualizar o staging.
    clearProjectDerivedCaches();
  };
  const verifyViews = async (total, pending) => {
    const detail = await getProjectDetail(project.id);
    const card = (await listProjectCards()).find(c => c.projectId === project.id);
    for (const view of [detail, card]) {
      assert.equal(view.workedHours.plannedTotalHours, total);
      assert.equal(view.alerts.some(a => a.code === 'HORAS_PREVISTAS'), pending);
    }
    const grouped = await getMissionGroupDetail(group.id);
    assert.equal(grouped.workedHours.plannedTotalHours, total);
    assert.equal(grouped.alerts.some(a => a.code === 'HORAS_PREVISTAS'), pending);
  };

  let current = await scope();
  assert.equal(current.hoursPlan.source, 'NONE');
  assert.equal((await request('/escopo-previsto', { services: [], normalHours: [{ hours: 200 }], overtime: [{ hours: 20 }],
    hoursFingerprint: current.hoursPlan.fingerprint }, 0, 'PUT')).status, 200);
  current = await scope();
  assert.equal(current.hoursPlan.source, 'MANUAL');
  await verifyViews(220, false);
  await importHours(raw(100, 20));
  const pending = await scope();
  assert.equal(pending.hoursPlan.pending, true);
  await verifyViews(220, true);
  const body = { choice: 'COMMERCIAL', fingerprint: pending.hoursPlan.fingerprint };
  assert.equal((await request('/horas-previstas/resolver', body, 1)).status, 403);
  assert.equal((await request('/horas-previstas/resolver', { ...body, fingerprint: current.hoursPlan.fingerprint })).status, 409);
  assert.equal((await request('/horas-previstas/resolver', body)).status, 200);
  current = await scope();
  assert.equal(current.hoursPlan.source, 'COMMERCIAL');
  assert.equal(current.hoursPlan.pending, false);
  assert.equal((await prisma.projectPlannedNormalHours.findFirst({ where: { projectId: project.id } })).hours.toNumber(), 200);
  assert.equal((await prisma.project.findUnique({ where: { id: project.id } })).plannedHoursResolution.resolvedByUserId, users[0].id);
  await verifyViews(120, false);
  assert.equal((await request('/horas-previstas/resolver', body)).status, 409, 'old decisions cannot overwrite a newer decision');
  assert.equal((await request('/escopo-previsto', { services: [], normalHours: [{ hours: 999 }] }, 0, 'PUT')).status, 409);
  assert.equal((await request('/escopo-previsto', { services: [], hoursFingerprint: current.hoursPlan.fingerprint }, 0, 'PUT')).status, 200);
  assert.equal((await scope()).hoursPlan.pending, false, 'saving services cannot turn automatic hours into manual hours');

  await importHours(raw(110, 20));
  current = await scope();
  assert.equal(current.hoursPlan.pending, true);
  assert.equal((await request('/horas-previstas/resolver', { choice: 'MANUAL', fingerprint: current.hoursPlan.fingerprint })).status, 200);
  await verifyViews(220, false);
  const decision = await scope();
  assert.equal(decision.hoursPlan.decision, 'MANUAL');
  assert.equal((await request('/escopo-previsto', { services: [], normalHours: [{ hours: 250 }], overtime: [{ hours: 20 }],
    hoursFingerprint: decision.hoursPlan.fingerprint }, 0, 'PUT')).status, 200);
  assert.equal((await scope()).hoursPlan.pending, true, 'changing confirmed manual values requires another review');

  // Exact selected revision + selected additional: not the largest revision in the database.
  proposals.push(await prisma.commercialProposal.create({ data: { codBd: code + 1, codProp: code, nRev: 9, rawRow: raw(999) } }));
  proposals.push(await prisma.commercialProposal.create({ data: { codBd: code + 2, codProp: code + 2, rawRow: raw(50, 10) } }));
  await prisma.projectAdditionalProposal.create({ data: { projectId: project.id, codProp: code + 2, sourceProposalCodBd: code + 2 } });
  current = await scope();
  assert.equal(current.hoursPlan.commercial.total, 190);
  const stale = current.hoursPlan.fingerprint;
  await prisma.projectAdditionalProposal.deleteMany({ where: { projectId: project.id } });
  assert.equal((await request('/horas-previstas/resolver', { choice: 'COMMERCIAL', fingerprint: stale })).status, 409);
  await importHours({});
  assert.equal((await scope()).hoursPlan.source, 'MANUAL');
  await prisma.projectPlannedNormalHours.deleteMany({ where: { projectId: project.id } });
  await prisma.projectPlannedOvertime.deleteMany({ where: { projectId: project.id } });
  await importHours(raw(80, 10));
  current = await scope();
  assert.equal(current.hoursPlan.source, 'COMMERCIAL');
  assert.equal(current.hoursPlan.pending, false);
  await verifyViews(90, false);
});
