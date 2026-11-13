import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDivisionProgressDetails, computeProgressDetailsForProjects } from '../src/lib/acompanhamento/avanco.js';

const types = ['LIMPEZA_QUIMICA', 'FLUSHING'];
const division = (scopeName, equipment = 'unidade geradora 07') => ({
  key: JSON.stringify(['EQUIPMENT', scopeName, equipment]), startDate: '2025-04-01', endDate: '2025-04-30'
});
const quantity = (progress, type, metric = 'TUBULACAO') =>
  progress.services.find(service => service.serviceType === type)?.totals.find(total => total.systemType === metric)?.realizedQty ?? 0;

function fixture() {
  const system = { id: 'shared-system', equipment: 'Unidade Geradora 07', name: 'Linha de alimentação', aliases: [] };
  const other = { id: 'other-ug', equipment: 'Unidade Geradora 08', name: 'Linha de alimentação', aliases: [] };
  const planned = ['Escopo Alfa', 'Escopo Beta'].flatMap(scopeName => types.map(serviceType => ({
    projectId: 'p', scopeName, serviceType, weight: 1,
    systems: (scopeName === 'Escopo Alfa' ? ['5'] : ['1', '6']).map(diameter => ({
      projectSystemId: system.id, projectSystem: system, systemType: 'TUBULACAO', unit: 'M',
      diameter, diameterUnit: 'pol', quantity: 100
    }))
  })));
  planned.push(...types.map(serviceType => ({ projectId: 'p', scopeName: 'Escopo Alfa', serviceType, weight: 1,
    systems: [{ projectSystemId: other.id, projectSystem: other, systemType: 'TUBULACAO', unit: 'M',
      diameter: '5', diameterUnit: 'pol', quantity: 100 }] })));
  const alfa = division('Escopo Alfa'), beta = division('Escopo Beta');
  const project = { id: 'p', proposalPercentage: 100, trackingDivisions: [alfa, beta] };
  const reports = [];
  const database = {
    project: { findMany: async () => [project], findUnique: async () => project },
    projectPlannedService: { findMany: async () => planned },
    projectManualProgressHistory: { findMany: async () => [] }
  };
  const options = () => ({ database, servicesByProject: new Map([['p', reports]]), includeRevision: true });
  return { project, planned, reports, alfa, beta, options };
}

function report(serviceType, meters, diameter = '1', patch = {}) {
  const { extraData, ...source } = patch;
  return { serviceType, finalized: true, reportType: 'RDO', reportDate: '2025-04-07', system: 'Linha de alimentação', ...source,
    extraData: { __scopeName: 'Escopo Alfa', equipmentId: 'Unidade Geradora 07', __projectSystemId: 'shared-system',
      tubes: [{ d: diameter, c: meters, unit: 'pol', lengthUnit: 'm' }], ...extraData } };
}

test('escopo, UG e data do RDO prevalecem sobre a bitola cadastrada em Escopo Beta em todas as projeções', async () => {
  const state = fixture();
  state.reports.push(report('limpeza', 42.75, '1 1/4', { reportDate: '2025-04-06' }), report('flushing', 42.75),
    report('limpeza', 3.25, '5'), report('flushing', 3.25, '5'));
  const before = structuredClone({ project: state.project, planned: state.planned, reports: state.reports });
  const full = (await computeProgressDetailsForProjects(['p'], state.options())).get('p');
  const current = (await computeProgressDetailsForProjects(['p'], { ...state.options(), currentOnly: true })).get('p');
  assert.deepEqual(current.progress, full.progress);
  assert.equal(current.progressRevision, full.progressRevision);
  const alfa = await computeDivisionProgressDetails('p', state.alfa, state.options());
  const beta = await computeDivisionProgressDetails('p', state.beta, state.options());
  const divisionCurrent = await computeDivisionProgressDetails('p', state.alfa, { ...state.options(), currentOnly: true });
  assert.deepEqual(divisionCurrent.progress, alfa.progress);
  assert.equal(divisionCurrent.progressRevision, alfa.progressRevision);
  for (const type of types) {
    assert.equal(quantity(full.progress, type), 46);
    assert.equal(quantity(alfa.progress, type), 46);
    assert.equal(quantity(beta.progress, type), 0);
    assert.equal(quantity(full.progress.scopeGroups.find(group => group.scopeName === 'Escopo Alfa'), type), 46);
    assert.equal(quantity(full.progress.scopeGroups.find(group => group.scopeName === 'Escopo Beta'), type), 0);
    const slices = full.progressSlices;
    assert.equal(quantity(slices.slices[slices.lookup['escopo alfa|unidade geradora 07']].progress, type), 46);
    assert.equal(quantity(slices.slices[slices.lookup['escopo beta|unidade geradora 07']].progress, type), 0);
    assert.equal(quantity(slices.slices[slices.lookup['escopo alfa|unidade geradora 08']].progress, type), 0);
    const daily = full.dailyProgressHistory.at(-1).services.find(service => service.serviceType === type);
    assert.equal(daily.quantities.find(total => total.unit === 'M').realizedQty, 46);
  }
  assert.equal(alfa.progressHistory.at(-1).progressPct, alfa.progress.progressPct);
  assert.deepEqual({ project: state.project, planned: state.planned, reports: state.reports }, before);
});

test('conta a metragem da divisão sem sistema, bitola ou vínculo válido e sem assumir um sistema previsto', async () => {
  for (const extraData of [
    { __projectSystemId: 'sistema-antigo' }, { __projectSystemId: null },
    { __projectSystemId: 'other-ug' }, { __scopeName: undefined, __scopeKey: '"Escopo Alfa"', equipmentId: 'UG007' }
  ]) {
    const state = fixture();
    state.reports.push(report('flushing', 17, '1', { system: 'Sistema não cadastrado', extraData }));
    const result = await computeDivisionProgressDetails('p', state.alfa, state.options());
    assert.equal(quantity(result.progress, 'FLUSHING'), 17);
    assert.ok(result.progress.services.find(service => service.serviceType === 'FLUSHING').systems.every(row => row.realizedQty === 0));
    assert.equal(quantity((await computeDivisionProgressDetails('p', state.beta, state.options())).progress, 'FLUSHING'), 0);
  }
});

test('serviço sem meta na divisão aparece com realizado e sem inventar previsão ou percentual', async () => {
  const state = fixture();
  state.planned.splice(1, 1);
  state.reports.push(report('flushing', 17));
  const result = await computeDivisionProgressDetails('p', state.alfa, state.options());
  const service = result.progress.services.find(service => service.serviceType === 'FLUSHING');
  assert.deepEqual(service.totals, [{ systemType: 'TUBULACAO', unit: 'M', plannedQty: null, realizedQty: 17, pct: null }]);
  assert.equal(service.weight, 0);
  assert.equal(service.executionPct, null);
  assert.deepEqual(service.systems, []);
  const full = (await computeProgressDetailsForProjects(['p'], state.options())).get('p');
  assert.equal(quantity(full.progress.scopeGroups.find(group => group.scopeName === 'Escopo Alfa'), 'FLUSHING'), 17);
  assert.equal(quantity(full.progress.scopeGroups.find(group => group.scopeName === 'Escopo Beta'), 'FLUSHING'), 0);
  assert.equal(quantity(full.progressSlices.slices[full.progressSlices.lookup['escopo alfa|unidade geradora 07']].progress, 'FLUSHING'), 17);
  state.planned.splice(0, state.planned.length);
  assert.equal(quantity((await computeDivisionProgressDetails('p', state.alfa, state.options())).progress, 'FLUSHING'), 17);
});

test('uma meta de outra unidade de medida não impede contar metros sem meta de tubulação', async () => {
  const state = fixture();
  state.planned[1].systems = state.planned[1].systems.map(row => ({ ...row, systemType: 'OLEO', unit: 'L', quantity: 1000 }));
  state.reports.push(report('flushing', 17));
  const result = await computeDivisionProgressDetails('p', state.alfa, state.options());
  assert.equal(quantity(result.progress, 'FLUSHING'), 17);
  assert.equal(quantity(result.progress, 'FLUSHING', 'OLEO'), 0);
});

test('a divisão inclui os limites do período e exige a mesma UG, o mesmo escopo e um serviço finalizado de relatório-fonte', async () => {
  const state = fixture();
  state.reports.push(report('flushing', 10, '1', { reportDate: '2025-04-01' }),
    report('flushing', 20, '1', { reportDate: '2025-04-30' }),
    report('flushing', 500, '1', { reportDate: '2025-03-31' }),
    report('flushing', 500, '1', { reportDate: '2025-05-01' }),
    report('flushing', 500, '1', { extraData: { equipmentId: 'Unidade Geradora 08' } }),
    report('flushing', 500, '1', { extraData: { __scopeName: 'Escopo Beta' } }),
    report('flushing', 500, '1', { finalized: false }),
    report('flushing', 500, '1', { reportType: 'RCPU', specialConditions: { parentRdoId: 'rdo' } }));
  assert.equal(quantity((await computeDivisionProgressDetails('p', state.alfa, state.options())).progress, 'FLUSHING'), 30);
});

test('sem divisão aplicável, conserva a associação de relatórios antigos e de relatórios independentes', async () => {
  const state = fixture();
  state.project.trackingDivisions = [];
  state.reports.push(report('flushing', 17));
  const full = (await computeProgressDetailsForProjects(['p'], state.options())).get('p');
  assert.equal(quantity(full.progress.scopeGroups.find(group => group.scopeName === 'Escopo Beta'), 'FLUSHING'), 17);
  state.project.trackingDivisions = [state.alfa, state.beta];
  state.reports.splice(0, 1, report('flushing', 17, '1', { reportType: 'RCPU' }));
  assert.equal(quantity((await computeDivisionProgressDetails('p', state.beta, state.options())).progress, 'FLUSHING'), 17);
});

test('mudar a janela da divisão atualiza a revisão e a atribuição no projeto completo', async () => {
  const state = fixture();
  state.reports.push(report('flushing', 17));
  const read = async () => (await computeProgressDetailsForProjects(['p'], { ...state.options(), currentOnly: true })).get('p');
  const before = await read();
  state.alfa.endDate = '2025-04-06';
  const after = await read();
  assert.notEqual(after.progressRevision, before.progressRevision);
  assert.equal(quantity(before.progress.scopeGroups.find(group => group.scopeName === 'Escopo Alfa'), 'FLUSHING'), 17);
  assert.equal(quantity(after.progress.scopeGroups.find(group => group.scopeName === 'Escopo Alfa'), 'FLUSHING'), 0);
});
