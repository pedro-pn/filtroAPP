import assert from 'node:assert/strict';
import { test } from 'node:test';

import { combineEquipment, combineProgressHistory, groupProjectCards } from '../src/lib/acompanhamento/project-card-groups.js';

function card(overrides = {}) {
  return {
    projectId: overrides.projectId ?? 'p1',
    code: overrides.code ?? '1001',
    name: overrides.name ?? 'Missão',
    clientName: overrides.clientName ?? 'Cliente A',
    clientCnpj: overrides.clientCnpj ?? '11222333000144',
    archived: overrides.archived ?? false,
    archivedInReports: overrides.archivedInReports ?? false,
    archivedInAcompanhamento: overrides.archivedInAcompanhamento ?? false,
    reviewed: overrides.reviewed ?? false,
    reviewedAt: overrides.reviewedAt ?? null,
    reportArchivedAt: overrides.reportArchivedAt ?? null,
    category: overrides.category ?? 'ANDAMENTO',
    workedDays: overrides.workedDays ?? 1,
    totalDays: overrides.totalDays ?? 2,
    daysConsumedPct: overrides.daysConsumedPct ?? 50,
    workedHours: overrides.workedHours ?? {
      normalWorkedHours: 8,
      overtimeWorkedHours: 2,
      totalWorkedHours: 10,
      plannedNormalHours: 16,
      plannedOvertimeHours: 4,
      plannedTotalHours: 20,
      normalPct: 40,
      overtimePct: 10,
      totalPct: 50
    },
    progressPct: overrides.progressPct ?? 50,
    progressMethod: overrides.progressMethod ?? 'RDO',
    progressWeight: overrides.progressWeight ?? null,
    progressHistory: overrides.progressHistory ?? [],
    plannedCost: overrides.plannedCost ?? 100,
    invoicedRevenue: overrides.invoicedRevenue ?? 90,
    invoiceCount: overrides.invoiceCount ?? 1,
    presumedProfitTaxes: overrides.presumedProfitTaxes ?? { outOfInvoiceTaxTotal: 10, invoiceTaxTotal: 5, basisSource: 'EXPECTED_SALE' },
    realizedCost: overrides.realizedCost ?? 40,
    costConsumedPct: overrides.costConsumedPct ?? 40,
    lastDay: overrides.lastDay ?? { date: '2026-07-10T00:00:00.000Z', status: 'TRABALHADO' },
    collaboratorsCount: overrides.collaboratorsCount ?? 1,
    collaboratorIds: overrides.collaboratorIds ?? [],
    startDate: overrides.startDate ?? '2026-07-01T00:00:00.000Z',
    expectedEndDate: overrides.expectedEndDate ?? '2026-07-20T00:00:00.000Z',
    laborCost: overrides.laborCost ?? 20,
    laborCostBase: overrides.laborCostBase ?? 18,
    laborHours: overrides.laborHours ?? 10,
    stockCost: overrides.stockCost ?? 7,
    manualCost: overrides.manualCost ?? 3,
    equipment: overrides.equipment ?? [],
    alerts: overrides.alerts ?? []
  };
}

function group(overrides = {}) {
  return {
    id: overrides.id ?? 'g1',
    name: overrides.name ?? 'Cliente A — 1001 + 1002',
    status: overrides.status ?? 'ACTIVE',
    members: overrides.members ?? [
      { projectId: 'p1', order: 0, project: { id: 'p1', code: '1001', name: 'A', clientName: 'Cliente A', clientCnpj: '11222333000144' } },
      { projectId: 'p2', order: 1, project: { id: 'p2', code: '1002', name: 'B', clientName: 'Cliente A', clientCnpj: '11222333000144' } }
    ]
  };
}

test('combineEquipment preserves distinct TAGs with the same name and departure date', () => {
  const since = '2026-08-22T00:00:00.000Z';
  const equipment = combineEquipment([
    { equipment: [
      { code: 'UFI 008', name: 'Unidade de filtragem', since, days: 3 },
      { code: 'UFI 009', name: 'Unidade de filtragem', since, days: 3 }
    ] },
    { equipment: [{ code: 'UFI 008', name: 'Unidade de filtragem', since, days: 5 }] }
  ]);

  assert.deepEqual(equipment, [
    { code: 'UFI 008', name: 'Unidade de filtragem', since, days: 5 },
    { code: 'UFI 009', name: 'Unidade de filtragem', since, days: 3 }
  ]);
});

test('groupProjectCards hides child cards and emits one consolidated group card', () => {
  const result = groupProjectCards([
    card({ projectId: 'p1', code: '1001' }),
    card({ projectId: 'p2', code: '1002' }),
    card({ projectId: 'p3', code: '1003' })
  ], [group()]);

  assert.equal(result.length, 2);
  assert.equal(result[0].kind, 'GROUP');
  assert.equal(result[0].groupId, 'g1');
  assert.deepEqual(result[0].members.map(member => member.projectId), ['p1', 'p2']);
  assert.equal(result[1].projectId, 'p3');
});

test('groupProjectCards sums money, recalculates ratios, deduplicates collaborators and combines alerts', () => {
  const result = groupProjectCards([
    card({
      projectId: 'p1',
      code: '1001',
      plannedCost: 100,
      realizedCost: 25,
      laborHours: 8,
      manualCost: 5,
      invoicedRevenue: 80,
      invoiceCount: 1,
      workedDays: 2,
      totalDays: 4,
      collaboratorIds: ['c1', 'c2'],
      alerts: [{ code: 'COST', level: 'warn', label: 'Custo alto' }]
    }),
    card({
      projectId: 'p2',
      code: '1002',
      plannedCost: 300,
      realizedCost: 175,
      laborHours: 8,
      manualCost: 15,
      invoicedRevenue: 220,
      invoiceCount: 2,
      workedDays: 3,
      totalDays: 6,
      collaboratorIds: ['c2', 'c3'],
      alerts: [{ code: 'COST', level: 'danger', label: 'Custo alto' }]
    })
  ], [group()]);

  const grouped = result[0];
  assert.equal(grouped.plannedCost, 400);
  assert.equal(grouped.realizedCost, 200);
  assert.equal(grouped.laborHours, 16);
  assert.equal(grouped.manualCost, 20);
  assert.equal(grouped.costConsumedPct, 50);
  assert.equal(grouped.invoicedRevenue, 300);
  assert.equal(grouped.invoiceCount, 3);
  assert.equal(grouped.workedDays, 5);
  assert.equal(grouped.totalDays, 10);
  assert.equal(grouped.daysConsumedPct, 50);
  assert.equal(grouped.collaboratorsCount, 3);
  assert.deepEqual(grouped.alerts, [{ code: 'COST', level: 'danger', label: 'Custo alto' }]);
});

test('groupProjectCards uses category precedence and weighted progress', () => {
  const result = groupProjectCards([
    card({ projectId: 'p1', category: 'FUTURO', progressPct: 10, plannedCost: 100 }),
    card({ projectId: 'p2', category: 'ANDAMENTO', progressPct: 90, plannedCost: 300 })
  ], [group()]);

  assert.equal(result[0].category, 'ANDAMENTO');
  assert.equal(result[0].progressMethod, 'GROUP_WEIGHTED');
  assert.equal(result[0].progressPct, 70);
});

test('groupProjectCards only marks the group reviewed when every archived mission was reviewed', () => {
  const result = groupProjectCards([
    card({ projectId: 'p1', archived: true, archivedInReports: true, reviewed: true, reviewedAt: '2026-08-06T10:00:00.000Z', reportArchivedAt: '2026-08-06T09:00:00.000Z', category: 'ARQUIVADO' }),
    card({ projectId: 'p2', archived: true, archivedInAcompanhamento: true, reviewed: false, category: 'ARQUIVADO' })
  ], [group()]);

  assert.equal(result[0].category, 'ARQUIVADO');
  assert.equal(result[0].reviewed, false);
  assert.equal(result[0].reportArchivedAt, '2026-08-06T09:00:00.000Z');
});

test('groupProjectCards compares clients by CNPJ before client name', () => {
  const result = groupProjectCards([
    card({ projectId: 'p1', clientName: 'Cliente Matriz', clientCnpj: '11.222.333/0001-44' }),
    card({ projectId: 'p2', clientName: 'Cliente Obra', clientCnpj: '11222333000144' })
  ], [group({
    members: [
      { projectId: 'p1', order: 0, project: { id: 'p1', code: '1001', name: 'A', clientName: 'Cliente Matriz', clientCnpj: '11222333000144' } },
      { projectId: 'p2', order: 1, project: { id: 'p2', code: '1002', name: 'B', clientName: 'Cliente Obra', clientCnpj: '11222333000144' } }
    ]
  })]);

  assert.equal(result[0].clientName, 'Cliente Matriz');
});

test('groupProjectCards uses scope contribution weight before planned cost for progress', () => {
  const result = groupProjectCards([
    card({ projectId: 'p1', progressPct: 55, progressWeight: 100, plannedCost: 1000 }),
    card({ projectId: 'p2', progressPct: 75, progressWeight: 300, plannedCost: 1000 })
  ], [group()]);

  assert.equal(result[0].progressPct, 70);
});

test('combineProgressHistory carries latest member points and weights by scope', () => {
  const out = combineProgressHistory([
    card({
      projectId: 'p1',
      progressWeight: 100,
      progressHistory: [
        { date: '2026-07-01', progressPct: 10 },
        { date: '2026-07-08', progressPct: 50 }
      ]
    }),
    card({
      projectId: 'p2',
      progressWeight: 300,
      progressHistory: [
        { date: '2026-07-01', progressPct: 0 },
        { date: '2026-07-15', progressPct: 100 }
      ]
    })
  ]);

  assert.deepEqual(out, [
    { date: '2026-07-01', progressPct: 2.5 },
    { date: '2026-07-08', progressPct: 12.5 },
    { date: '2026-07-15', progressPct: 87.5 }
  ]);
});

test('groupProjectCards ignores dissolved groups', () => {
  const cards = [card({ projectId: 'p1' }), card({ projectId: 'p2' })];
  const result = groupProjectCards(cards, [group({ status: 'DISSOLVED' })]);
  assert.equal(result, cards);
});

test('groupProjectCards does not mutate individual card objects and preserves member project ids', () => {
  const cards = [card({ projectId: 'p1' }), card({ projectId: 'p2' })];
  const before = structuredClone(cards);
  const result = groupProjectCards(cards, [group()]);

  assert.deepEqual(cards, before);
  assert.deepEqual(result[0].members.map(member => member.projectId), ['p1', 'p2']);
});
