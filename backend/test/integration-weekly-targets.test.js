import assert from 'node:assert/strict';
import test from 'node:test';
import Ajv from 'ajv';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import { listOperationalResources } from '../src/lib/api-credentials/operational-service.js';
import { computeProjectProgressDetails } from '../src/lib/acompanhamento/avanco.js';
import { listWeeklyProgressTargets } from '../src/lib/acompanhamento/weekly-progress-targets.js';
import { loadWeeklyServiceHistory } from '../src/lib/acompanhamento/weekly-service-history.js';
import { loadWeeklyAttendanceHistory } from '../src/lib/acompanhamento/weekly-attendance-history.js';
import { weeklyTargetSchema } from '../src/lib/api-credentials/weekly-target-schema.js';
import { projectWeeklyTarget } from '../src/lib/api-credentials/weekly-target-projection.js';
import { buildWeeklyProgressComparison, weeklyTargetGoalKind, weeklyTargetUnit, WEEKLY_TARGET_SERVICES } from '../../shared/modules/mission-weekly-progress.js';
import { WEEKLY_STATUS_LABEL, weeklyGoalSentence, weeklyScenarioGoalDescription } from '../../shared/modules/weekly-target-presentation.js';

const week = '2026-09-28', today = '2026-11-03';
const date = day => new Date(day + 'T12:00:00Z');
const serviceGoal = (serviceType, metric, value, basis = 'WEEK_TOTAL') => ({ kind: 'SERVICE', serviceType, metric, value, basis });
const list = (goals, logic = 'ALL', extra = {}) => ({ version: 2, logic, goals, ...extra });
const validate = new Ajv({ strict: false, formats: { date: true } }).compile(weeklyTargetSchema);

function assertParity(meta, comparison) {
  if (!comparison || comparison.status === 'NO_TARGET') return assert.equal(meta, null);
  assert.ok(validate(meta), JSON.stringify(validate.errors));
  assert.deepEqual({ ...meta, itens: undefined, colaboradoresPorDia: undefined }, {
    situacao: comparison.status, rotuloSituacao: WEEKLY_STATUS_LABEL[comparison.status], emAndamento: comparison.inProgress,
    periodoInicio: comparison.periodStartDate, periodoFim: comparison.periodEndDate,
    regra: comparison.logic, cenario: comparison.scenarioName, atingimentoPct: comparison.achievementPct,
    itens: undefined, colaboradoresPorDia: undefined
  });
  assert.equal(meta.itens.length, comparison.goals.length);
  comparison.goals.forEach((goal, index) => {
    const item = meta.itens[index], tipo = weeklyTargetGoalKind(goal), base = goal.basis ?? comparison.basis;
    assert.deepEqual(item, {
      tipo, servico: goal.serviceType ?? null, rotuloServico: goal.serviceType ? WEEKLY_TARGET_SERVICES[goal.serviceType] : null,
      unidade: goal.metric, rotuloUnidade: weeklyTargetUnit(goal.metric), base, valorCadastrado: goal.value,
      planejado: goal.plannedValue, realizado: goal.actualValue, diferenca: goal.differenceValue,
      resultado: goal.outcome ?? (comparison.status === 'PLANNED' ? 'PLANNED' : goal.actualValue == null || goal.plannedValue == null ? 'NO_DATA' : goal.differenceValue < 0 ? 'BELOW' : 'MET'),
      pendenciasBase: goal.productivityIssues,
      descricao: comparison.target.definition?.version === 2
        ? weeklyGoalSentence({ ...goal, kind: tipo, basis: base }) : weeklyScenarioGoalDescription({ ...goal, basis: base })
    });
  });
  assert.deepEqual(meta.colaboradoresPorDia, comparison.dailyAttendance.map(day => ({ data: day.date, planejado: day.plannedValue, presentes: day.actualValue })));
}

test('projeção preserva PLANNED do comparativo em semana futura', () => {
  const futureWeek = '2026-11-09';
  const comparison = buildWeeklyProgressComparison({ today, targets: [{ weekStartDate: futureWeek, revision: 1,
    definition: list([serviceGoal('FLUSHING', 'M', 50, 'PER_PRODUCTIVE_DAY')]) }],
    serviceHistory: [{ date: futureWeek, serviceType: 'FLUSHING', quantities: { M: 100, L: 0, UN: 0 } }]
  }).find(row => row.weekStartDate === futureWeek);
  const meta = projectWeeklyTarget(comparison);
  assertParity(meta, comparison);
  assert.equal(meta.situacao, 'PLANNED'); assert.equal(meta.itens[0].realizado, null);
});

test('G1 meta: paridade com entradas do painel, privacidade e carga em lote em PostgreSQL descartável', { timeout: 120_000 }, async t => {
  const db = await apiSimulationDatabase(), client = db.client;
  t.after(() => db.close());
  for (const [id, code] of [['visible','00101'], ['empty','00102'], ['hidden','00103']]) await client.project.create({ data: {
    id, code, name: 'Projeto fictício', clientName: 'Cliente fictício', clientCnpj: '', contractCode: code, location: '', manualProgressPct: 45
  } });
  const role = await client.jobRole.create({ data: { name: 'Cargo fictício', normalizedKey: 'meta-test' } });
  const crew = await Promise.all([1,2,3].map(n => client.collaborator.create({ data: {
    name: 'PRIVATE_PERSON_' + n, code: 'TEST' + n, cpf: 'PRIVATE_CPF', jobRoleId: role.id
  } })));
  const rdo = async (day, type, extraData, people = crew.slice(0,2), projectId = 'visible') => client.report.create({ data: {
    projectId, reportType: 'RDO', status: 'APPROVED', reportDate: new Date(day), arrivalTime: '08:00', departureTime: '17:00',
    lunchBreak: '01:00', daytimeCount: people.length, dailyDescription: 'PRIVATE_NOTE',
    collaborators: { create: people.map(person => ({ collaboratorId: person.id, roleNameSnapshot: role.name })) },
    services: { create: { finalized: true, serviceType: type, extraData } }
  } });
  await rdo('2026-09-27', 'Flushing', { tubes: [{ c: '9', lengthUnit: 'm' }] });
  const flushing = await rdo(week, 'Flushing', { tubes: [{ c: '8000', lengthUnit: 'cm' }] });
  await rdo('2026-09-29', 'Filtragem', { volumeOleo: 400000, volumeOleoUnit: 'mL' }, crew);
  await rdo('2026-09-30', 'Limpeza química', { limpezaTubulacao: 'Não', quantidadeSistemas: 2 });
  // Fora do recorte: não pode contaminar qualquer cálculo nem aparecer no JSON.
  await rdo(week, 'Flushing', { tubes: [{ c: '99999' }] }, crew, 'hidden');
  await client.projectManualProgressHistory.createMany({ data: [['2026-09-27',10],[week,20],['2026-10-04',45]]
    .map(([day, progressPct]) => ({ projectId: 'visible', recordedAt: date(day), progressPct })) });
  const context = { scopes: new Set(['acompanhamento.progresso.read']), credentialId: 'synthetic-weekly-target',
    projectAccessMode: 'SELECTED', projectIds: new Set(['visible','empty']), projectCodes: new Set(['00101','00102']),
    cursorKey: 'synthetic-weekly-target-key-with-at-least-32-characters', snapshotAt: date(today) };
  const queryApi = (query = {}, ctx = context) => listOperationalResources(client, 'acompanhamento.projects.weeks.list', { limit: 100, weekStart: week, ...query }, ctx);
  let revision = 0;
  const save = (definition, extra = {}) => client.missionWeeklyProgressTarget.create({ data: {
    projectId: 'visible', weekStartDate: new Date(week), definition, revision: ++revision,
    createdByName: 'PRIVATE_AUTHOR', createdAt: date('2026-09-01'), ...extra
  } });
  const panelComparison = async (projectId = 'visible', targetWeek = week) => {
    const owner = { projectId };
    const [targets, detail, serviceHistory, attendanceHistory] = await Promise.all([
      listWeeklyProgressTargets(owner, { client }), computeProjectProgressDetails(projectId, { database: client }),
      loadWeeklyServiceHistory(owner, { client }), loadWeeklyAttendanceHistory(owner, { client })
    ]);
    return buildWeeklyProgressComparison({ targets, progressHistory: detail.dailyProgressHistory, serviceHistory, attendanceHistory, today })
      .find(row => row.weekStartDate === targetWeek);
  };
  const check = async (query = {}) => {
    const row = (await queryApi({ projectId: 'visible', ...query })).items[0];
    assertParity(row.meta, await panelComparison('visible', query.weekStart ?? week));
    const json = JSON.stringify(row);
    for (const privateValue of ['PRIVATE', ...crew.map(person => person.id), 'collaboratorIds', 'createdBy', 'currency', 'author']) assert.equal(json.includes(privateValue), false, privateValue);
    return row;
  };

  await t.test('sem meta: null e campos antigos preservados', async () => {
    const row = await check();
    assert.equal(row.meta, null); assert.equal(row.metaPontos, null); assert.equal(row.metaDefinidaPor, null);
  });
  await t.test('p.p. legado e lista de avanço: mesma diferença dos acumulados', async () => {
    await save(undefined, { plannedPctPoints: 30 });
    let row = await check();
    assert.equal(row.metaPontos, 30); assert.equal(row.meta.itens[0].realizado, 35); assert.equal(row.meta.situacao, 'ABOVE');
    await save(list([{ kind: 'PROGRESS', value: 35 }]));
    row = await check(); assert.equal(row.metaPontos, null); assert.equal(row.meta.situacao, 'ON_TARGET');
  });
  await t.test('lista por serviço E/OU mantém metros, litros e unidades sem conversão para percentual', async () => {
    const goals = [serviceGoal('FLUSHING','M',80), serviceGoal('FILTRAGEM','L',500), serviceGoal('LIMPEZA_QUIMICA','UN',2)];
    for (const [logic, status] of [['ALL','PARTIAL'], ['ANY','ON_TARGET']]) {
      await save(list(goals, logic));
      const row = await check(); assert.equal(row.meta.regra, logic); assert.equal(row.meta.situacao, status);
      assert.deepEqual(row.meta.itens.map(item => item.realizado), [80,400,2]);
    }
    await save(list([serviceGoal(null,'M',90)]));
    const row = await check(); assert.equal(row.meta.itens[0].servico, null); assert.equal(row.meta.itens[0].rotuloServico, null);
  });
  await t.test('cenário exato e NO_RULE usam os mesmos tipos executados', async () => {
    const definition = { metric: 'M', basis: 'WEEK_TOTAL', scenarios: [{ name: 'Combinação fictícia',
      condition: { kind: 'SERVICE_SET', serviceTypes: ['FLUSHING','FILTRAGEM','LIMPEZA_QUIMICA'] },
      goals: [{ serviceType: 'FLUSHING', value: 80 }, { serviceType: 'FILTRAGEM', value: 400 }, { serviceType: 'LIMPEZA_QUIMICA', value: 1 }] }] };
    await save(definition); const row = await check(); assert.equal(row.meta.cenario, 'Combinação fictícia');
    assert.deepEqual(row.meta.itens.map(item => item.unidade), ['M','L','M']);
    await save({ ...definition, scenarios: [{ ...definition.scenarios[0], condition: { kind: 'SERVICE_COUNT', count: 1 } }] });
    assert.equal((await check()).meta.situacao, 'NO_RULE');
  });
  await t.test('por dia produtivo usa equipe, recalcula após RDO e expõe só códigos de pendência', async () => {
    await save(list([serviceGoal('FLUSHING','M',50,'PER_PRODUCTIVE_DAY')]));
    let row = await check(); assert.equal(row.meta.itens[0].planejado, 100); assert.equal(row.meta.itens[0].realizado, 80);
    await client.reportCollaborator.create({ data: { reportId: flushing.id, collaboratorId: crew[2].id, roleNameSnapshot: role.name } });
    row = await check({ updatedSince: '2026-11-03T00:00:00Z' }); assert.equal(row.meta.itens[0].planejado, 150);
    // Medição real sem RDO-base (formulário de serviço independente).
    await client.report.create({ data: { projectId: 'visible', reportType: 'RLQ', status: 'APPROVED', reportDate: new Date('2026-10-01'),
      arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 0,
      services: { create: { serviceType: 'Flushing', finalized: true, extraData: { tubes: [{ c: '20' }] } } } } });
    row = await check(); assert.equal(row.meta.itens[0].planejado, null); assert.equal(row.meta.itens[0].realizado, 100);
    assert.deepEqual(row.meta.itens[0].pendenciasBase, ['MISSING_RDO_BASE']); assert.equal(row.meta.situacao, 'NO_DATA');
  });
  await t.test('colaboradores por dia em lista e cenário: apenas data e quantidades', async () => {
    for (const definition of [list([{ kind: 'ATTENDANCE', value: 3, workdays: [1,2,3,4] }]),
      { metric: 'COLLABORATORS', basis: 'PER_WORKDAY', workdays: [1,2,3,4], scenarios: [{ name: 'Equipe fictícia', condition: { kind: 'ALWAYS' }, goals: [{ serviceType: null, value: 3 }] }] }]) {
      await save(definition); const row = await check();
      assert.deepEqual(row.meta.colaboradoresPorDia, [
        { data: week, planejado: 3, presentes: 3 }, { data: '2026-09-29', planejado: 3, presentes: 3 },
        { data: '2026-09-30', planejado: 3, presentes: 2 }, { data: '2026-10-01', planejado: 3, presentes: null }
      ]);
      assert.equal(row.meta.itens[0].realizado, null); assert.equal(row.meta.situacao, 'BELOW');
    }
  });
  await t.test('sem RDO na semana, repetição e contagem quarta–terça inclusive fora da página', async () => {
    await save(list([serviceGoal('FLUSHING','M',100)], 'ALL', { repeatWeekly: true, countingStartDay: 3, countingEndDay: 2 }));
    let row = await check(); assert.equal(row.meta.periodoInicio, '2026-09-30'); assert.equal(row.meta.periodoFim, '2026-10-06');
    row = await check({ weekStart: '2026-10-05' }); assert.equal(row.meta.situacao, 'NO_DATA');
    assert.equal(row.metaDefinidaPor, 'PROJETO'); assert.equal(row.meta.periodoFim, '2026-10-13');
    // Próxima revisão limita o período anterior sem precisar estar na página.
    await save(list([serviceGoal('FLUSHING','M',100)], 'ALL', { repeatWeekly: true }), { weekStartDate: new Date('2026-10-05'), revision: 1 });
    row = await check(); assert.equal(row.meta.periodoFim, '2026-10-04');
  });
  await t.test('período futuro na semana atual fica PLANNED, sem antecipar realizado', async () => {
    await save(list([serviceGoal('FLUSHING','M',100)], 'ALL', { countingStartDay: 3, countingEndDay: 2 }), { weekStartDate: new Date('2026-11-02'), revision: 1 });
    const row = await check({ weekStart: '2026-11-02' }); assert.equal(row.meta.situacao, 'PLANNED');
    assert.equal(row.meta.itens[0].resultado, 'PLANNED'); assert.equal(row.meta.itens[0].realizado, null); assert.equal(row.meta.emAndamento, false);
  });
  await t.test('base e serviços são carregados uma vez por página, mesmo com várias semanas/projetos', async () => {
    const originals = [], counts = {};
    for (const delegate of ['report','reportService','historicalServiceReport','projectRealizedCorrection']) {
      const original = client[delegate].findMany;
      originals.push(() => { client[delegate].findMany = original; });
      client[delegate].findMany = args => { counts[delegate] = (counts[delegate] ?? 0) + 1; return original.call(client[delegate], args); };
    }
    try {
      const result = await queryApi({ weekStart: undefined, from: week, to: '2026-10-25' });
      assert.equal(result.items.length, 8); assert.ok(result.items.every(row => row.projectId !== 'hidden'));
      assert.deepEqual(counts, { report: 1, reportService: 1, historicalServiceReport: 1, projectRealizedCorrection: 1 });
    } finally { originals.forEach(restore => restore()); }
  });
});
