import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDivisionProgressDetails, computeProgressDetailsForProjects } from '../src/lib/acompanhamento/avanco.js';

const types = ['LIMPEZA_QUIMICA', 'FLUSHING'];
const division = (scopeName, equipment = 'unidade geradora 14') => ({
  key: JSON.stringify(['EQUIPMENT', scopeName, equipment]), startDate: '2026-10-01', endDate: '2026-10-31'
});
const quantity = (progress, type, metric = 'TUBULACAO') =>
  progress.services.find(service => service.serviceType === type)?.totals.find(total => total.systemType === metric)?.realizedQty ?? 0;

function fixture() {
  const system = { id: 'shared-mancal', equipment: 'Unidade Geradora 14', name: 'Mancal Escora', aliases: [] };
  const other = { id: 'other-ug', equipment: 'Unidade Geradora 01', name: 'Mancal Escora', aliases: [] };
  const planned = ['Jupiá', 'Ilha Solteira'].flatMap(scopeName => types.map(serviceType => ({
    projectId: 'p', scopeName, serviceType, weight: 1,
    systems: (scopeName === 'Jupiá' ? ['5'] : ['1', '6']).map(diameter => ({
      projectSystemId: system.id, projectSystem: system, systemType: 'TUBULACAO', unit: 'M',
      diameter, diameterUnit: 'pol', quantity: 100
    }))
  })));
  planned.push(...types.map(serviceType => ({ projectId: 'p', scopeName: 'Jupiá', serviceType, weight: 1,
    systems: [{ projectSystemId: other.id, projectSystem: other, systemType: 'TUBULACAO', unit: 'M',
      diameter: '5', diameterUnit: 'pol', quantity: 100 }] })));
  const jupia = division('Jupiá'), ilha = division('Ilha Solteira');
  const project = { id: 'p', proposalPercentage: 100, trackingDivisions: [jupia, ilha] };
  const reports = [];
  const database = {
    project: { findMany: async () => [project], findUnique: async () => project },
    projectPlannedService: { findMany: async () => planned },
    projectManualProgressHistory: { findMany: async () => [] }
  };
  const options = () => ({ database, servicesByProject: new Map([['p', reports]]), includeRevision: true });
  return { project, planned, reports, jupia, ilha, options };
}

function report(serviceType, meters, diameter = '1', patch = {}) {
  const { extraData, ...source } = patch;
  return { serviceType, finalized: true, reportType: 'RDO', reportDate: '2026-10-22', system: 'Mancal Escora', ...source,
    extraData: { __scopeName: 'Jupiá', equipmentId: 'Unidade Geradora 14', __projectSystemId: 'shared-mancal',
      tubes: [{ d: diameter, c: meters, unit: 'pol', lengthUnit: 'm' }], ...extraData } };
}

test('5719: escopo, UG e data do RDO prevalecem sobre a bitola cadastrada em Ilha Solteira em todas as projeções', async () => {
  const state = fixture();
  state.reports.push(report('limpeza', 98.53, '1 1/4', { reportDate: '2026-10-21' }), report('flushing', 98.53),
    report('limpeza', 7.36, '5'), report('flushing', 7.36, '5'));
  const before = structuredClone({ project: state.project, planned: state.planned, reports: state.reports });
  const full = (await computeProgressDetailsForProjects(['p'], state.options())).get('p');
  const current = (await computeProgressDetailsForProjects(['p'], { ...state.options(), currentOnly: true })).get('p');
  assert.deepEqual(current.progress, full.progress);
  assert.equal(current.progressRevision, full.progressRevision);
  const jupia = await computeDivisionProgressDetails('p', state.jupia, state.options());
  const ilha = await computeDivisionProgressDetails('p', state.ilha, state.options());
  const divisionCurrent = await computeDivisionProgressDetails('p', state.jupia, { ...state.options(), currentOnly: true });
  assert.deepEqual(divisionCurrent.progress, jupia.progress);
  assert.equal(divisionCurrent.progressRevision, jupia.progressRevision);
  for (const type of types) {
    assert.equal(quantity(full.progress, type), 105.89);
    assert.equal(quantity(jupia.progress, type), 105.89);
    assert.equal(quantity(ilha.progress, type), 0);
    assert.equal(quantity(full.progress.scopeGroups.find(group => group.scopeName === 'Jupiá'), type), 105.89);
    assert.equal(quantity(full.progress.scopeGroups.find(group => group.scopeName === 'Ilha Solteira'), type), 0);
    const slices = full.progressSlices;
    assert.equal(quantity(slices.slices[slices.lookup['jupia|unidade geradora 14']].progress, type), 105.89);
    assert.equal(quantity(slices.slices[slices.lookup['ilha solteira|unidade geradora 14']].progress, type), 0);
    assert.equal(quantity(slices.slices[slices.lookup['jupia|unidade geradora 01']].progress, type), 0);
    const daily = full.dailyProgressHistory.at(-1).services.find(service => service.serviceType === type);
    assert.equal(daily.quantities.find(total => total.unit === 'M').realizedQty, 105.89);
  }
  assert.equal(jupia.progressHistory.at(-1).progressPct, jupia.progress.progressPct);
  assert.deepEqual({ project: state.project, planned: state.planned, reports: state.reports }, before);
});

test('conta a metragem da divisão sem sistema, bitola ou vínculo válido e sem assumir um sistema previsto', async () => {
  for (const extraData of [
    { __projectSystemId: 'sistema-antigo' }, { __projectSystemId: null },
    { __projectSystemId: 'other-ug' }, { __scopeName: undefined, __scopeKey: '"Jupiá"', equipmentId: 'UG014' }
  ]) {
    const state = fixture();
    state.reports.push(report('flushing', 17, '1', { system: 'Sistema não cadastrado', extraData }));
    const result = await computeDivisionProgressDetails('p', state.jupia, state.options());
    assert.equal(quantity(result.progress, 'FLUSHING'), 17);
    assert.ok(result.progress.services.find(service => service.serviceType === 'FLUSHING').systems.every(row => row.realizedQty === 0));
    assert.equal(quantity((await computeDivisionProgressDetails('p', state.ilha, state.options())).progress, 'FLUSHING'), 0);
  }
});

test('serviço sem meta na divisão aparece com realizado e sem inventar previsão ou percentual', async () => {
  const state = fixture();
  state.planned.splice(1, 1);
  state.reports.push(report('flushing', 17));
  const result = await computeDivisionProgressDetails('p', state.jupia, state.options());
  const service = result.progress.services.find(service => service.serviceType === 'FLUSHING');
  assert.deepEqual(service.totals, [{ systemType: 'TUBULACAO', unit: 'M', plannedQty: null, realizedQty: 17, pct: null }]);
  assert.equal(service.weight, 0);
  assert.equal(service.executionPct, null);
  assert.deepEqual(service.systems, []);
  const full = (await computeProgressDetailsForProjects(['p'], state.options())).get('p');
  assert.equal(quantity(full.progress.scopeGroups.find(group => group.scopeName === 'Jupiá'), 'FLUSHING'), 17);
  assert.equal(quantity(full.progress.scopeGroups.find(group => group.scopeName === 'Ilha Solteira'), 'FLUSHING'), 0);
  assert.equal(quantity(full.progressSlices.slices[full.progressSlices.lookup['jupia|unidade geradora 14']].progress, 'FLUSHING'), 17);
  state.planned.splice(0, state.planned.length);
  assert.equal(quantity((await computeDivisionProgressDetails('p', state.jupia, state.options())).progress, 'FLUSHING'), 17);
});

test('uma meta de outra unidade de medida não impede contar metros sem meta de tubulação', async () => {
  const state = fixture();
  state.planned[1].systems = state.planned[1].systems.map(row => ({ ...row, systemType: 'OLEO', unit: 'L', quantity: 1000 }));
  state.reports.push(report('flushing', 17));
  const result = await computeDivisionProgressDetails('p', state.jupia, state.options());
  assert.equal(quantity(result.progress, 'FLUSHING'), 17);
  assert.equal(quantity(result.progress, 'FLUSHING', 'OLEO'), 0);
});

test('a divisão inclui os limites do período e exige a mesma UG, o mesmo escopo e um serviço finalizado de relatório-fonte', async () => {
  const state = fixture();
  state.reports.push(report('flushing', 10, '1', { reportDate: '2026-10-01' }),
    report('flushing', 20, '1', { reportDate: '2026-10-31' }),
    report('flushing', 500, '1', { reportDate: '2026-09-30' }),
    report('flushing', 500, '1', { reportDate: '2026-11-01' }),
    report('flushing', 500, '1', { extraData: { equipmentId: 'Unidade Geradora 01' } }),
    report('flushing', 500, '1', { extraData: { __scopeName: 'Ilha Solteira' } }),
    report('flushing', 500, '1', { finalized: false }),
    report('flushing', 500, '1', { reportType: 'RCPU', specialConditions: { parentRdoId: 'rdo' } }));
  assert.equal(quantity((await computeDivisionProgressDetails('p', state.jupia, state.options())).progress, 'FLUSHING'), 30);
});

test('sem divisão aplicável, conserva a associação de relatórios antigos e de relatórios independentes', async () => {
  const state = fixture();
  state.project.trackingDivisions = [];
  state.reports.push(report('flushing', 17));
  const full = (await computeProgressDetailsForProjects(['p'], state.options())).get('p');
  assert.equal(quantity(full.progress.scopeGroups.find(group => group.scopeName === 'Ilha Solteira'), 'FLUSHING'), 17);
  state.project.trackingDivisions = [state.jupia, state.ilha];
  state.reports.splice(0, 1, report('flushing', 17, '1', { reportType: 'RCPU' }));
  assert.equal(quantity((await computeDivisionProgressDetails('p', state.ilha, state.options())).progress, 'FLUSHING'), 17);
});

test('mudar a janela da divisão atualiza a revisão e a atribuição no projeto completo', async () => {
  const state = fixture();
  state.reports.push(report('flushing', 17));
  const read = async () => (await computeProgressDetailsForProjects(['p'], { ...state.options(), currentOnly: true })).get('p');
  const before = await read();
  state.jupia.endDate = '2026-10-21';
  const after = await read();
  assert.notEqual(after.progressRevision, before.progressRevision);
  assert.equal(quantity(before.progress.scopeGroups.find(group => group.scopeName === 'Jupiá'), 'FLUSHING'), 17);
  assert.equal(quantity(after.progress.scopeGroups.find(group => group.scopeName === 'Jupiá'), 'FLUSHING'), 0);
});
