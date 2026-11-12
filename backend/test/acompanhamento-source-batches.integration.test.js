import assert from 'node:assert/strict';
import test from 'node:test';
import { seedHttpPerformanceFixture } from '../scripts/fixtures/http-performance.js';
import { assertLocalPerformanceDatabase } from '../scripts/lib/http-performance-report.js';

test('PostgreSQL: planned-hour batches preserve native rows, decimals, dates and protected parents', {
  skip: !process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL
}, async t => {
  assertLocalPerformanceDatabase(process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL);
  process.env.DATABASE_URL = process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL;
  const { default: db } = await import('../src/lib/prisma.js');
  const { loadPlannedHourProjects } = await import('../src/lib/acompanhamento/planned-hour-sources.js');
  const { withProjectAccess, withProjectChannel } = await import('../src/lib/projects/access-scope.js');
  let fixture;
  t.after(async () => { if (fixture) await fixture.cleanup(); await db.$disconnect(); });
  fixture = await seedHttpPerformanceFixture(db, { reportCount: 10, scopeCount: 1 });
  await db.projectPlannedNormalHours.createMany({ data: [
    { projectId: fixture.projectId, jobRoleId: fixture.prefix + '-role', hours: '99999999.99', order: 2,
      createdAt: new Date('2026-09-01T12:34:56.789Z') },
    { projectId: fixture.projectId, roleName: 'Histórico', hours: '.01', order: 1 },
    { projectId: fixture.projectIds[2], roleName: 'Restrito', hours: '1.25' }
  ] });
  await db.projectPlannedOvertime.create({ data: { projectId: fixture.projectId, jobRoleId: fixture.prefix + '-role',
    roleName: 'Cargo nominal', hours: '-1.25', note: 'Sintético' } });
  await db.projectBudget.create({ data: { projectId: fixture.projectId, version: 2 } });
  for (const [index, active] of [true, false].entries()) await db.projectAdditionalProposal.create({ data: {
    id: fixture.prefix + '-addition-' + index, projectId: fixture.projectId, sourceProposalCodBd: 900000001 + index,
    codProp: 900000001 + index, proposalCode: String(900000001 + index), active,
    metricInclusion: { hours: false }, updatedAt: new Date()
  } });
  const native = () => db.project.findMany({
    where: { id: { in: fixture.projectIds }, deletedAt: null },
    select: { id: true, plannedHoursResolution: true, proposalPercentage: true,
      plannedNormalHours: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }], include: { jobRole: { select: { name: true } } } },
      plannedOvertime: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }], include: { jobRole: { select: { name: true } } } },
      budgets: { where: { version: 1 }, select: { source: true, sourceProposalCodBd: true, commercialAppProposalId: true } },
      additionalProposals: { where: { active: true }, select: { source: true, sourceProposalCodBd: true,
        commercialAppProposalId: true, metricInclusion: true } }
    }
  });
  for (const accountType of ['ADMIN', 'INTERNAL']) for (const channel of ['app', 'acompanhamento']) {
    await withProjectAccess({ accountType }, () => withProjectChannel(channel, async () => {
      const expected = await native(), actual = await loadPlannedHourProjects(db, fixture.projectIds);
      assert.deepEqual(actual, expected);
      assert.equal(actual.some(row => row.id === fixture.projectIds[2]), accountType === 'ADMIN' && channel === 'acompanhamento');
      const normal = actual.find(row => row.id === fixture.projectId).plannedNormalHours;
      assert.equal(normal[1].hours.toFixed(2), '99999999.99');
      assert.equal(normal[1].createdAt.toISOString(), '2026-09-01T12:34:56.789Z');
    }));
  }
  await db.jobRole.update({ where: { id: fixture.prefix + '-role' }, data: { name: 'Cargo atualizado' } });
  assert.deepEqual(await loadPlannedHourProjects(db, fixture.projectIds), await native());
  await db.project.update({ where: { id: fixture.projectId }, data: { deletedAt: new Date() } });
  assert.deepEqual(await loadPlannedHourProjects(db, [fixture.projectId]), []);
  const rollback = new Error('Rollback sintético');
  await assert.rejects(db.$transaction(async tx => {
    await tx.projectPlannedOvertime.create({ data: { projectId: fixture.projectIds[1], hours: '2.25', roleName: 'Transação' } });
    const own = await loadPlannedHourProjects(tx, [fixture.projectIds[1]]);
    const outside = await loadPlannedHourProjects(db, [fixture.projectIds[1]]);
    assert.equal(own[0].plannedOvertime[0].hours.toFixed(2), '2.25');
    assert.deepEqual(outside[0].plannedOvertime, [], 'O cliente externo não lê alterações sem commit');
    throw rollback;
  }), error => error === rollback);
});

test('PostgreSQL: import scope preserves native scalar types, ordering and missing identities', {
  skip: !process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL
}, async t => {
  assertLocalPerformanceDatabase(process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL);
  process.env.DATABASE_URL = process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL;
  const { default: db } = await import('../src/lib/prisma.js');
  const { getPontoImportScope } = await import('../src/lib/acompanhamento/labor-cost.js');
  let fixture;
  t.after(async () => {
    if (fixture) {
      await db.pontoImport.deleteMany({ where: { id: fixture.prefix + '-new-import' } });
      await fixture.cleanup();
    }
    await db.$disconnect();
  });
  assert.equal(await getPontoImportScope(null, db), null);
  fixture = await seedHttpPerformanceFixture(db, { reportCount: 10, scopeCount: 1 });
  const selected = await db.pontoImport.findUnique({ where: { id: fixture.importId } });
  assert.deepEqual((await getPontoImportScope(fixture.importId, db)).pontoImport, selected);
  const latest = await db.pontoImport.create({ data: { id: fixture.prefix + '-new-import', fileName: 'Sintético',
    contentHash: 'hash-sintético', source: 'TEST', periodStart: new Date('2025-12-01'), periodEnd: new Date('2027-01-31'),
    createdAt: new Date(selected.createdAt.getTime() + 1234), importedByUserId: fixture.prefix + '-admin',
    summary: { nested: [1, true, null] } } });
  const scope = await getPontoImportScope(null, db);
  assert.deepEqual(scope.pontoImports, await db.pontoImport.findMany({ orderBy: { createdAt: 'asc' } }));
  assert.deepEqual(scope.pontoImport, latest);
  assert.equal(scope.periodStart.toISOString(), '2025-12-01T00:00:00.000Z');
  assert.equal(scope.periodEnd.toISOString(), '2027-01-31T00:00:00.000Z');
  assert.equal(scope.fileName, '2 planilhas importadas');
  assert.equal(await getPontoImportScope("missing' OR true --", db), null);
});

test('PostgreSQL: monthly decisions retain native visibility, confirmed precedence and date bounds', {
  skip: !process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL
}, async t => {
  assertLocalPerformanceDatabase(process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL);
  process.env.DATABASE_URL = process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL;
  const { default: db } = await import('../src/lib/prisma.js');
  const { loadLaborDayDecisions } = await import('../src/lib/acompanhamento/labor-day-decisions.js');
  const { loadConfirmedReviewDays } = await import('../src/lib/efetivo/allocation-review/confirmed-days.js');
  const { manualProjectsByCollaborator } = await import('../src/lib/acompanhamento/labor-cost.js');
  const { withProjectAccess, withProjectChannel } = await import('../src/lib/projects/access-scope.js');
  let fixture;
  t.after(async () => {
    if (fixture) {
      await db.allocationReviewWeek.deleteMany({ where: { id: fixture.prefix + '-decisions-week' } });
      await db.pontoDayProjectOverride.deleteMany({ where: { collaboratorId: fixture.prefix + '-person-0' } });
      await fixture.cleanup();
    }
    await db.$disconnect();
  });
  fixture = await seedHttpPerformanceFixture(db, { reportCount: 10, scopeCount: 1 });
  const person = fixture.prefix + '-person-0';
  await db.pontoDayProjectOverride.createMany({ data: [
    { collaboratorId: person, workDate: new Date('2026-09-07'), projectId: fixture.projectIds[0] },
    { collaboratorId: person, workDate: new Date('2026-09-07'), projectId: fixture.projectIds[2] },
    { collaboratorId: person, workDate: new Date('2026-10-01'), projectId: fixture.projectIds[0] }
  ] });
  await db.allocationReviewWeek.create({ data: { id: fixture.prefix + '-decisions-week', weekStart: new Date('2026-09-07'),
    rows: { create: [
      { collaboratorId: person, confirmedAt: new Date(), days: { create: [
        { collaboratorId: person, workDate: new Date('2026-09-07'), kind: 'TRAVEL', projects: { create: [
          { projectId: fixture.projectIds[2] }, { projectId: fixture.projectIds[1] }
        ] } },
        { collaboratorId: person, workDate: new Date('2026-09-08'), kind: 'SEDE' }
      ] } },
      { collaboratorId: fixture.prefix + '-person-1', days: { create: {
        collaboratorId: fixture.prefix + '-person-1', workDate: new Date('2026-09-09'), kind: 'PROJECT',
        projects: { create: { projectId: fixture.projectId } }
      } } }
    ] }
  } });
  const from = new Date('2026-09-01'), to = new Date('2026-10-01');
  for (const accountType of ['ADMIN', 'INTERNAL']) for (const channel of ['app', 'acompanhamento']) {
    await withProjectAccess({ accountType }, () => withProjectChannel(channel, async () => {
      const expectedOverrides = await db.pontoDayProjectOverride.findMany({ where: { workDate: { gte: from, lt: to } },
        select: { collaboratorId: true, workDate: true, projectId: true } });
      const expectedReviews = await loadConfirmedReviewDays({ from, to }, db);
      const actual = await loadLaborDayDecisions(db, { from, to, projects: await db.project.findMany({ select: { id: true } }) });
      assert.deepEqual(actual.manualDayOverrides, expectedOverrides);
      assert.deepEqual(actual.confirmedReviewDays, expectedReviews);
      assert.equal(actual.confirmedReviewDays.length, 2, 'Rascunhos não influenciam o custo');
      assert.deepEqual(manualProjectsByCollaborator(actual.manualDayOverrides, actual.confirmedReviewDays),
        manualProjectsByCollaborator(expectedOverrides, expectedReviews));
    }));
  }
});

test('PostgreSQL: monthly point sources preload only matching absence identities and dates', {
  skip: !process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL
}, async t => {
  assertLocalPerformanceDatabase(process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL);
  process.env.DATABASE_URL = process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL;
  const { default: db } = await import('../src/lib/prisma.js');
  const { loadMonthlyPontoSources } = await import('../src/lib/acompanhamento/ponto-period-sources.js');
  let fixture;
  t.after(async () => {
    if (fixture) {
      await db.collaborator.deleteMany({ where: { id: fixture.prefix + '-unimported' } });
      await fixture.cleanup();
    }
    await db.$disconnect();
  });
  fixture = await seedHttpPerformanceFixture(db, { reportCount: 10, scopeCount: 1 });
  await db.collaborator.create({ data: { id: fixture.prefix + '-unimported', code: fixture.prefix + '-unimported',
    name: 'Fora do ponto', jobRoleId: fixture.prefix + '-role' } });
  await db.collaboratorAbsence.createMany({ data: [
    { collaboratorId: fixture.prefix + '-person-0', startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30'), note: 'Não selecionar esta observação' },
    { collaboratorId: fixture.prefix + '-person-1', startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') },
    { collaboratorId: fixture.prefix + '-person-2', startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30'), deletedAt: new Date() },
    { collaboratorId: fixture.prefix + '-unimported', startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30') }
  ] });
  const sources = await loadMonthlyPontoSources(db, [fixture.importId], { startDate: '2026-09-01', endDate: '2026-09-30' });
  const native = await db.collaboratorAbsence.findMany({ where: {
    collaboratorId: { in: sources.periods.map(row => row.collaboratorId) }, deletedAt: null,
    startDate: { lte: new Date('2026-09-30') }, endDate: { gte: new Date('2026-09-01') }
  }, select: { id: true, collaboratorId: true, startDate: true, endDate: true } });
  assert.deepEqual(sources.absences, native);
  assert.equal(sources.absences.length, 1);
  assert.deepEqual(Object.keys(sources.absences[0]).sort(), ['collaboratorId', 'endDate', 'id', 'startDate']);
});
