import {
  combinePresumedProfitTaxes,
  combineProgress,
  ratioPct,
  sumValues
} from './project-card-groups.js';
import { sameClientName } from './client-identity.js';

function groupCode(members) {
  const codes = members.map(member => member.code).filter(Boolean);
  return codes.length ? codes.join(' + ') : 'Grupo';
}

function combineComponents(rows) {
  const keys = new Set();
  rows.forEach(row => Object.keys(row.components ?? {}).forEach(key => keys.add(key)));
  const components = {};
  for (const key of keys) {
    components[key] = sumValues(rows, row => row.components?.[key]);
  }
  return components;
}

function combineBudgetBreakdown(rows) {
  const original = {
    salePrice: sumValues(rows, row => row.originalSalePrice),
    plannedTotalCost: sumValues(rows, row => row.originalPlannedTotalCost),
    expectedProfit: sumValues(rows, row => row.originalExpectedProfit),
    taxes: sumValues(rows, row => row.originalTaxes)
  };
  const additionalTotals = {
    salePrice: sumValues(rows, row => row.additionalSalePrice),
    plannedTotalCost: sumValues(rows, row => row.additionalPlannedTotalCost),
    expectedProfit: sumValues(rows, row => row.additionalExpectedProfit),
    taxes: sumValues(rows, row => row.additionalTaxes)
  };
  return {
    original,
    additionals: rows.flatMap(row => row.budgetBreakdown?.additionals ?? []),
    additionalCount: sumValues(rows, row => row.budgetBreakdown?.additionalCount, { nullWhenEmpty: false }),
    additionalTotals,
    totals: {
      salePrice: sumValues(rows, row => row.salePrice),
      plannedTotalCost: sumValues(rows, row => row.plannedTotalCost),
      expectedProfit: sumValues(rows, row => row.expectedProfit),
      expectedMargin: ratioPct(sumValues(rows, row => row.expectedProfit), sumValues(rows, row => row.salePrice), { decimals: 2 }),
      taxes: sumValues(rows, row => row.taxes)
    }
  };
}

function sameOrNull(rows, getter) {
  const values = Array.from(new Set(rows.map(getter).filter(value => value !== null && value !== undefined && value !== '')));
  return values.length === 1 ? values[0] : null;
}

function memberFrom(groupMember, row) {
  const project = groupMember.project ?? {};
  return {
    projectId: groupMember.projectId,
    code: row?.code ?? project.code ?? '',
    name: row?.name ?? project.name ?? '',
    clientName: row?.clientName ?? project.clientName ?? '',
    clientCnpj: row?.clientCnpj ?? project.clientCnpj ?? '',
    visible: Boolean(row)
  };
}

function buildGroupRow(group, rowsByProjectId) {
  const members = (group.members ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(member => memberFrom(member, rowsByProjectId.get(member.projectId)));
  const visibleRows = members
    .map(member => rowsByProjectId.get(member.projectId))
    .filter(Boolean);
  if (visibleRows.length === 0) return null;

  const salePrice = sumValues(visibleRows, row => row.salePrice);
  const expectedProfit = sumValues(visibleRows, row => row.expectedProfit);
  const plannedTotalCost = sumValues(visibleRows, row => row.plannedTotalCost);
  const realizedCost = sumValues(visibleRows, row => row.realizedCost);
  const progress = combineProgress(visibleRows);
  const budgetBreakdown = combineBudgetBreakdown(visibleRows);

  return {
    kind: 'GROUP',
    groupId: group.id,
    code: groupCode(members),
    name: group.name,
    clientName: sameClientName(members),
    proposalCode: groupCode(members),
    members,
    resolved: visibleRows.every(row => row.resolved),
    archived: visibleRows.every(row => row.archived),
    startDate: null,
    approvedAt: null,
    mobilizationLeadDays: null,
    salePrice,
    originalSalePrice: sumValues(visibleRows, row => row.originalSalePrice),
    additionalSalePrice: sumValues(visibleRows, row => row.additionalSalePrice),
    invoicedRevenue: sumValues(visibleRows, row => row.invoicedRevenue),
    invoicedIss: sumValues(visibleRows, row => row.invoicedIss),
    invoiceCount: sumValues(visibleRows, row => row.invoiceCount, { nullWhenEmpty: false }),
    plannedTotalCost,
    originalPlannedTotalCost: sumValues(visibleRows, row => row.originalPlannedTotalCost),
    additionalPlannedTotalCost: sumValues(visibleRows, row => row.additionalPlannedTotalCost),
    expectedProfit,
    originalExpectedProfit: sumValues(visibleRows, row => row.originalExpectedProfit),
    additionalExpectedProfit: sumValues(visibleRows, row => row.additionalExpectedProfit),
    expectedMargin: ratioPct(expectedProfit, salePrice, { decimals: 2 }),
    taxes: sumValues(visibleRows, row => row.taxes),
    originalTaxes: sumValues(visibleRows, row => row.originalTaxes),
    additionalTaxes: sumValues(visibleRows, row => row.additionalTaxes),
    budgetBreakdown,
    plannedDays: sumValues(visibleRows, row => row.plannedDays),
    workedDays: sumValues(visibleRows, row => row.workedDays),
    numOperators: sumValues(visibleRows, row => row.numOperators),
    numSupervisors: sumValues(visibleRows, row => row.numSupervisors),
    numPerDay: sumValues(visibleRows, row => row.numPerDay),
    numPerNight: sumValues(visibleRows, row => row.numPerNight),
    serviceModality: sameOrNull(visibleRows, row => row.serviceModality),
    components: combineComponents(visibleRows),
    rdoCount: sumValues(visibleRows, row => row.rdoCount, { nullWhenEmpty: false }),
    realizedOmieCost: sumValues(visibleRows, row => row.realizedOmieCost),
    realizedCost,
    realizedPaid: sumValues(visibleRows, row => row.realizedPaid),
    stockCost: sumValues(visibleRows, row => row.stockCost),
    manualCost: sumValues(visibleRows, row => row.manualCost),
    presumedProfitTaxes: combinePresumedProfitTaxes(visibleRows),
    progressPct: progress.progressPct,
    progressMethod: progress.progressMethod,
    progressWeight: sumValues(visibleRows, row => row.progressWeight),
    costConsumedPct: ratioPct(realizedCost, plannedTotalCost)
  };
}

export function groupDashboardRows(rows = [], groups = []) {
  const activeGroups = groups.filter(group => group.status === 'ACTIVE' || !group.status);
  if (activeGroups.length === 0 || rows.length === 0) return rows;

  const rowsByProjectId = new Map(rows.map(row => [row.projectId, row]));
  const groupByProjectId = new Map();
  for (const group of activeGroups) {
    for (const member of group.members ?? []) {
      groupByProjectId.set(member.projectId, group);
    }
  }

  const emittedGroups = new Set();
  const output = [];
  for (const row of rows) {
    const group = groupByProjectId.get(row.projectId);
    if (!group) {
      output.push(row);
      continue;
    }
    if (emittedGroups.has(group.id)) continue;
    const groupRow = buildGroupRow(group, rowsByProjectId);
    if (groupRow) output.push(groupRow);
    emittedGroups.add(group.id);
  }

  return output;
}
