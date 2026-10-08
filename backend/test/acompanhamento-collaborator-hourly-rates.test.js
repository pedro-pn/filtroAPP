import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCollaboratorHourlyRates } from '../src/lib/acompanhamento/collaborator-hourly-rates.js';
import { buildRoleParamsResolver } from '../src/lib/acompanhamento/labor-cost.js';

const collaborator = { id: 'c1', name: 'Ana', jobRole: { id: 'op', name: 'Operador' } };
const params = {
  salarioBase: 1980, cargaHoraria: 220, diasUteis: 22, periculosidadePct: 0,
  produtividadePct: 0, transferenciaPct: 0.1, confinamentoPct: 0.2, fgtsPct: 0
};
const annualCosts = { epiAnnualCost: 2640, examsTrainingAnnualCost: 2640, offshoreExamsTrainingAnnualCost: 5280 };
const build = (overrides = {}) => buildCollaboratorHourlyRates({
  collaborator, referenceDate: '2026-09-30', roleParams: { paramsFor: () => params }, annualCosts, ...overrides
});
const amounts = result => Object.fromEntries(result.scenarios.map(row => [row.scenario, row.hourlyCost]));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`);

test('referências incluem provisões e custos anuais; horas extras cobram uma hora e seus reflexos', () => {
  const result = build();
  assert.equal(result.collaboratorId, 'c1');
  assert.equal(result.referenceDate, '2026-09-30');
  assert.equal(result.available, true);
  assert.equal(result.monthlyHours, 220);
  const rates = amounts(result);
  // Salário de R$ 1.980,00, provisões de 5/18 e custos anuais de R$ 440/mês.
  close(rates.normal, 13.5);
  // Hora de R$ 9,00, adicional 70%/100%, DSR 4/22 e provisões 5/18.
  close(rates.he70, 9 * 1.7 * (1 + 4 / 22) * (1 + 5 / 18));
  close(rates.he100, 9 * 2 * (1 + 4 / 22) * (1 + 5 / 18));
  close(rates.viagem, 14.65);
  close(rates.offshore, 16.8);
});

test('benefícios e custos anuais fixos não são cobrados novamente nas horas extras', () => {
  const baseline = amounts(build());
  const changed = amounts(build({
    roleParams: { paramsFor: () => ({ ...params, beneficios: { planoSaude: 220 } }) },
    annualCosts: { ...annualCosts, epiAnnualCost: 5280 }
  }));
  for (const scenario of ['normal', 'viagem', 'offshore']) close(changed[scenario] - baseline[scenario], 2);
  close(changed.he70, baseline.he70);
  close(changed.he100, baseline.he100);
});

test('resolve o cargo histórico e herda o modelo e salário vigentes na data consultada', () => {
  const roleParams = buildRoleParamsResolver({
    models: [{ key: 'operador', parameterSets: [{ effectiveDate: '2026-01-01', params }] }],
    roles: [
      { name: 'Auxiliar', costProfile: { parameterSets: [{ effectiveDate: '2026-01-01', params: { salarioBase: 990 } }] } },
      { name: 'Operador', costProfile: { parameterSets: [
        { effectiveDate: '2026-01-01', params: { salarioBase: 1980 } },
        { effectiveDate: '2026-09-15', params: { salarioBase: 3960 } }
      ] } }
    ]
  });
  const historicalCollaborator = { ...collaborator, jobRoleHistory: [
    { effectiveDate: '2026-01-01', jobRole: { id: 'aux', name: 'Auxiliar' } },
    { effectiveDate: '2026-09-01', jobRole: collaborator.jobRole }
  ] };
  const input = { collaborator: historicalCollaborator, roleParams };
  const before = build({ ...input, referenceDate: '2026-08-31' });
  assert.equal(before.role, 'Auxiliar');
  close(amounts(before).normal, 7.75);
  close(amounts(build({ ...input, referenceDate: '2026-09-14' })).normal, 13.5);
  close(amounts(build({ ...input, referenceDate: '2026-09-15' })).normal, 25);
});

test('sem cargo ou parâmetros vigentes, conserva cinco cenários sem inventar valores', () => {
  for (const input of [
    { roleParams: { paramsFor: () => null } },
    { roleParams: { paramsFor: () => ({ salarioBase: 0 }) } },
    { collaborator: { ...collaborator, jobRoleHistory: [{ effectiveDate: '2026-10-01', jobRole: collaborator.jobRole }] } }
  ]) {
    const result = build(input);
    assert.equal(result.available, false);
    assert.deepEqual(result.scenarios.map(row => row.scenario), ['normal', 'he70', 'he100', 'offshore', 'viagem']);
    assert.ok(result.scenarios.every(row => row.hourlyCost === null));
  }
});

test('API exige acesso ao Acompanhamento, valida a data e permite consulta pelo visualizador', async t => {
  const { default: express } = await import('express');
  const { default: router } = await import('../src/routes/resources/acompanhamento-custo.js');
  const { default: prisma } = await import('../src/lib/prisma.js');
  let user = { id: 'viewer', isActive: true, accountType: 'INTERNAL', role: 'COLLABORATOR', moduleRoles: ['acompanhamento:viewer'] };
  const calls = [];
  const originals = [];
  const stub = (model, method, implementation) => {
    originals.push([model, method, model[method]]);
    model[method] = implementation;
  };
  t.after(() => { for (const [model, method, original] of originals) model[method] = original; });
  stub(prisma.userSession, 'findUnique', async () => ({ id: 'session', expiresAt: new Date(Date.now() + 60000), user }));
  stub(prisma.collaborator, 'findUnique', async ({ where }) => {
    calls.push(where.id);
    return where.id === collaborator.id ? collaborator : null;
  });
  stub(prisma.jobRole, 'findMany', async () => [{
    name: 'Operador', costProfile: { parameterSets: [{ effectiveDate: '2026-01-01', params: { salarioBase: 1980 } }] }
  }]);
  stub(prisma.costProfile, 'findMany', async () => [{ key: 'operador', parameterSets: [{ effectiveDate: '2026-01-01', params }] }]);
  stub(prisma.acompanhamentoSetting, 'findUnique', async ({ where }) => ({ numberValue: annualCosts[where.key] }));
  const app = express();
  app.use(router);
  app.use((error, _req, res, _next) => res.status(error.name === 'ZodError' ? 400 : 500).json({ error: error.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, authenticated = true) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: authenticated ? { authorization: 'Bearer test-only' } : {}
    });
    return { status: response.status, body: await response.json() };
  };
  const path = '/colaboradores/c1/valor-hora?date=2026-09-30';
  assert.equal((await request(path, false)).status, 401);
  user = { ...user, moduleRoles: ['rdo:collaborator'] };
  assert.equal((await request(path)).status, 403);
  assert.deepEqual(calls, []);
  user = { ...user, moduleRoles: ['acompanhamento:viewer'] };
  assert.equal((await request('/colaboradores/c1/valor-hora?date=2026-02-30')).status, 400);
  assert.deepEqual(calls, []);
  const response = await request(path);
  assert.equal(response.status, 200);
  close(amounts(response.body).normal, 13.5);
  assert.equal(response.body.referenceDate, '2026-09-30');
  assert.equal((await request('/colaboradores/missing/valor-hora')).status, 404);
});
