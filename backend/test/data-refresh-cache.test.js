import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma.js';
import jobRolesRouter from '../src/routes/resources/job-roles.js';
import collaboratorsRouter from '../src/routes/resources/collaborators.js';
import { collaboratorsCache, projectCardsCache, commercialDashboardCache, laborCostCache, statisticsProjectsCache, clearCollaboratorDerivedCaches } from '../src/lib/resource-list-cache.js';
import { runPlanningTransaction } from '../src/lib/efetivo/planning/plan-context.js';

async function prime() {
  clearCollaboratorDerivedCaches();
  await collaboratorsCache.get(async () => 'old');
  for (const cache of [projectCardsCache, commercialDashboardCache, laborCostCache, statisticsProjectsCache]) await cache.get('any', async () => 'old');
}
async function assertFresh(expected) {
  assert.equal(await collaboratorsCache.get(async () => 'new'), expected);
  for (const cache of [projectCardsCache, commercialDashboardCache, laborCostCache, statisticsProjectsCache]) assert.equal(await cache.get('any', async () => 'new'), expected);
}
function handler(router, method, path) { return router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle; }
function callRoute(fn, req) {
  return new Promise((resolve, reject) => {
    const res = { status() { return this; }, json(value) { resolve(value); }, end() { resolve(); } };
    fn(req, res, reject);
  });
}

test('commit de planejamento invalida cadastro e painéis somente após concluir a transação', async () => {
  await prime();
  const result = await runPlanningTransaction({ $transaction: async callback => { await assertFresh('old'); return callback({}); } }, async () => 'saved');
  assert.equal(result, 'saved'); await assertFresh('new');
});

test('falha transacional conserva o cache da versão ainda vigente', async () => {
  await prime();
  await assert.rejects(runPlanningTransaction({ $transaction: async () => { throw new Error('rollback'); } }, async () => 'saved'), /rollback/);
  await assertFresh('old');
});

test('alterar o nome de um cargo invalida o cadastro com cargo embutido e os custos', async () => {
  const original = prisma.jobRole.update;
  prisma.jobRole.update = async ({ data }) => ({ id: 'role', ...data });
  try {
    await prime();
    await callRoute(handler(jobRolesRouter, 'patch', '/:id'), { params: { id: 'role' }, body: { name: 'Novo cargo' } });
    await assertFresh('new');
  } finally { prisma.jobRole.update = original; }
});

test('desativar colaborador invalida os cards e estatísticas além da lista principal', async () => {
  const original = prisma.collaborator.update;
  prisma.collaborator.update = async () => ({ id: 'c1', isActive: false });
  try {
    await prime();
    await callRoute(handler(collaboratorsRouter, 'delete', '/:id'), { params: { id: 'c1' } });
    await assertFresh('new');
  } finally { prisma.collaborator.update = original; }
});
