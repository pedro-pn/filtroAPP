import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import { computeDivisionProgressDetails, computeProgressDetailsForProjects, computeProgressForProjects,
  computeProgressHistoryForProjects } from '../src/lib/acompanhamento/avanco.js';
import prisma from '../src/lib/prisma.js';
import app from '../src/app.js';

test('HTTP + PostgreSQL: cronograma salva o modelo e todas as projeções acompanham dias e equipes', { timeout: 120_000 }, async t => {
  const database = await apiSimulationDatabase();
  const client = database.client;
  t.after(() => database.close());
  await database.db.exec('ALTER TABLE "Project" DROP COLUMN "progressModel", DROP COLUMN "plannedCollaborators";');
  await database.db.exec(await readFile(new URL('../prisma/migrations/20261116120000_worked_days_progress/migration.sql', import.meta.url), 'utf8'));

  const stub = (target, method, implementation) => {
    const previous = target[method]; target[method] = implementation;
    t.after(() => { target[method] = previous; });
  };
  for (const model of ['user', 'userSession', 'project', 'projectBudget', 'commercialProposal', 'projectAdditionalProposal',
    'report', 'reportService', 'reportCollaborator', 'collaborator', 'projectPlannedService',
    'projectRealizedCorrection', 'projectManualProgressHistory', 'historicalServiceReport']) {
    for (const method of ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findMany', 'update', 'count', 'aggregate']) {
      stub(prisma[model], method, (...args) => client[model][method](...args));
    }
  }
  stub(prisma, '$transaction', (...args) => client.$transaction(...args));
  const user = await client.user.create({ data: { username: 'worked-days', name: 'Teste', passwordHash: 'synthetic',
    role: 'COLLABORATOR', accountType: 'INTERNAL',
    moduleRoles: { create: { module: 'ACOMPANHAMENTO', role: 'ACOMPANHAMENTO_MANAGER' } } } });
  await client.userSession.create({ data: { userId: user.id, tokenHash: createHash('sha256').update('worked-days').digest('hex'),
    expiresAt: new Date(Date.now() + 600_000) } });
  const project = await client.project.create({ data: { code: '6200', name: 'Dias trabalhados', clientName: 'Teste', clientCnpj: '',
    contractCode: '6200', location: '', startDate: new Date('2026-09-01'), manualProgressPct: 77,
    budgets: { create: { sourceProposalCodBd: 6200, plannedDays: 12 } },
    additionalProposals: { create: { codProp: 6201, sourceProposalCodBd: 6201, metricInclusion: { workedDays: false } } },
    plannedServices: { create: { serviceType: 'FLUSHING', weight: 100,
      systems: { create: { systemType: 'OLEO', unit: 'L', quantity: 100 } } } }
  } });
  await client.commercialProposal.createMany({ data: [
    { codBd: 6200, codProp: 6200, plannedDays: 12, workedDays: 10, rawRow: {} },
    { codBd: 6201, codProp: 6201, parentCodProp: 6200, plannedDays: 5, workedDays: 4, rawRow: {} }
  ] });
  const role = await client.jobRole.create({ data: { name: 'Operador', normalizedKey: 'operador' } });
  for (const id of ['a', 'b', 'c', 'd']) await client.collaborator.create({ data: { id, code: id, name: id, jobRoleId: role.id } });
  const createRdo = (id, day, ids, extra = {}) => client.report.create({ data: {
    id, projectId: project.id, reportType: 'RDO', reportDate: new Date(`2026-09-${day}`),
    arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: ids.length,
    collaborators: { create: ids.map(collaboratorId => ({ collaboratorId })) }, ...extra
  } });
  await createRdo('rdo-a', '01', ['a', 'b'], { specialConditions: { noturnoDetails: { collaboratorIds: ['b', 'c'] } },
    services: { create: [{ serviceType: 'FLUSHING', finalized: false }, { serviceType: 'FLUSHING', finalized: false }] } });
  await createRdo('rdo-b', '02', ['a']); // sem serviços também conta
  await createRdo('deleted', '03', ['a', 'b', 'c', 'd'], { deletedAt: new Date() });
  await createRdo('derived', '03', ['a', 'b'], { reportType: 'RLF', specialConditions: { parentRdoId: 'rdo-a' } });

  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (suffix, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/acompanhamento/comercial/projetos/${project.id}${suffix}`, {
      method: body ? 'PATCH' : 'GET', headers: { authorization: 'Bearer worked-days', 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, data: await response.json() };
  };
  const save = body => request('/cronograma', body);
  assert.equal((await save({ progressModel: 'WORKED_DAYS' })).status, 400);
  for (const value of [0, -1, 1.5, '2', null]) {
    assert.equal((await save({ progressModel: 'WORKED_DAYS', plannedCollaborators: value })).status, 400);
  }
  assert.equal((await save({ progressModel: 'INVALID', plannedCollaborators: 4 })).status, 400);
  const saved = await save({ progressModel: 'WORKED_DAYS', plannedCollaborators: 4 });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const revisions = await request('/revisoes');
  assert.equal(revisions.status, 200, JSON.stringify(revisions.data));
  assert.equal(revisions.data.progressModel, 'WORKED_DAYS');
  assert.equal(revisions.data.plannedCollaborators, 4);
  assert.equal((await save({ plannedCollaborators: null })).status, 400);
  const full = async () => (await computeProgressDetailsForProjects([project.id], { database: client, includeRevision: true })).get(project.id);
  const before = await full();
  assert.equal(before.progress.progressPct, 10); // (3 + 1) / (10 × 4)
  assert.deepEqual(before.dailyProgressHistory.map(point => point.progressPct), [7.5, 10]);
  assert.equal(before.progress.progressMethod, 'WORKED_DAYS');
  const current = (await computeProgressDetailsForProjects([project.id], { database: client, currentOnly: true, includeRevision: true })).get(project.id);
  assert.deepEqual(current.progress, before.progress);
  assert.equal(current.progressRevision, before.progressRevision);
  assert.deepEqual(current.progressHistory, []);
  assert.deepEqual((await computeProgressForProjects([project.id], { database: client })).get(project.id), before.progress);
  assert.deepEqual((await computeProgressHistoryForProjects([project.id], { daily: true })).get(project.id), before.dailyProgressHistory);
  assert.deepEqual((await computeProgressHistoryForProjects([project.id])).get(project.id), before.progressHistory);

  assert.equal((await save({ forceManualProgress: true, manualProgressPct: 0 })).status, 200);
  const forced = await full();
  assert.equal(forced.progress.progressMethod, 'MANUAL');
  assert.equal(forced.progress.progressPct, 0);
  assert.equal(forced.progress.workedDays.realizedPersonDays, 4, 'preserva a medição automática para consulta');
  assert.ok(forced.dailyProgressHistory.every(point => point.progressPct === 0));
  assert.notEqual(forced.progressRevision, before.progressRevision);
  assert.deepEqual((await computeProgressForProjects([project.id], { database: client })).get(project.id), forced.progress);
  assert.deepEqual((await computeProgressHistoryForProjects([project.id], { daily: true })).get(project.id), forced.dailyProgressHistory);
  assert.equal((await save({ forceManualProgress: false })).status, 200);
  assert.deepEqual((await full()).progress, before.progress, 'retoma o cálculo proporcional por dias');

  await client.reportCollaborator.create({ data: { reportId: 'rdo-b', collaboratorId: 'd' } });
  const changedRoster = await full();
  assert.equal(changedRoster.progress.progressPct, 12.5);
  assert.notEqual(changedRoster.progressRevision, before.progressRevision);
  await client.projectAdditionalProposal.updateMany({ data: { metricInclusion: {} } });
  assert.equal((await full()).progress.workedDays.plannedDays, 14);
  assert.equal((await save({ proposalPercentage: 50 })).status, 200);
  assert.equal((await full()).progress.workedDays.plannedDays, 7);
  await client.commercialProposal.create({ data: { codBd: 6202, codProp: 6200, nRev: 2, plannedDays: 12, workedDays: 6, rawRow: {} } });
  await client.projectBudget.updateMany({ data: { sourceProposalCodBd: 6202 } });
  assert.equal((await full()).progress.workedDays.plannedDays, 5);
  assert.equal((await save({ plannedCollaborators: 2 })).status, 200);
  assert.equal((await full()).progress.progressPct, 50); // 5 / (5 × 2)
  const division = await computeDivisionProgressDetails(project.id, {
    key: '["DATE","semana",null]', startDate: '2026-09-02', endDate: '2026-09-08', plannedDays: 4
  }, { database: client, includeRevision: true });
  assert.equal(division.progress.progressPct, 50); // 2 / ((4 × 50%) × 2)
  await client.commercialProposal.updateMany({ data: { workedDays: null } });
  assert.equal((await full()).progress.workedDays.plannedDays, 8.5, 'sem dias de trabalho, usa os dias previstos como o acompanhamento');
  assert.equal((await save({ proposalPercentage: 0 })).status, 200);
  assert.equal((await full()).progress.progressPct, null, 'sem divisão por zero nem fallback manual');
  assert.equal((await save({ progressModel: 'QUANTITIES', plannedCollaborators: null, proposalPercentage: 100 })).status, 200);
  assert.equal((await full()).progress.progressMethod, 'RDO');
  assert.equal((await full()).progress.progressPct, 0);
});
