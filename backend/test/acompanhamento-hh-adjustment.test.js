import assert from 'node:assert/strict';
import test from 'node:test';

import { computeMonthlyCost } from '../src/lib/acompanhamento/cost-engine.js';
import { buildRoleParamsResolver, buildCollaboratorRoleCostSegments, computeCollaboratorCost, effectiveCargoParameterSetAt } from '../src/lib/acompanhamento/labor-cost.js';
import { buildCollaboratorHourlyRates } from '../src/lib/acompanhamento/collaborator-hourly-rates.js';
import { estimateReportLaborCostByDate } from '../src/lib/acompanhamento/report-labor-cost.js';

const close = (actual, expected, eps = 1e-8) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≈ ${expected}`);
const params = { salarioBase: 2200, cargaHoraria: 220, diasUteis: 22, periculosidadePct: 0, fgtsPct: 0 };
const collaborator = { id: 'c1', name: 'Ana', jobRole: { id: 'op', name: 'Operador' } };
const set = (effectiveDate, version, values) => ({ effectiveDate, version, params: values });
const role = (id, name, parameterSets) => ({ id, name, isActive: true, costProfile: {
  id: `profile-${id}`, parameterSets
} });
const resolver = () => buildRoleParamsResolver({
  models: [{ key: 'operador', parameterSets: [set('2026-01-01', 1, params)] }],
  roles: [
    role('op', 'Operador', [
      set('2026-01-01', 1, { salarioBase: 2200 }),
      set('2026-11-15', 2, { salarioBase: 2200, reajusteHhPct: 0.1 }),
      set('2026-12-01', 3, { salarioBase: 2200, reajusteHhPct: 0 })
    ]),
    role('sup', 'Supervisor', [set('2026-01-01', 1, { salarioBase: 4400, reajusteHhPct: 0.1 })]),
    role('coord', 'Coordenador', [set('2026-01-01', 1, { salarioBase: 5500 })])
  ]
});

test('reajusta a hora de R$ 10 para R$ 11 antes de calcular HE70, HE100 e reflexos', () => {
  const configured = { ...params, reajusteHhPct: 0.1 };
  const original = structuredClone(configured);
  const base = computeMonthlyCost(params, { he70Horas: 1, he100Horas: 1 });
  const adjusted = computeMonthlyCost(configured, { he70Horas: 1, he100Horas: 1 });
  close(base.valorHora, 10);
  close(adjusted.valorHora, 11);
  close(adjusted.he70, 18.7);
  close(adjusted.he100, 22);
  close(adjusted.subtotalFixo, 2420);
  for (const field of ['dsr', 'remuneracaoBruta', 'provisoes', 'passivoRescisorio', 'totalMensal']) {
    close(adjusted[field], base[field] * 1.1);
  }
  assert.deepEqual(configured, original, 'não altera salário nem jornada cadastrados');
  assert.deepEqual(computeMonthlyCost(params), computeMonthlyCost({ ...params, reajusteHhPct: 0 }));
});

test('adicionais por modalidade e encargos recebem o reajuste uma vez; benefícios fixos conservam seu valor', () => {
  const model = { ...params, salarioMinimo: 1621, periculosidadePct: 0.3, produtividadePct: 0.15,
    transferenciaPct: 0.3, confinamentoPct: 0.4, fgtsPct: 0.08, beneficios: { planoSaude: 500 } };
  for (const inputs of [{ diasCasa: 22 }, { diasFora: 22 }, { offshoreDays: 22 }]) {
    const base = computeMonthlyCost(model, { ...inputs, he70Horas: 3, he100Horas: 2 });
    const adjusted = computeMonthlyCost({ ...model, reajusteHhPct: 0.1 }, { ...inputs, he70Horas: 3, he100Horas: 2 });
    for (const field of ['subtotalFixo', 'insalubridade', 'periculosidade', 'produtividade', 'transferencia',
      'confinamento', 'valorHora', 'he70', 'he100', 'dsr', 'fgts', 'ferias', 'decimoTerceiro', 'multaFgts']) {
      close(adjusted[field], base[field] * 1.1);
    }
    assert.equal(adjusted.beneficios, 500);
    close(adjusted.totalMensal - 500, (base.totalMensal - 500) * 1.1);
  }
});

test('vigência e cargo delimitam o reajuste e permitem encerrá-lo sem alterar períodos anteriores', () => {
  const roleParams = resolver();
  assert.equal(roleParams.paramsFor('Operador', '2026-11-14').reajusteHhPct, 0);
  assert.equal(roleParams.paramsFor('Operador', '2026-11-15').reajusteHhPct, 0.1);
  assert.equal(roleParams.paramsFor('Operador', '2026-12-01').reajusteHhPct, 0);
  assert.equal(roleParams.paramsFor('Supervisor', '2026-11-15').reajusteHhPct, 0.1);
  assert.equal(roleParams.paramsFor('Coordenador', '2026-11-15').reajusteHhPct, 0);
  const segments = buildCollaboratorRoleCostSegments({ collaborator, roleParams,
    startKey: '2026-11-01', endKey: '2026-12-31' });
  assert.deepEqual(segments.map(segment => [segment.startKey, segment.endKey, segment.params.reajusteHhPct]), [
    ['2026-11-01', '2026-11-14', 0], ['2026-11-15', '2026-11-30', 0.1], ['2026-12-01', '2026-12-31', 0]
  ]);
});

test('referências e RDO usam a vigência do reajuste e preservam custos anuais fixos', () => {
  const roleParams = resolver();
  const annualCosts = { epiAnnualCost: 2640, examsTrainingAnnualCost: 2640, offshoreExamsTrainingAnnualCost: 5280 };
  const rates = date => Object.fromEntries(buildCollaboratorHourlyRates({ collaborator, roleParams, annualCosts,
    referenceDate: date }).scenarios.map(row => [row.scenario, row.hourlyCost]));
  const before = rates('2026-11-14'), after = rates('2026-11-15');
  for (const scenario of ['normal', 'viagem', 'offshore']) {
    const fixed = scenario === 'offshore' ? 3 : 2;
    close(after[scenario] - fixed, (before[scenario] - fixed) * 1.1);
  }
  close(after.he70, before.he70 * 1.1);
  close(after.he100, before.he100 * 1.1);
  const costs = estimateReportLaborCostByDate({ collaborator, roleParams, annualCosts,
    workedMinutesByDate: new Map([['2026-11-14', 480], ['2026-11-15', 480]]) });
  close(costs.get('2026-11-15') - 16, (costs.get('2026-11-14') - 16) * 1.1);
});

test('salário futuro legado herda o reajuste até uma alteração explícita, com correções na mesma data', () => {
  const sets = [
    set('2026-01-01', 1, { salarioBase: 2200 }),
    set('2026-12-01', 2, { salarioBase: 3300 }),
    set('2026-11-15', 3, { salarioBase: 2200, reajusteHhPct: 0.1 }),
    set('2026-11-15', 4, { salarioBase: 2200, reajusteHhPct: 0.15 }),
    set('2027-01-01', 5, { salarioBase: 3300, reajusteHhPct: 0 })
  ];
  assert.deepEqual(effectiveCargoParameterSetAt(sets, '2026-12-01').params, { salarioBase: 3300, reajusteHhPct: 0.15 });
  assert.equal(effectiveCargoParameterSetAt(sets, '2026-11-14').params.reajusteHhPct, 0);
  assert.equal(effectiveCargoParameterSetAt(sets, '2027-01-01').params.reajusteHhPct, 0);
});

test('custo normal, HE e rateio por projeto refletem o reajuste e conciliam com sede e folga', () => {
  const inputs = { params: { ...params, salarioMinimo: 1621, periculosidadePct: 0.3,
    produtividadePct: 0.15, beneficios: { planoSaude: 500 } }, epiMensal: 100, examsTrainingMensal: 100,
  normalHours: 176, he70Horas: 3, he100Horas: 2, folgaHours: 8.8,
  projects: [{ pid: 'A', rdoDaysHours: 88, homeDaysHours: 88, rdoWorkedHours: 88 }]
  };
  const before = computeCollaboratorCost(inputs);
  const after = computeCollaboratorCost({ ...inputs, params: { ...inputs.params, reajusteHhPct: 0.1 } });
  close(after.folha - 700, (before.folha - 700) * 1.1, 0.02);
  const fixedProject = 700 * (88 + 5) / before.totalHours;
  close(after.byProject.A.cost - fixedProject, (before.byProject.A.cost - fixedProject) * 1.1, 0.02);
  close(after.folha, after.byProject.A.cost + after.idle.sede.cost + after.idle.folga.cost);
  assert.equal(after.totalHours, before.totalHours);
  assert.ok(after.fixoMensal > before.fixoMensal, 'também reajusta custo normal sem HE');
});

test('API salva reajustes individuais e em lote com validação, seleção explícita e histórico', async t => {
  const { default: express } = await import('express');
  const { default: router } = await import('../src/routes/resources/acompanhamento-custo.js');
  const { default: prisma } = await import('../src/lib/prisma.js');
  let user = { id: 'manager', isActive: true, accountType: 'INTERNAL', role: 'MANAGER', moduleRoles: ['acompanhamento:manager'] };
  const initialRoles = [
    role('op', 'Operador', [set('2026-01-01', 1, { baseModel: 'operador', salarioBase: 2200 }),
      set('2026-12-01', 2, { baseModel: 'auxiliar', salarioBase: 3300 })]),
    role('sup', 'Supervisor', [set('2026-01-01', 1, { baseModel: 'operador', salarioBase: 4400 })]),
    role('coord', 'Coordenador', [set('2026-01-01', 1, { salarioBase: 5500 })]),
    { id: 'new', name: 'Sem custo', isActive: true, costProfile: null }
  ];
  let roles = structuredClone(initialRoles), failOn = null, transactions = 0;
  const originals = [];
  const stub = (object, key, implementation) => {
    originals.push([object, key, object[key]]);
    object[key] = implementation;
  };
  t.after(() => { for (const [object, key, original] of originals) object[key] = original; });
  stub(prisma.userSession, 'findUnique', async () => ({ id: 's', expiresAt: new Date(Date.now() + 60000), user }));
  stub(prisma, '$transaction', async callback => {
    transactions++;
    const draft = structuredClone(roles);
    const result = await callback({
      jobRole: {
        findUnique: async ({ where }) => draft.find(item => item.id === where.id),
        findMany: async ({ where }) => draft.filter(item => where.id.in.includes(item.id) && item.isActive)
      },
      costProfile: { create: async ({ data }) => {
        const item = draft.find(role => role.id === data.jobRoleId);
        item.costProfile = { ...data, id: `profile-${item.id}`, parameterSets: [] };
        return item.costProfile;
      } },
      costParameterSet: { create: async ({ data }) => {
        if (data.costProfileId === failOn) throw new Error('Falha simulada');
        const item = draft.find(role => role.costProfile?.id === data.costProfileId);
        const saved = { ...data, createdAt: new Date() };
        item.costProfile.parameterSets.push(saved);
        return saved;
      } }
    });
    roles = draft;
    return result;
  });
  stub(prisma.jobRole, 'findMany', async () => roles);
  const app = express();
  app.use(express.json(), router);
  app.use((error, _req, res, _next) => res.status(error.name === 'ZodError' ? 400 : 500).json({ error: error.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, body, authenticated = true) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body ? 'PUT' : 'GET', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: 'Bearer test-only' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json() };
  };
  const payload = { jobRoleIds: ['op', 'sup'], reajusteHhPct: 0.1, effectiveDate: '2026-11-15' };
  assert.equal((await request('/cargos/reajuste-hh', payload, false)).status, 401);
  user.moduleRoles = ['acompanhamento:viewer'];
  assert.equal((await request('/cargos/reajuste-hh', payload)).status, 403);
  assert.equal((await request('/cargos/op/parametros', { params: { reajusteHhPct: 0.1 }, effectiveDate: payload.effectiveDate })).status, 403);
  user.moduleRoles = ['acompanhamento:manager'];
  assert.equal(transactions, 0);
  for (const invalid of [{ reajusteHhPct: -0.1 }, { reajusteHhPct: 10 }, { reajusteHhPct: '10' },
    { effectiveDate: '2026-02-30' }, { jobRoleIds: [] }]) {
    assert.equal((await request('/cargos/reajuste-hh', { ...payload, ...invalid })).status, 400);
  }
  assert.equal(transactions, 0);
  assert.equal((await request('/cargos/reajuste-hh', { ...payload, jobRoleIds: ['op', 'missing'] })).status, 404);
  assert.equal((await request('/cargos/reajuste-hh', { ...payload, jobRoleIds: ['op', 'new'] })).status, 422);
  assert.equal((await request('/cargos/reajuste-hh', { ...payload, effectiveDate: '2025-01-01' })).status, 422);
  assert.deepEqual(roles, initialRoles);
  failOn = 'profile-sup';
  assert.equal((await request('/cargos/reajuste-hh', payload)).status, 500);
  assert.deepEqual(roles, initialRoles, 'uma falha reverte o lote inteiro');
  failOn = null;
  const result = await request('/cargos/reajuste-hh', { ...payload, jobRoleIds: ['op', 'sup', 'op'] });
  assert.equal(result.status, 201);
  assert.equal(result.body.cargos.length, 2);
  const op = roles.find(role => role.id === 'op').costProfile.parameterSets.at(-1);
  assert.deepEqual(op.params, { baseModel: 'operador', salarioBase: 2200, reajusteHhPct: 0.1 }, 'preserva a base na vigência, não o salário futuro');
  assert.equal(op.version, 3);
  assert.equal(op.createdByUserId, 'manager');
  assert.equal(op.note, 'Reajuste do HH: 10%');
  assert.deepEqual(roles.find(role => role.id === 'coord'), initialRoles.find(role => role.id === 'coord'));
  const afterBulk = (await request('/cargos')).body.find(role => role.jobRoleId === 'op');
  assert.equal(afterBulk.params.salarioBase, 3300);
  assert.equal(afterBulk.params.reajusteHhPct, 0.1, 'a vigência futura de salário herda o reajuste');
  assert.equal(afterBulk.history.find(entry => entry.effectiveDate.startsWith('2026-12-01')).params.reajusteHhPct, 0.1);
  assert.equal((await request('/cargos/reajuste-hh', payload)).status, 201);
  assert.equal(roles.find(role => role.id === 'op').costProfile.parameterSets.at(-1).params.reajusteHhPct, 0.1, 'repetir 10% não acumula 21%');
  const single = body => request('/cargos/op/parametros', { effectiveDate: '2026-11-20', params: body });
  assert.equal((await single({ salarioBase: 2300, reajusteHhPct: -1 })).status, 400);
  assert.equal((await single({ salarioBase: 2300, reajusteHhPct: '10' })).status, 400);
  const legacy = await single({ baseModel: 'operador', salarioBase: 2300 });
  assert.equal(legacy.status, 201);
  assert.equal(legacy.body.params.reajusteHhPct, 0.1, 'cliente antigo não apaga reajuste vigente');
  assert.equal((await single({ baseModel: 'operador', salarioBase: 2300, reajusteHhPct: 0 })).body.params.reajusteHhPct, 0);
  const list = await request('/cargos');
  assert.equal(list.status, 200);
  const history = list.body.find(role => role.jobRoleId === 'op').history;
  assert.ok(history.some(entry => entry.params.reajusteHhPct === 0.1));
  assert.ok(history.some(entry => entry.params.reajusteHhPct === 0));
  assert.equal(history.at(-1).params.salarioBase, 2200);
  const newCargo = await request('/cargos/new/parametros', {
    effectiveDate: '2026-11-15', params: { baseModel: 'operador', salarioBase: 1800, reajusteHhPct: 0.1 }
  });
  assert.equal(newCargo.status, 201);
  assert.equal(newCargo.body.profileId, 'profile-new');
  assert.equal(roles.find(role => role.id === 'new').costProfile.parameterSets[0].version, 1);
  assert.equal((await request('/cargos/missing/parametros', {
    effectiveDate: '2026-11-15', params: { salarioBase: 1800 }
  })).status, 404);
  const operator = roles.find(role => role.id === 'op');
  const cancelledVersion = Math.max(...operator.costProfile.parameterSets.map(set => set.version)) + 1;
  operator.costProfile.parameterSets.push(set('2026-11-21', cancelledVersion, {
    salarioBase: null, salaryReference: { id: 'external-salary', revision: 2, status: 'CANCELLED' }
  }));
  assert.equal((await request('/cargos/reajuste-hh', { jobRoleIds: ['op'], effectiveDate: '2026-11-22', reajusteHhPct: 0.15 })).status, 201);
  assert.equal(roles.find(role => role.id === 'op').costProfile.parameterSets.at(-1).params.salaryReference.status, 'CANCELLED',
    'reajustar HH não autoriza recuperar salário cancelado nem usar o modelo genérico');
});
