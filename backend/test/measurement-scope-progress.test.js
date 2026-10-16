import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addRealizedService, buildProgress, buildProgressSlices, buildRequiredWeeklyProgress,
  isRealizedSourceReport, isServiceFinalized
} from '../src/lib/acompanhamento/avanco.js';
import { combineProgressBreakdowns } from '../src/lib/acompanhamento/progress-groups.js';
import { extractServiceMeasurements } from '../src/lib/acompanhamento/realized-measurements.js';

const equipment = number => `Unidade Geradora ${number}`;
function planned(scopeName, number) {
  return { scopeName, serviceType: 'FILTRAGEM', weight: 100, systems: [45000, 5000].map((quantity, index) => {
    const projectSystem = { id: `${scopeName}-${number}-${index}`, equipment: equipment(number),
      name: `${scopeName} - ${index ? 'Sistema hidráulico da comporta' : 'Sistema de regulação e mancais'}`, aliases: [] };
    return { projectSystemId: projectSystem.id, projectSystem, systemType: 'OLEO', unit: 'L', quantity };
  }) };
}
const scope = () => [planned('Jupiá', '01'), planned('Jupiá', '02'), planned('Jupiá', '14'), planned('Ilha Solteira', '14')];
const report = (patch = {}) => ({ serviceType: 'filtragem', system: 'Regulador de Velocidade', finalized: true,
  reportType: 'RDO', reportDate: '2026-10-03', extraData: { equipmentId: equipment('14'), __scopeName: 'Jupiá',
    __scopeKey: '"Jupiá"', __projectSystemId: 'sistema-do-cadastro-anterior', volumeOleo: 1800, volumeOleoUnit: 'L', ...patch } });
const calc = (plannedServices, reports) => {
  const realized = new Map();
  reports.filter(item => isServiceFinalized(item) && isRealizedSourceReport(item)).forEach(item => addRealizedService(realized, item));
  return buildProgress(plannedServices, realized);
};
const slice = (slices, scopeName, number) => slices.slices[slices.lookup[`${scopeName}|${number ? equipment(number).toLowerCase() : ''}`]];

test('5719: Jupiá UG14 recebe 3.600/50.000 L sem vínculo do sistema, nas estatísticas, curvas e ritmo', () => {
  const plannedServices = scope();
  const reports = [report(), { ...report(), reportDate: '2026-10-08' }, { ...report(), finalized: false },
    { ...report(), reportType: 'RCPU', specialConditions: { parentRdoId: 'rdo' } }];
  const before = structuredClone({ plannedServices, reports });
  const current = calc(plannedServices, reports);
  const jupia = current.scopeGroups.find(group => group.scopeName === 'Jupiá');
  assert.equal(jupia.services[0].totals[0].realizedQty, 3600);
  assert.equal(current.scopeGroups.find(group => group.scopeName === 'Ilha Solteira').services[0].totals[0].realizedQty, 0);
  const slices = buildProgressSlices(plannedServices, reports);
  const ug14 = slice(slices, 'jupia', '14');
  assert.deepEqual(ug14.progress.services[0].totals, [
    { systemType: 'OLEO', unit: 'L', plannedQty: 50000, realizedQty: 3600, pct: 7.2 }
  ]);
  assert.equal(ug14.progress.progressPct, 7.2);
  assert.deepEqual(ug14.progress.services[0].systems.map(row => row.realizedQty), [0, 0], 'não inventa rateio entre os sistemas');
  assert.deepEqual(ug14.progressHistory.map(point => point.progressPct), [3.6, 7.2]);
  assert.deepEqual(ug14.dailyProgressHistory.map(point => point.services[0].quantities), [
    [{ unit: 'L', realizedQty: 1800 }], [{ unit: 'L', realizedQty: 3600 }]
  ]);
  for (const [name, number] of [['jupia', '01'], ['jupia', '02'], ['ilha solteira', '14']]) {
    assert.equal(slice(slices, name, number).progress.progressPct, 0);
  }
  const weekly = buildRequiredWeeklyProgress(ug14.progress, { referenceDate: '2026-10-08', expectedEndDate: '2026-10-15' });
  assert.equal(weekly.services[0].totals[0].requiredQtyPerWeek, 46400);
  assert.deepEqual(current.pendingMeasurements[0].attributedScope, { scopeName: 'Jupiá', equipment: equipment('14') });
  assert.deepEqual({ plannedServices, reports }, before);
});

test('conciliar depois redistribui os litros para o sistema sem alterar nenhum total nem a curva', () => {
  const plannedServices = scope(), reports = [report()];
  const before = buildProgressSlices(plannedServices, reports);
  const linked = [report({ __projectSystemId: plannedServices[2].systems[0].projectSystemId })];
  const after = buildProgressSlices(plannedServices, linked);
  const original = slice(before, 'jupia', '14'), reconciled = slice(after, 'jupia', '14');
  assert.deepEqual(reconciled.progress.services[0].totals, original.progress.services[0].totals);
  assert.deepEqual(reconciled.progressHistory, original.progressHistory);
  assert.deepEqual(reconciled.dailyProgressHistory, original.dailyProgressHistory);
  assert.deepEqual(reconciled.progress.services[0].systems.map(row => row.realizedQty), [1800, 0]);
  assert.equal(reconciled.progress.pendingMeasurements.length, 0);
  const grouped = combineProgressBreakdowns([calc(plannedServices, reports), calc(plannedServices, reports)]);
  assert.equal(grouped.scopeGroups.find(group => group.scopeName === 'Jupiá').services[0].totals[0].realizedQty, 3600);
});

test('cadastro completo impede atribuir UG14 sem usina à primeira opção que restou no filtro', () => {
  const plannedServices = scope();
  const reports = [report({ __scopeName: undefined, __scopeKey: undefined })];
  const current = calc(plannedServices, reports);
  assert.equal(current.services[0].totals[0].realizedQty, 1800);
  assert.equal(current.pendingMeasurements[0].attributedScope, undefined);
  for (const entry of buildProgressSlices(plannedServices, reports).slices) {
    assert.equal(entry.progress.progressPct, 0);
  }
});

test('escopo e UG reconhecem acentos, caixa, abreviação e zeros; chave histórica também identifica escopo', () => {
  const plannedServices = scope();
  for (const patch of [
    { __scopeName: ' jupia ', equipmentId: 'UG014' },
    { __scopeName: undefined, __scopeKey: '"Jupiá"', equipmentId: 'UG 14' }
  ]) {
    const reports = [report(patch)];
    assert.equal(slice(buildProgressSlices(plannedServices, reports), 'jupia', '14').progress.services[0].totals[0].realizedQty, 1800);
  }
  assert.equal(extractServiceMeasurements(report({ __scopeName: undefined, __scopeKey: 'inválida' }))[0].scopeName, undefined);
});

test('escopo inexistente, outra UG ou falta de equipamento não atribuem quantidades a um destino arbitrário', () => {
  const plannedServices = scope();
  for (const patch of [{ __scopeName: 'Outra usina' }, { equipmentId: equipment('03') }, { equipmentId: '' }]) {
    const reports = [report(patch)];
    const result = calc(plannedServices, reports);
    assert.equal(result.services[0].totals[0].realizedQty, 1800);
    assert.equal(result.pendingMeasurements[0].attributedScope, undefined);
    assert.equal(slice(buildProgressSlices(plannedServices, reports), 'jupia', '14').progress.progressPct, 0);
  }
});

test('sem escopo informado, UG e serviço que identificam um único escopo bastam para contabilizar', () => {
  const plannedServices = scope().slice(0, 3);
  const reports = [report({ __scopeName: undefined, __scopeKey: undefined })];
  assert.equal(calc(plannedServices, reports).scopeGroups[0].services[0].totals[0].realizedQty, 1800);
  assert.equal(slice(buildProgressSlices(plannedServices, reports), '', '14').progress.progressPct, 3.6);
});

test('vínculo individual explícito continua tendo precedência sobre os nomes originais do relatório', () => {
  const plannedServices = scope();
  const reports = [report({ __projectSystemId: plannedServices[3].systems[1].projectSystemId })];
  const slices = buildProgressSlices(plannedServices, reports);
  assert.equal(slice(slices, 'ilha solteira', '14').progress.progressPct, 3.6);
  assert.equal(slice(slices, 'jupia', '14').progress.progressPct, 0);
});
