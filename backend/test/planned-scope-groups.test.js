import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDistinctScopeMeasurements } from '../src/lib/acompanhamento/scope-groups.js';
import { addRealizedService, buildProgress, buildProgressHistory, buildRequiredWeeklyProgress, normalizeRdoServiceType } from '../src/lib/acompanhamento/avanco.js';
import { combineProgressBreakdowns } from '../src/lib/acompanhamento/progress-groups.js';

const systems = ['01', '02'].map(ug => ({ id: `s${ug}`, equipment: `Unidade Geradora ${ug}`, name: 'Kaplan', aliases: [] }));
const row = (system, patch = {}) => ({ projectSystemId: system.id, projectSystem: system, equipment: system.equipment, systemName: system.name,
  systemType: 'TUBULACAO', diameter: '2', diameterUnit: 'pol', unit: 'M', quantity: 100, ...patch });
const service = (scopeName, systems, patch = {}) => ({ scopeName, serviceType: 'LIMPEZA_QUIMICA', weight: 50, systems, ...patch });
const validate = services => assertDistinctScopeMeasurements(services, normalizeRdoServiceType);
const withoutGroups = ({ scopeGroups: _groups, ...progress }) => progress;
const realize = (system, quantity = 20, diameter = '2') => ({ serviceType: 'limpeza', finalized: true, reportDate: '2026-01-01', system: system.name,
  extraData: { equipmentId: system.equipment, tubes: [{ d: diameter, unit: 'pol', c: quantity, lengthUnit: 'm' }] } });
const calc = (scope, reports) => { const realized = new Map(); reports.forEach(report => addRealizedService(realized, report)); return buildProgress(scope, realized); };

test('scope names only project existing progress: totals, weights, history and weekly pace remain unchanged', () => {
  const named = [service('UG 01', [row(systems[0])]), service('UG 02', [row(systems[1])])];
  const unnamed = named.map(({ scopeName: _name, ...item }) => item);
  const reports = [realize(systems[0], 150), realize(systems[1], 20)];
  validate(named);
  const plain = calc(unnamed, reports), grouped = calc(named, reports);
  assert.deepEqual(withoutGroups(grouped), plain);
  assert.deepEqual(grouped.scopeGroups.map(group => group.scopeName), ['UG 01', 'UG 02']);
  assert.deepEqual(grouped.scopeGroups.map(group => group.services[0].executionPct), [100, 20]);
  assert.deepEqual(grouped.scopeGroups.flatMap(group => group.services.flatMap(item => item.systems)), grouped.services[0].systems);
  const dates = { expectedEndDate: '2026-01-15', referenceDate: '2026-01-01' };
  const weekly = buildRequiredWeeklyProgress(grouped, dates);
  assert.deepEqual(withoutGroups(weekly), buildRequiredWeeklyProgress(plain, dates));
  assert.deepEqual(weekly.scopeGroups.map(group => group.services[0].systems[0].requiredQtyPerWeek), [null, 40]);
  assert.deepEqual(buildProgressHistory(named, reports), buildProgressHistory(unnamed, reports));
});

test('different diameters may belong to different scopes without consuming a report twice', () => {
  const scope = [service('Alimentação', [row(systems[0])]), service('Retorno', [row(systems[0], { diameter: '3' })])];
  validate(scope);
  const progress = calc(scope, [realize(systems[0], 25), realize(systems[0], 60, '3')]);
  assert.deepEqual(progress.scopeGroups.map(group => group.services[0].systems[0].realizedQty), [25, 60]);
  assert.equal(progress.progressPct, 42.5);
});

test('rejects equivalent, wildcard and legacy-global measurements across scopes, but allows repetition inside one scope', () => {
  for (const [first, second] of [
    [row(systems[0]), row(systems[0], { diameter: '2.0' })],
    [row(systems[0], { diameter: '1 1/2' }), row(systems[0], { diameter: '1.5' })],
    [row(systems[0], { diameter: '' }), row(systems[0])],
    [row(systems[0]), row(systems[0], { diameter: '' })],
    [row(systems[0], { systemType: 'SISTEMA', unit: 'UN' }), row(systems[0], { systemType: 'SISTEMA', unit: 'UN' })],
    [{ systemType: 'TUBULACAO', quantity: 20, diameter: '2' }, { systemType: 'TUBULACAO', quantity: 30, diameter: '3' }],
    [row(systems[0]), row(systems[0], { equipment: ' unidade geradora 01 ', systemName: 'KAPLAN', projectSystemId: null })]
  ]) {
    assert.throws(() => validate([service('Principal', [first]), service('Adicional', [second])]), /Principal.*Adicional.*único escopo/);
    assert.doesNotThrow(() => validate([service('Principal', [first]), service('Principal', [second])]));
  }
  assert.throws(() => validate([service(null, [row(systems[0])]), service('Novo', [row(systems[0])])]), /Sem escopo definido.*Novo/);
  assert.doesNotThrow(() => validate([service('A', [row(systems[0])]), service('B', [row(systems[1])])]));
  assert.doesNotThrow(() => validate([service('A', [row(systems[0])]), service('B', [row(systems[0], { diameterUnit: 'mm' })])]));
  assert.doesNotThrow(() => validate([service('A', [row(systems[0])]), service('B', [row(systems[0])], { serviceType: 'TESTE_PRESSAO' })]));
});

test('unnamed services remain visible alongside named scopes and mission groups preserve the scope hierarchy', () => {
  const first = calc([service('Principal', [row(systems[0])])], [realize(systems[0])]);
  const second = calc([service(null, [row(systems[1])])], [realize(systems[1], 40)]);
  const group = combineProgressBreakdowns([first, second]);
  assert.deepEqual(group.scopeGroups.map(item => item.scopeName), ['Principal', null]);
  assert.deepEqual(group.scopeGroups.map(item => item.services[0].systems[0].realizedQty), [20, 40]);
  assert.deepEqual(withoutGroups(group), combineProgressBreakdowns([withoutGroups(first), second]));
  assert.equal(second.scopeGroups, undefined);
});
