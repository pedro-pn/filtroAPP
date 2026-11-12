import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma.js';
import router, { gestorBootstrapData } from '../src/routes/resources/bootstrap.js';
import { collaboratorsCache } from '../src/lib/resource-list-cache.js';

function fixture(t) {
  const calls = [];
  collaboratorsCache.clear();
  for (const model of ['project', 'collaborator', 'satisfactionSurvey', 'clientSegment', 'satisfactionSurveyQuestion']) {
    const original = prisma[model].findMany;
    prisma[model].findMany = async options => { calls.push({ model, options }); return []; };
    t.after(() => { prisma[model].findMany = original; collaboratorsCache.clear(); });
  }
  const count = prisma.satisfactionSurveyQuestion.count;
  prisma.satisfactionSurveyQuestion.count = async () => 1;
  t.after(() => { prisma.satisfactionSurveyQuestion.count = count; });
  return calls;
}
const auth = { user: { id: 'manager', role: 'MANAGER', accountType: 'ADMIN' } };

for (const [section, expected] of [
  ['projetos', ['project', 'collaborator', 'clientSegment']],
  ['arquivados', ['project', 'clientSegment']],
  ['equipe', ['collaborator']],
  ['usuarios', ['project', 'project', 'collaborator']],
  ['nps', ['satisfactionSurvey', 'satisfactionSurveyQuestion']],
  ['relatorios', ['project', 'project', 'collaborator']]
]) test(`bootstrap ${section} consulta somente seus dados`, async t => {
  const calls = fixture(t);
  const data = await gestorBootstrapData(auth, section);
  assert.deepEqual(calls.map(call => call.model).sort(), expected.toSorted());
  assert.deepEqual(Object.keys(data).sort(), ['activeProjects', 'archivedProjects', 'collaborators', 'surveys', 'projectSegments', 'surveyQuestions'].sort());
  assert.ok(Object.values(data).every(Array.isArray));
  for (const call of calls.filter(call => call.model === 'project')) assert.equal(call.options.where.deletedAt, null);
  if (section === 'arquivados') assert.equal(calls.find(call => call.model === 'project').options.where.isActive, false);
});

test('bootstrap sem seção mantém o contrato completo dos consumidores anteriores', async t => {
  const calls = fixture(t);
  await gestorBootstrapData(auth);
  assert.deepEqual(calls.map(call => call.model).sort(), ['project', 'project', 'collaborator', 'satisfactionSurvey', 'clientSegment', 'satisfactionSurveyQuestion'].sort());
});

test('rota valida seção antes de consultar qualquer modelo', async t => {
  const calls = fixture(t);
  const handler = router.stack.find(layer => layer.route?.path === '/gestor').route.stack.at(-1).handle;
  await new Promise(resolve => handler({ auth, query: { section: 'invalid' } }, {}, error => {
    assert.equal(error.name, 'ZodError'); resolve();
  }));
  assert.deepEqual(calls, []);
});

test('projeção por seção conserva o recorte de visibilidade de quem consulta', async t => {
  const calls = fixture(t);
  await gestorBootstrapData({ user: { ...auth.user, accountType: 'INTERNAL' } }, 'projetos');
  assert.equal(calls.find(call => call.model === 'project').options.where.managerOnly, false);
});
