import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildProgressSlices,
  buildRequiredWeeklyProgress,
  NO_SCOPE_KEY,
  splitPlannedServices
} from '../src/lib/acompanhamento/avanco.js';

const ug = number => ({ id: `system-${number}`, projectId: 'p', equipment: `Unidade Geradora ${number}`, name: 'Mancal Escora', aliases: [], revision: 1 });
const UG01 = ug('01'), UG02 = ug('02'), UG14 = ug('14');
const K01 = 'unidade geradora 01', K02 = 'unidade geradora 02', K14 = 'unidade geradora 14';
const row = (system, quantity = 100) => ({
  projectSystemId: system.id, projectSystem: system, systemType: 'TUBULACAO', unit: 'M', diameter: '2', diameterUnit: 'pol', quantity
});
const planned = (system, { serviceType = 'LIMPEZA_QUIMICA', weight = 10, quantity = 100, scopeName = null } = {}) =>
  ({ serviceType, weight, scopeName, systems: [row(system, quantity)] });
const done = (system, c, reportDate = '2026-07-01', serviceType = 'limpeza') => ({
  serviceType, finalized: true, system: system.name, reportDate,
  extraData: { equipmentId: system.equipment, system: system.name, tubes: [{ d: '2', unit: 'pol', c, lengthUnit: 'm' }] }
});
// Recorte pelo par "escopo|equipamento" ('' = todos), como o front resolve a seleção.
const sliceOf = (result, scopeKey, equipmentKey) => {
  const index = result.lookup[`${scopeKey}|${equipmentKey}`];
  return typeof index === 'number' ? result.slices[index] : index;
};

test('recorte por equipamento: cada UG usa só as metas e o realizado dela', () => {
  const result = buildProgressSlices([planned(UG01), planned(UG02)], [done(UG01, 50), done(UG02, 20, '2026-07-02')]);

  assert.deepEqual(result.equipments.map(item => item.name), ['Unidade Geradora 01', 'Unidade Geradora 02']);
  assert.deepEqual(result.scopes, []);
  assert.equal(sliceOf(result, '', K01).progress.progressPct, 50);
  assert.equal(sliceOf(result, '', K02).progress.progressPct, 20);
});

test('recorte por equipamento: o peso de cada serviço vem do serviço daquela UG, não da soma das UGs', () => {
  const scope = [
    planned(UG01, { serviceType: 'LIMPEZA_QUIMICA', weight: 10 }), planned(UG01, { serviceType: 'FLUSHING', weight: 30 }),
    planned(UG02, { serviceType: 'LIMPEZA_QUIMICA', weight: 60 })
  ];
  const { progress } = sliceOf(buildProgressSlices(scope, [done(UG01, 100)]), '', K01);

  // UG01: limpeza 100% (peso 10) e flushing 0% (peso 30) => 25%; o peso 60 da UG02 não entra.
  assert.equal(progress.progressPct, 25);
  assert.deepEqual(progress.services.map(service => [service.serviceType, service.weight]), [['LIMPEZA_QUIMICA', 10], ['FLUSHING', 30]]);
});

test('recorte por equipamento: medição de outra UG não avança a UG filtrada', () => {
  const result = buildProgressSlices([planned(UG01), planned(UG02)], [done(UG02, 80)]);

  assert.equal(sliceOf(result, '', K01).progress.progressPct, 0);
  assert.equal(sliceOf(result, '', K02).progress.progressPct, 80);
  // Sem medição própria a UG fica em 0% (platô), nunca herda o avanço da outra UG.
  assert.ok(sliceOf(result, '', K01).progressHistory.every(point => point.progressPct === 0));
});

test('recorte por equipamento: histórico semanal acompanha só a UG (ponto na última data de RDO da semana)', () => {
  const services = [done(UG01, 30, '2026-07-01'), done(UG02, 90, '2026-07-02'), done(UG01, 30, '2026-07-10')];
  const result = buildProgressSlices([planned(UG01), planned(UG02)], services, { startDate: '2026-06-30T00:00:00.000Z' });

  assert.deepEqual(sliceOf(result, '', K01).progressHistory, [
    { date: '2026-06-30', progressPct: 0 },
    { date: '2026-07-02', progressPct: 30 },
    { date: '2026-07-10', progressPct: 60 }
  ]);
  assert.deepEqual(sliceOf(result, '', K02).progressHistory, [
    { date: '2026-06-30', progressPct: 0 },
    { date: '2026-07-02', progressPct: 90 },
    { date: '2026-07-10', progressPct: 90 } // platô: UG02 parada enquanto a UG01 avança
  ]);
});

test('recorte por equipamento: ritmo semanal usa o avanço e as quantidades da UG', () => {
  const { progress } = sliceOf(buildProgressSlices([planned(UG01), planned(UG02)], [done(UG01, 50)]), '', K01);
  const weekly = buildRequiredWeeklyProgress(progress, { startDate: '2026-07-01', expectedEndDate: '2026-07-15', referenceDate: '2026-07-01' });

  assert.equal(weekly.remainingPctPoints, 50);
  assert.equal(weekly.requiredPctPointsPerWeek, 25);
  assert.deepEqual(weekly.services[0].systems.map(system => [system.equipment, system.remainingQty]), [['Unidade Geradora 01', 50]]);
});

test('sem o que filtrar: um só escopo e um só equipamento, ou escopo legado sem sistema, não geram recortes', () => {
  const legacy = { serviceType: 'FLUSHING', weight: 1, systems: [{ systemType: 'OLEO', unit: 'L', quantity: 10 }] };
  assert.equal(buildProgressSlices([planned(UG01)], [done(UG01, 50)]), null);
  assert.equal(buildProgressSlices([planned(UG01), legacy], []), null);
  assert.equal(splitPlannedServices([legacy]), null);
});

test('recorte por equipamento: serviço com várias UGs entra em cada uma só com as linhas dela', () => {
  const shared = { serviceType: 'LIMPEZA_QUIMICA', weight: 10, systems: [row(UG01, 100), row(UG02, 200)] };
  const { entries, lookup } = splitPlannedServices([shared]);

  assert.deepEqual(entries.map(entry => [entry.services[0].weight, entry.services[0].systems.length]), [[10, 1], [10, 1]]);
  assert.deepEqual(entries.map(entry => entry.services[0].systems[0].quantity), [100, 200]);
  assert.deepEqual(lookup, { [`|${K01}`]: 0, [`|${K02}`]: 1 });
  assert.equal(shared.systems.length, 2, 'não altera o escopo original');
});

test('recorte por equipamento: nomes com caixa/acento/espaços diferentes contam como o mesmo equipamento', () => {
  const variant = { ...UG01, id: 'system-01b', name: 'Mancal Guia', equipment: 'unidade  geradora 01' };
  const split = splitPlannedServices([planned(UG01), planned(variant), planned(UG02)]);

  assert.deepEqual(split.equipments.map(item => item.name), ['Unidade Geradora 01', 'Unidade Geradora 02']);
  assert.equal(split.entries[split.lookup[`|${K01}`]].services.length, 2);
});

test('recorte por escopo: cada escopo usa só os serviços, pesos e realizado dele', () => {
  const scope = [
    planned(UG01, { scopeName: 'Casa de força', weight: 10 }),
    planned(UG02, { scopeName: 'Vertedouro', weight: 30, serviceType: 'FLUSHING' }),
    planned(UG02, { scopeName: 'Vertedouro', weight: 10, serviceType: 'LIMPEZA_QUIMICA' })
  ];
  const result = buildProgressSlices(scope, [done(UG01, 40), done(UG02, 100, '2026-07-02', 'limpeza')]);

  assert.deepEqual(result.scopes.map(item => item.name), ['Casa de força', 'Vertedouro']);
  assert.equal(sliceOf(result, 'casa de forca', '').progress.progressPct, 40);
  // Vertedouro: limpeza 100% (peso 10) e flushing 0% (peso 30) => 25%.
  assert.equal(sliceOf(result, 'vertedouro', '').progress.progressPct, 25);
});

test('recorte por escopo: combinação idêntica a outra reaproveita a mesma entrada e vazia não existe', () => {
  const scope = [planned(UG01, { scopeName: 'A' }), planned(UG02, { scopeName: 'B' })];
  const { lookup, entries } = splitPlannedServices(scope);

  assert.equal(entries.length, 2);
  assert.equal(lookup['a|'], lookup[`|${K01}`]);
  assert.equal(lookup['a|'], lookup[`a|${K01}`]);
  assert.equal(lookup['b|'], lookup[`|${K02}`]);
  assert.equal(lookup[`a|${K02}`], undefined, 'escopo A não tem a UG 02');
  assert.equal(lookup[`b|${K01}`], undefined, 'escopo B não tem a UG 01');
});

test('recorte combinado: escopo × equipamento calcula só as linhas da UG dentro do escopo', () => {
  // Cada medição pertence a um único escopo: o escopo B usa outro sistema da UG01.
  const guide = { ...UG01, id: 'system-01-guia', name: 'Mancal Guia' };
  const scope = [
    planned(UG01, { scopeName: 'A' }), planned(UG02, { scopeName: 'A' }), planned(guide, { scopeName: 'B' })
  ];
  const result = buildProgressSlices(scope, [done(UG01, 100)]);

  assert.equal(sliceOf(result, 'a', K01).progress.progressPct, 100, 'UG01 no escopo A: 100 m de 100 m');
  assert.equal(sliceOf(result, 'b', K01).progress.progressPct, 0, 'UG01 no escopo B: nada medido');
  assert.equal(sliceOf(result, '', K01).progress.progressPct, 50, 'UG01 nos dois escopos: 100 m de 200 m');
  assert.equal(sliceOf(result, 'a', '').progress.progressPct, 50, 'escopo A com as duas UGs: 100 m de 200 m');
  assert.equal(sliceOf(result, 'a', K02).progress.progressPct, 0);
  assert.equal(sliceOf(result, 'b', K02), undefined, 'a UG02 não existe no escopo B');
  assert.notEqual(result.lookup[`a|${K01}`], result.lookup[`|${K01}`], 'UG01 no escopo A difere da UG01 em todo o projeto');
});

test('recorte por escopo: serviços sem nome de escopo viram a opção "Sem escopo definido"', () => {
  const split = splitPlannedServices([planned(UG01, { scopeName: 'A' }), planned(UG01, { scopeName: null })]);

  assert.deepEqual(split.scopes, [{ key: 'a', name: 'A' }, { key: NO_SCOPE_KEY, name: 'Sem escopo definido' }]);
  assert.notEqual(split.lookup['a|'], split.lookup[`${NO_SCOPE_KEY}|`]);
});

test('recorte por escopo: escopo sem meta medível não vira opção', () => {
  const noTarget = { serviceType: 'FILTRAGEM', weight: 5, scopeName: 'C', systems: [{ ...row(UG01), quantity: null }] };
  const two = splitPlannedServices([planned(UG01, { scopeName: 'A' }), planned(UG02, { scopeName: 'B' }), noTarget]);
  assert.deepEqual(two.scopes.map(item => item.name), ['A', 'B']);

  // Sobrando um só escopo medível e um só equipamento, não há filtro a oferecer.
  assert.equal(splitPlannedServices([planned(UG01, { scopeName: 'A' }), noTarget]), null);
});
