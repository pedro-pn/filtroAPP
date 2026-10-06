import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dateInDivision, divisionCandidates, divisionDateWhere, divisionKey, divisionLaborPeriod,
  getTrackingDivisions, setTrackingDivision, setTrackingDivisions, storedDivisionRows, validateDivisionRows
} from '../src/lib/acompanhamento/tracking-divisions.js';
import { buildProjectCalendarPeriod, buildProjectTimelineDates, buildProjectDetailCollaborator, divisionLaborAllocation } from '../src/lib/acompanhamento/project-detail.js';
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

test('editar uma divisão preserva as datas do projeto completo e das demais divisões', async () => {
  const globalDates = { startDate: '2026-08-01', mobilizationDate: '2026-07-28', demobilizationDate: '2026-10-30' };
  const sibling = { key: secondEquipmentKey, startDate: '2026-09-12', endDate: '2026-10-01', mobilizationDate: '2026-09-10', plannedDays: 22 };
  let project = { ...globalDates, trackingDivisions: [
    { key: scopeKey, startDate: '2026-09-01', endDate: null, mobilizationDate: '2026-08-29' }, sibling
  ] };
  const fake = {
    $transaction: async callback => callback(fake),
    project: {
      findFirst: async () => project,
      update: async ({ data }) => {
        assert.deepEqual(Object.keys(data), ['trackingDivisions']);
        project = { ...project, ...data };
      }
    },
    projectPlannedService: { findMany: async () => candidateServices }
  };
  const result = await setTrackingDivision('p', { key: scopeKey, startDate: '2026-09-08', endDate: '2026-09-30', mobilizationDate: '2026-09-06' }, fake);
  assert.deepEqual(result.divisions[1], sibling);
  assert.equal(result.divisions[0].mobilizationDate, '2026-09-06');
  assert.deepEqual(Object.fromEntries(Object.keys(globalDates).map(key => [key, project[key]])), globalDates);

  const saved = structuredClone(project.trackingDivisions);
  await assert.rejects(setTrackingDivision('p', { key: scopeKey, startDate: '2026-09-31' }, fake), /datas válidas/);
  await assert.rejects(setTrackingDivision('p', { key: 'inexistente', startDate: '2026-09-01' }, fake), /desconhecida/);
  assert.deepEqual(project.trackingDivisions, saved);
});

test('linha do tempo separa a mobilização do início e não herda datas do projeto completo', () => {
  const project = { startDate: '2026-08-01', mobilizationDate: '2026-07-28' };
  const division = { startDate: '2026-09-10', mobilizationDate: '2026-09-04' };
  assert.deepEqual(buildProjectTimelineDates({ ...project, division }), division);
  assert.deepEqual(buildProjectTimelineDates(project), project);
  assert.deepEqual(buildProjectTimelineDates({ ...project, division: { startDate: '2026-09-10' } }), {
    mobilizationDate: null, startDate: '2026-09-10'
  });
  assert.deepEqual(buildProjectTimelineDates(), { mobilizationDate: null, startDate: null });
  assert.deepEqual(buildProjectTimelineDates({ startDate: '2027-01-01', mobilizationDate: '2026-12-20', division }), division);
  assert.equal(buildProjectCalendarPeriod({ division, startDate: project.startDate, referenceDate: new Date('2026-09-15T12:00:00Z') }).elapsed, 11);
});

test('divisões agrupam sistemas pelo equipamento do cliente em cada escopo', () => {
  const candidates = divisionCandidates(candidateServices);
  assert.deepEqual(candidates.map(item => item.key), [scopeKey]);
  assert.deepEqual(candidates[0].equipments.map(item => item.key), [equipmentKey, secondEquipmentKey]);
  assert.deepEqual(candidates[0].equipments.map(item => item.systemCount), [2, 1]);
  assert.throws(() => validateDivisionRows(candidates, [{ key: 'invalida', startDate: '2026-09-01' }]), /desconhecida/);
  assert.throws(() => validateDivisionRows(candidates, [{ key: oldSystemKey, startDate: '2026-09-01' }]), /desconhecida/);
  assert.throws(() => validateDivisionRows(candidates, [{ key: scopeKey, startDate: '2026-09-12', endDate: '2026-09-11' }]), /fim do escopo/);
  assert.throws(() => validateDivisionRows(candidates, [{ key: scopeKey, startDate: '2026-02-30' }]), /datas válidas/);
  assert.deepEqual(validateDivisionRows(candidates, [{ key: equipmentKey, startDate: '2026-09-01', mobilizationDate: '2026-08-28', plannedCost: 200 }]), [{
    key: equipmentKey, startDate: '2026-09-01', endDate: null, mobilizationDate: '2026-08-28',
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
  const result = divisionLaborAllocation(labor, 'p', { startDate: '2026-09-02', mobilizationDate: '2026-09-02', endDate: '2026-09-02' });
  assert.deepEqual(result.total, { laborCost: 160, laborCostBase: 150, hours: 8 });
  assert.deepEqual(result.byCollaboratorId.get('c1'), { cost: 160, costBase: 150, hours: 8, travelHours: 0 });
});

test('divisões antigas dos sistemas são reunidas no equipamento sem criar aba de escopo', async () => {
  const oldSecondSystemKey = divisionKey('SYSTEM', 'Escopo A', 'system-2');
  const migrated = storedDivisionRows(divisionCandidates(candidateServices), candidateServices, [
    { key: oldSystemKey, startDate: '2026-09-02', endDate: '2026-09-04', plannedCost: 100, plannedHours: 5 },
    { key: oldSecondSystemKey, startDate: '2026-09-01', endDate: null, plannedCost: 200, plannedHours: 8 }
  ]);
  assert.deepEqual(migrated, [{ key: equipmentKey, startDate: '2026-09-01', endDate: null, mobilizationDate: null,
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

test('mobilização do escopo conta os dias corridos sem alterar a janela financeira da divisão', () => {
  const division = { startDate: '2026-09-01', endDate: '2026-09-30', mobilizationDate: '2026-09-10' };
  assert.deepEqual(buildProjectCalendarPeriod({ division, startDate: '2026-08-01', referenceDate: new Date('2026-09-15T15:00:00Z') }), {
    startDate: '2026-09-10', elapsed: 5
  });
  assert.equal(dateInDivision('2026-09-02', division, new Date('2026-09-15')), true);
  assert.equal(buildProjectCalendarPeriod({ division, referenceDate: new Date('2026-09-05') }).elapsed, 0);
  assert.equal(buildProjectCalendarPeriod({ division: { ...division, mobilizationDate: null }, startDate: '2026-08-01', referenceDate: new Date('2026-09-15') }).elapsed, null);
  assert.equal(buildProjectCalendarPeriod({ startDate: '2026-09-01', referenceDate: new Date('2026-09-15') }).elapsed, 14);
  assert.equal(buildProjectCalendarPeriod({ referenceDate: new Date('2026-09-15') }).elapsed, null);
});

test('exige início e mobilização manuais e aceita mobilização anterior ao corte financeiro', () => {
  const candidates = divisionCandidates(candidateServices);
  const row = { key: scopeKey, startDate: '2026-09-10', endDate: '2026-09-30' };
  for (const mobilizationDate of [undefined, null, '']) {
    assert.throws(() => validateDivisionRows(candidates, [{ ...row, mobilizationDate }]), /mobilização do escopo/);
  }
  for (const startDate of [undefined, null, '']) {
    assert.throws(() => validateDivisionRows(candidates, [{ ...row, startDate, mobilizationDate: '2026-09-01' }]), /início/);
  }
  assert.throws(() => validateDivisionRows(candidates, [{ ...row, mobilizationDate: '2026-02-30' }]), /data válida/);
  assert.throws(() => validateDivisionRows(candidates, [{ ...row, mobilizationDate: '2026-10-01' }]), /anterior ao fim do escopo/);
  assert.equal(validateDivisionRows(candidates, [{ ...row, mobilizationDate: '2026-09-01' }])[0].mobilizationDate, '2026-09-01');
});

test('mobilização recorta dias e custos dos colaboradores, enquanto início recorta gastos e faturamento', () => {
  const division = { startDate: '2026-09-10', mobilizationDate: '2026-09-04', endDate: '2026-09-12' };
  const dates = ['2026-09-03', '2026-09-04', '2026-09-09', '2026-09-10', '2026-09-12', '2026-09-13'];
  const rate = {
    analyticalAllocationTrail: dates.map(date => ({ date, costNormalHours: 8, allocations: [{ projectId: 'p', weight: 1 }] })),
    months: [{ month: '2026-09', analyticalByProject: { p: { hours: 48, cost: 960, costBase: 900 } } }]
  };
  const labor = { pontoImport: {}, byCollaboratorId: new Map([['c1', rate]]) };
  const allocation = divisionLaborAllocation(labor, 'p', division);
  assert.deepEqual(allocation.total, { laborCost: 640, laborCostBase: 600, hours: 32 });
  const collaborator = buildProjectDetailCollaborator({ rate, projectId: 'p', division, allocation: allocation.byCollaboratorId.get('c1'), includeCollaboratorCosts: true });
  assert.deepEqual(collaborator.diasApropriados.map(day => day.data), ['2026-09-04', '2026-09-09', '2026-09-10', '2026-09-12']);
  assert.equal(collaborator.horasApropriadas, 32);
  assert.equal(collaborator.custo, 640);
  assert.deepEqual(dates.filter(date => dateInDivision(date, division)), ['2026-09-10', '2026-09-12']);
  assert.equal(divisionDateWhere('dataEmissao', division).dataEmissao.gte.toISOString(), '2026-09-10T00:00:00.000Z');
  assert.equal(buildProjectCalendarPeriod({ division, startDate: '2026-07-01', referenceDate: new Date('2026-09-12') }).elapsed, 8);

  const pending = { ...division, mobilizationDate: null };
  assert.deepEqual(divisionLaborAllocation(labor, 'p', pending), { total: null, byCollaboratorId: new Map() });
  assert.deepEqual(buildProjectDetailCollaborator({ rate, projectId: 'p', division: pending }).diasApropriados, []);
  assert.equal(dateInDivision('2026-09-10', divisionLaborPeriod(pending)), false);
});
