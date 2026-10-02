import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildWeeklyProgressComparison } from '../../shared/modules/mission-weekly-progress.js';

const databaseUrl = process.env.PROPOSAL_PERCENTAGE_TEST_DATABASE_URL;
test('PostgreSQL: metas físicas, exclusão, recriação e gravações concorrentes mantêm revisões consistentes', {
  skip: !databaseUrl
}, async t => {
  const url = new URL(databaseUrl);
  assert.match(url.hostname, /^(localhost|127\.0\.0\.1)$/);
  assert.ok(url.pathname.endsWith('_test') || (process.env.CI === 'true' && url.pathname === '/filtrovali'));
  process.env.DATABASE_URL = url.toString();
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { saveWeeklyProgressTarget, deleteWeeklyProgressTarget, listWeeklyProgressTargets } = await import('../src/lib/acompanhamento/weekly-progress-targets.js');
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: { username: `weekly-${suffix}`, name: 'Gestora', passwordHash: 'test-only', role: 'MANAGER' } });
  let project;
  t.after(async () => {
    if (project) await prisma.project.delete({ where: { id: project.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  });
  project = await prisma.project.create({ data: { code: `weekly-${suffix}`, name: 'Meta teste', clientName: '', clientCnpj: '', contractCode: '', location: '' } });
  const owner = { projectId: project.id };
  const actor = { userId: user.id, userName: user.name };
  const input = { weekStartDate: '2026-09-28', expectedRevision: 0, definition: { metric: 'L', basis: 'PER_PRODUCTIVE_DAY', referenceDayHours: 9,
    scenarios: [{ name: 'Filtragem', condition: { kind: 'ALWAYS' }, goals: [{ serviceType: 'FILTRAGEM', value: 1000 }] }] } };
  const saved = await saveWeeklyProgressTarget(owner, input, actor);
  assert.deepEqual(saved.definition, input.definition);
  // JSONB pode reordenar as chaves sem alterar a regra cadastrada.
  assert.equal((await saveWeeklyProgressTarget(owner, { ...input, expectedRevision: 1 }, actor)).revision, 1);
  const removed = await deleteWeeklyProgressTarget(owner, { weekStartDate: input.weekStartDate, expectedRevision: 1 }, actor);
  assert.equal(removed.isDeleted, true);
  const targets = await listWeeklyProgressTargets(owner);
  assert.equal(targets.length, 2);
  assert.equal(buildWeeklyProgressComparison({ targets, today: '2026-10-02' })[0].status, 'NO_TARGET');
  assert.equal((await saveWeeklyProgressTarget(owner, { weekStartDate: input.weekStartDate, plannedPctPoints: 0, expectedRevision: 2 }, actor)).revision, 3);
  const writes = await Promise.allSettled([
    deleteWeeklyProgressTarget(owner, { weekStartDate: input.weekStartDate, expectedRevision: 3 }, actor),
    saveWeeklyProgressTarget(owner, { weekStartDate: input.weekStartDate, plannedPctPoints: 20, expectedRevision: 3 }, actor)
  ]);
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(writes.find(result => result.status === 'rejected').reason.status, 409);
  assert.deepEqual((await listWeeklyProgressTargets(owner)).map(row => row.revision), [4, 3, 2, 1]);
  const raw = { ...owner, weekStartDate: new Date(`${input.weekStartDate}T00:00:00Z`), createdByName: user.name };
  for (const invalid of [
    { plannedPctPoints: null },
    { isDeleted: true, plannedPctPoints: 10 },
    { isDeleted: true, definition: {} },
    { plannedPctPoints: 101 },
    { definition: [] },
    { definition: input.definition, plannedPctPoints: 10 }
  ]) await assert.rejects(prisma.missionWeeklyProgressTarget.create({ data: { ...raw, revision: 5, ...invalid } }));
  assert.equal((await listWeeklyProgressTargets(owner)).length, 4);
});
