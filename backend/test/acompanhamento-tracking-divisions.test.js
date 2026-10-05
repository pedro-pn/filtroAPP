import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dateInDivision, divisionCandidates, divisionDateWhere, divisionKey,
  getTrackingDivisions, setTrackingDivisions, storedDivisionRows, validateDivisionRows
} from '../src/lib/acompanhamento/tracking-divisions.js';
import { buildProjectCalendarPeriod, divisionLaborAllocation } from '../src/lib/acompanhamento/project-detail.js';
import { selectDivisionPlannedServices } from '../src/lib/acompanhamento/avanco.js';

const scopeKey = divisionKey('SCOPE', 'Escopo A');
const equipmentKey = divisionKey('EQUIPMENT', 'Escopo A', 'ug 01');
const secondEquipmentKey = divisionKey('EQUIPMENT', 'Escopo A', 'ug 02');
const oldSystemKey = divisionKey('SYSTEM', 'Escopo A', 'system-1');
const candidateServices = [{ scopeName: 'Escopo A', systems: [
  { projectSystemId: 'system-1', projectSystem: { equipment: 'UG 01', name: 'Mancal' } },
  { projectSystemId: 'system-2', projectSystem: { equipment: 'UG 01', name: 'Regulador' } },
  { projectSystemId: 'system-3', projectSystem: { equipment: 'UG 02', name: 'Mancal' } }
] }, { scopeName: 'Escopo A', systems: [
  { projectSystemId: 'system-1', projectSystem: { equipment: 'UG 01', name: 'Mancal' } }
] }];

test('divisões agrupam sistemas pelo equipamento do cliente em cada escopo', () => {
  const candidates = divisionCandidates(candidateServices);
  assert.deepEqual(candidates.map(item => item.key), [scopeKey]);
  assert.deepEqual(candidates[0].equipments.map(item => item.key), [equipmentKey, secondEquipmentKey]);
  assert.deepEqual(candidates[0].equipments.map(item => item.systemCount), [2, 1]);
  assert.throws(() => validateDivisionRows(candidates, [{ key: 'invalida', startDate: '2026-09-01' }]), /desconhecida/);
  assert.throws(() => validateDivisionRows(candidates, [{ key: oldSystemKey, startDate: '2026-09-01' }]), /desconhecida/);
  assert.throws(() => validateDivisionRows(candidates, [{ key: scopeKey, startDate: '2026-09-12', endDate: '2026-09-11' }]), /data final/);
  assert.throws(() => validateDivisionRows(candidates, [{ key: scopeKey, startDate: '2026-02-30' }]), /datas válidas/);
  assert.deepEqual(validateDivisionRows(candidates, [{ key: equipmentKey, startDate: '2026-09-01', plannedCost: 200 }]), [{
    key: equipmentKey, startDate: '2026-09-01', endDate: null, mobilizationDate: null,
    plannedCost: 200, plannedRevenue: null, plannedHours: null, plannedDays: null
  }]);
});

test('recorte do equipamento inclui todos os seus sistemas e exclui outra unidade', () => {
  const selected = selectDivisionPlannedServices(candidateServices, equipmentKey);
  assert.deepEqual(selected.flatMap(service => service.systems.map(row => row.projectSystemId)), ['system-1', 'system-2', 'system-1']);
  assert.equal(selectDivisionPlannedServices(candidateServices, scopeKey).length, 2);
});

test('janela inclui as duas datas e um fim aberto termina hoje', () => {
  const division = { startDate: '2026-09-01', endDate: '2026-09-05' };
  assert.equal(dateInDivision('2026-09-01', division), true);
  assert.equal(dateInDivision('2026-09-05', division), true);
  assert.equal(dateInDivision('2026-09-06', division), false);
  assert.equal(dateInDivision('2026-09-03', { startDate: '2026-09-01', endDate: null }, new Date('2026-09-03T14:00:00Z')), true);
  assert.equal(dateInDivision('2026-09-04', { startDate: '2026-09-01', endDate: null }, new Date('2026-09-03T14:00:00Z')), false);
  assert.equal(dateInDivision('2026-09-04', { startDate: '2026-09-01', endDate: '2026-09-10' }, new Date('2026-09-03T14:00:00Z')), false);
  assert.deepEqual(divisionDateWhere('date', division), { date: {
    gte: new Date('2026-09-01T00:00:00Z'), lt: new Date('2026-09-06T00:00:00Z')
  } });
});

test('custo calculado é proporcional às horas apropriadas de cada mês no período', () => {
  const rate = {
    analyticalAllocationTrail: [
      { date: '2026-09-01', costNormalHours: 8, allocations: [{ projectId: 'p', weight: 1 }] },
      { date: '2026-09-02', costNormalHours: 8, allocations: [{ projectId: 'p', weight: 1 }] }
    ],
    months: [{ month: '2026-09', analyticalByProject: { p: { hours: 16, cost: 320, costBase: 300 } } }]
  };
  const labor = { pontoImport: {}, byCollaboratorId: new Map([['c1', rate]]) };
  const result = divisionLaborAllocation(labor, 'p', { startDate: '2026-09-02', endDate: '2026-09-02' });
  assert.deepEqual(result.total, { laborCost: 160, laborCostBase: 150, hours: 8 });
  assert.deepEqual(result.byCollaboratorId.get('c1'), { cost: 160, costBase: 150, hours: 8, travelHours: 0 });
});

test('divisões antigas dos sistemas são reunidas no equipamento sem criar aba de escopo', async () => {
  const oldSecondSystemKey = divisionKey('SYSTEM', 'Escopo A', 'system-2');
  const migrated = storedDivisionRows(divisionCandidates(candidateServices), candidateServices, [
    { key: oldSystemKey, startDate: '2026-09-02', endDate: '2026-09-04', plannedCost: 100, plannedHours: 5 },
    { key: oldSecondSystemKey, startDate: '2026-09-01', endDate: null, plannedCost: 200, plannedHours: 8 }
  ]);
  assert.deepEqual(migrated, [{ key: equipmentKey, startDate: '2026-09-01', endDate: null, mobilizationDate: '2026-09-01',
    plannedCost: 300, plannedRevenue: null, plannedHours: 13, plannedDays: null }]);

  let stored = [];
  const fake = {
    $transaction: async callback => callback(fake),
    project: {
      findFirst: async () => ({ trackingDivisions: stored }),
      update: async ({ data }) => { stored = data.trackingDivisions; }
    },
    projectPlannedService: { findMany: async () => candidateServices }
  };
  const row = { key: equipmentKey, startDate: '2026-09-01', endDate: '2026-09-05', mobilizationDate: '2026-09-03', plannedCost: 400 };
  await setTrackingDivisions('p', [row], fake);
  assert.equal(stored.length, 1);
  const result = await getTrackingDivisions('p', fake);
  assert.deepEqual(result.divisions.map(item => item.key), [equipmentKey]);
  assert.equal(result.divisions[0].mobilizationDate, '2026-09-03');
});

test('mobilização inicial conta os dias corridos sem alterar a janela de dados da divisão', () => {
  const division = { startDate: '2026-09-01', endDate: '2026-09-30', mobilizationDate: '2026-09-10' };
  assert.deepEqual(buildProjectCalendarPeriod({ division, startDate: '2026-08-01', referenceDate: new Date('2026-09-15T15:00:00Z') }), {
    startDate: '2026-09-10', elapsed: 5
  });
  assert.equal(dateInDivision('2026-09-02', division, new Date('2026-09-15')), true);
  assert.equal(buildProjectCalendarPeriod({ division, referenceDate: new Date('2026-09-05') }).elapsed, 0);
  assert.equal(buildProjectCalendarPeriod({ division: { ...division, mobilizationDate: null }, referenceDate: new Date('2026-09-15') }).elapsed, 14);
  assert.equal(buildProjectCalendarPeriod({ startDate: '2026-09-01', referenceDate: new Date('2026-09-15') }).elapsed, 14);
  assert.equal(buildProjectCalendarPeriod({ referenceDate: new Date('2026-09-15') }).elapsed, null);
});

test('valida a mobilização inicial e aceita início anterior ao recorte de dados', () => {
  const candidates = divisionCandidates(candidateServices);
  const row = { key: scopeKey, startDate: '2026-09-10', endDate: '2026-09-30' };
  assert.throws(() => validateDivisionRows(candidates, [{ ...row, mobilizationDate: '2026-02-30' }]), /data válida/);
  assert.throws(() => validateDivisionRows(candidates, [{ ...row, mobilizationDate: '2026-10-01' }]), /anterior à data final/);
  assert.equal(validateDivisionRows(candidates, [{ ...row, mobilizationDate: '2026-09-01' }])[0].mobilizationDate, '2026-09-01');
});
