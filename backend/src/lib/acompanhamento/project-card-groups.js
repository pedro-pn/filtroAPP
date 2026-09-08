import { sameClientName } from './client-identity.js';

const STATUS_ORDER = {
  SEM_RDO: 0,
  TRABALHADO: 1,
  PARADO: 2
};

const CATEGORY_ORDER = {
  ARQUIVADO: 0,
  FUTURO: 1,
  ANDAMENTO: 2
};

const TAX_NUMERIC_FIELDS = [
  'omieIss',
  'issDelta',
  'invoiceTaxTotal',
  'outOfInvoiceTaxTotal',
  'estimatedProjectTaxCost',
  'totalTax',
  'netAfterTaxes',
  'netAfterOutOfInvoiceTaxes',
  'minimumOutOfInvoiceTaxTotal',
  'minimumTotal',
  'probableTotal',
  'basisAmount',
  'expectedSalePrice',
  'invoicedAmount',
  'salePrice',
  'iss',
  'pis',
  'cofins',
  'inss',
  'irpjBasic',
  'csll',
  'additionalIrpjEstimated',
  'irpjTotal',
  'irpjCsllTotal'
];

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function round1(value) {
  return Math.round(value * 10) / 10;
}

export function round2(value) {
  return Math.round(value * 100) / 100;
}

export function sumValues(items, getter, { nullWhenEmpty = true } = {}) {
  let total = 0;
  let seen = false;
  for (const item of items) {
    const n = toNumber(getter(item));
    if (n === null) continue;
    total += n;
    seen = true;
  }
  return seen || !nullWhenEmpty ? round2(total) : null;
}

export function ratioPct(numerator, denominator, { decimals = 0 } = {}) {
  const n = toNumber(numerator);
  const d = toNumber(denominator);
  if (n === null || d === null || d <= 0) return null;
  const pct = (n / d) * 100;
  return decimals === 0 ? Math.round(pct) : round2(pct);
}

export function minIsoDate(values) {
  const valid = values
    .filter(Boolean)
    .map(value => new Date(value))
    .filter(value => !Number.isNaN(value.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  return valid[0]?.toISOString() ?? null;
}

export function maxIsoDate(values) {
  const valid = values
    .filter(Boolean)
    .map(value => new Date(value))
    .filter(value => !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return valid[0]?.toISOString() ?? null;
}

export function combineLastDay(cards) {
  let best = { date: null, status: 'SEM_RDO' };
  for (const card of cards) {
    const current = card.lastDay ?? { date: null, status: 'SEM_RDO' };
    if (!current.date) {
      if (!best.date && STATUS_ORDER[current.status] > STATUS_ORDER[best.status]) best = current;
      continue;
    }
    if (!best.date || new Date(current.date) > new Date(best.date)) {
      best = current;
      continue;
    }
    if (best.date && new Date(current.date).getTime() === new Date(best.date).getTime()) {
      if (STATUS_ORDER[current.status] > STATUS_ORDER[best.status]) best = current;
    }
  }
  return { date: best.date ?? null, status: best.status ?? 'SEM_RDO' };
}

export function combineCategory(cards) {
  return cards.reduce((best, card) => {
    const category = card.category ?? (card.archived ? 'ARQUIVADO' : 'ANDAMENTO');
    return CATEGORY_ORDER[category] > CATEGORY_ORDER[best] ? category : best;
  }, 'ARQUIVADO');
}

export function combineAlerts(cards) {
  const byKey = new Map();
  for (const card of cards) {
    for (const alert of card.alerts ?? []) {
      const key = alert.code || alert.label;
      const existing = byKey.get(key);
      if (!existing || (existing.level !== 'danger' && alert.level === 'danger')) {
        byKey.set(key, { ...alert });
      }
    }
  }
  return Array.from(byKey.values());
}

export function combineEquipment(cards) {
  const byKey = new Map();
  for (const card of cards) {
    for (const item of card.equipment ?? []) {
      const key = `${item.code || item.name}|${item.since ?? ''}`;
      const existing = byKey.get(key);
      if (!existing || (toNumber(item.days) ?? 0) > (toNumber(existing.days) ?? 0)) {
        byKey.set(key, { ...item });
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => (toNumber(b.days) ?? 0) - (toNumber(a.days) ?? 0));
}

export function combineCollaborators(cards) {
  const ids = new Set();
  let hasIds = false;
  let fallback = 0;
  for (const card of cards) {
    const collaboratorIds = Array.isArray(card.collaboratorIds) ? card.collaboratorIds : [];
    if (collaboratorIds.length > 0) {
      hasIds = true;
      collaboratorIds.forEach(id => ids.add(id));
    } else {
      fallback += toNumber(card.collaboratorsCount) ?? 0;
    }
  }
  return hasIds ? ids.size + fallback : fallback;
}

export function combineWorkedHours(cards) {
  const normalWorkedHours = sumValues(cards, card => card.workedHours?.normalWorkedHours, { nullWhenEmpty: false });
  const overtimeWorkedHours = sumValues(cards, card => card.workedHours?.overtimeWorkedHours, { nullWhenEmpty: false });
  const totalWorkedHours = round1(normalWorkedHours + overtimeWorkedHours);
  const plannedNormalHours = sumValues(cards, card => card.workedHours?.plannedNormalHours, { nullWhenEmpty: false });
  const plannedOvertimeHours = sumValues(cards, card => card.workedHours?.plannedOvertimeHours, { nullWhenEmpty: false });
  const plannedTotalHours = plannedNormalHours + plannedOvertimeHours;

  return {
    normalWorkedHours: round1(normalWorkedHours),
    overtimeWorkedHours: round1(overtimeWorkedHours),
    totalWorkedHours,
    plannedNormalHours: round1(plannedNormalHours),
    plannedOvertimeHours: round1(plannedOvertimeHours),
    plannedTotalHours: plannedTotalHours > 0 ? round1(plannedTotalHours) : null,
    normalPct: plannedTotalHours > 0 ? Math.round((normalWorkedHours / plannedTotalHours) * 100) : null,
    overtimePct: plannedTotalHours > 0 ? Math.round((overtimeWorkedHours / plannedTotalHours) * 100) : null,
    totalPct: plannedTotalHours > 0 ? Math.round((totalWorkedHours / plannedTotalHours) * 100) : null
  };
}

export function combineProgress(cards) {
  const withProgress = cards
    .map(card => ({
      progress: toNumber(card.progressPct),
      weight: Math.max(0, toNumber(card.progressWeight ?? card.plannedCost ?? card.plannedTotalCost ?? card.salePrice) ?? 0)
    }))
    .filter(item => item.progress !== null);
  if (withProgress.length === 0) return { progressPct: null, progressMethod: null };

  const weightTotal = withProgress.reduce((sum, item) => sum + item.weight, 0);
  if (weightTotal > 0) {
    const weighted = withProgress.reduce((sum, item) => sum + item.progress * item.weight, 0) / weightTotal;
    return { progressPct: round1(weighted), progressMethod: 'GROUP_WEIGHTED' };
  }

  const avg = withProgress.reduce((sum, item) => sum + item.progress, 0) / withProgress.length;
  return { progressPct: round1(avg), progressMethod: 'GROUP_AVERAGE' };
}

function normalizeHistoryPoint(point) {
  const progressPct = toNumber(point?.progressPct);
  if (progressPct === null || !point?.date) return null;
  const d = new Date(point.date);
  if (Number.isNaN(d.getTime())) return null;
  return { date: d.toISOString().slice(0, 10), progressPct };
}

function latestProgressAt(points, date) {
  let latest = null;
  const targetTime = new Date(date).getTime();
  for (const point of points) {
    if (new Date(point.date).getTime() <= targetTime) latest = point;
    else break;
  }
  return latest;
}

export function combineProgressHistory(cards) {
  const histories = cards
    .map(card => ({
      weight: Math.max(0, toNumber(card.progressWeight ?? card.plannedCost ?? card.plannedTotalCost ?? card.salePrice) ?? 0),
      points: (card.progressHistory ?? [])
        .map(normalizeHistoryPoint)
        .filter(Boolean)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    }))
    .filter(item => item.points.length > 0);
  if (histories.length === 0) return [];

  const dates = Array.from(new Set(histories.flatMap(item => item.points.map(point => point.date))))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  const out = [];
  for (const date of dates) {
    const active = histories
      .map(item => ({ weight: item.weight, point: latestProgressAt(item.points, date) }))
      .filter(item => item.point);
    if (active.length === 0) continue;

    const weightTotal = active.reduce((sum, item) => sum + item.weight, 0);
    const progressPct = weightTotal > 0
      ? active.reduce((sum, item) => sum + item.point.progressPct * item.weight, 0) / weightTotal
      : active.reduce((sum, item) => sum + item.point.progressPct, 0) / active.length;
    out.push({ date, progressPct: round1(progressPct) });
  }
  return out;
}

export function combinePresumedProfitTaxes(cards) {
  const taxes = cards.map(card => card.presumedProfitTaxes).filter(Boolean);
  if (taxes.length === 0) return null;
  const combined = {
    ...taxes[0],
    method: 'GROUPED',
    serviceTaxCode: 'MIXED',
    spreadsheetBlock: 'GROUPED',
    basisSource: taxes.some(t => t.basisSource === 'OMIE_INVOICED') ? 'OMIE_INVOICED' : taxes[0].basisSource,
    source: 'Agrupamento de missões'
  };
  for (const field of TAX_NUMERIC_FIELDS) {
    const total = sumValues(taxes, tax => tax[field], { nullWhenEmpty: true });
    combined[field] = total;
  }
  return combined;
}

function groupClientName(members) {
  return sameClientName(members);
}

function groupCode(members) {
  const codes = members.map(member => member.code).filter(Boolean);
  return codes.length ? codes.join(' + ') : 'Grupo';
}

function memberFrom(groupMember, card) {
  const project = groupMember.project ?? {};
  return {
    projectId: groupMember.projectId,
    code: card?.code ?? project.code ?? '',
    name: card?.name ?? project.name ?? '',
    clientName: card?.clientName ?? project.clientName ?? '',
    clientCnpj: card?.clientCnpj ?? project.clientCnpj ?? '',
    category: card?.category ?? (project.isActive === false ? 'ARQUIVADO' : 'ANDAMENTO'),
    progressPct: card?.progressPct ?? null,
    visible: Boolean(card)
  };
}

function buildGroupCard(group, memberCardsByProjectId) {
  const members = (group.members ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(member => memberFrom(member, memberCardsByProjectId.get(member.projectId)));
  const visibleCards = members
    .map(member => memberCardsByProjectId.get(member.projectId))
    .filter(Boolean);
  if (visibleCards.length === 0) return null;

  const plannedCost = sumValues(visibleCards, card => card.plannedCost);
  const realizedCost = sumValues(visibleCards, card => card.realizedCost, { nullWhenEmpty: false });
  const workedDays = sumValues(visibleCards, card => card.workedDays, { nullWhenEmpty: false });
  const totalDays = sumValues(visibleCards, card => card.totalDays);
  const category = combineCategory(visibleCards);
  const progress = combineProgress(visibleCards);

  return {
    kind: 'GROUP',
    groupId: group.id,
    laborAllocationMode: group.laborAllocationMode || 'VISUAL_ONLY',
    primaryLaborProjectId: group.primaryLaborProjectId || null,
    code: groupCode(members),
    name: group.name,
    clientName: groupClientName(members),
    members,
    archived: category === 'ARQUIVADO',
    archivedInReports: visibleCards.every(card => card.archivedInReports),
    archivedInAcompanhamento: visibleCards.every(card => card.archivedInAcompanhamento),
    reviewed: visibleCards.every(card => card.archived && card.reviewed),
    reviewedAt: minIsoDate(visibleCards.map(card => card.reviewedAt)),
    reportArchivedAt: maxIsoDate(visibleCards.map(card => card.reportArchivedAt)),
    category,
    workedDays,
    totalDays,
    daysConsumedPct: ratioPct(workedDays, totalDays),
    workedHours: combineWorkedHours(visibleCards),
    progressPct: progress.progressPct,
    progressMethod: progress.progressMethod,
    progressWeight: sumValues(visibleCards, card => card.progressWeight),
    plannedCost,
    originalPlannedCost: sumValues(visibleCards, card => card.originalPlannedCost),
    additionalPlannedCost: sumValues(visibleCards, card => card.additionalPlannedCost),
    originalSalePrice: sumValues(visibleCards, card => card.originalSalePrice),
    additionalSalePrice: sumValues(visibleCards, card => card.additionalSalePrice),
    budgetBreakdown: {
      original: {
        salePrice: sumValues(visibleCards, card => card.originalSalePrice),
        plannedTotalCost: sumValues(visibleCards, card => card.originalPlannedCost)
      },
      additionals: visibleCards.flatMap(card => card.budgetBreakdown?.additionals ?? []),
      additionalCount: sumValues(visibleCards, card => card.budgetBreakdown?.additionalCount, { nullWhenEmpty: false }),
      additionalTotals: {
        salePrice: sumValues(visibleCards, card => card.additionalSalePrice),
        plannedTotalCost: sumValues(visibleCards, card => card.additionalPlannedCost)
      }
    },
    invoicedRevenue: sumValues(visibleCards, card => card.invoicedRevenue),
    invoiceCount: sumValues(visibleCards, card => card.invoiceCount, { nullWhenEmpty: false }),
    presumedProfitTaxes: combinePresumedProfitTaxes(visibleCards),
    realizedCost,
    costConsumedPct: ratioPct(realizedCost, plannedCost),
    lastDay: combineLastDay(visibleCards),
    collaboratorsCount: combineCollaborators(visibleCards),
    startDate: minIsoDate(visibleCards.map(card => card.startDate)),
    expectedEndDate: maxIsoDate(visibleCards.map(card => card.expectedEndDate)),
    laborCost: sumValues(visibleCards, card => card.laborCost),
    laborCostBase: sumValues(visibleCards, card => card.laborCostBase),
    laborHours: sumValues(visibleCards, card => card.laborHours),
    stockCost: sumValues(visibleCards, card => card.stockCost, { nullWhenEmpty: false }),
    manualCost: sumValues(visibleCards, card => card.manualCost, { nullWhenEmpty: false }),
    equipment: combineEquipment(visibleCards),
    alerts: combineAlerts(visibleCards)
  };
}

export function groupProjectCards(cards = [], groups = []) {
  const activeGroups = groups.filter(group => group.status === 'ACTIVE' || !group.status);
  if (activeGroups.length === 0 || cards.length === 0) return cards;

  const cardsByProjectId = new Map(cards.map(card => [card.projectId, card]));
  const groupByProjectId = new Map();
  for (const group of activeGroups) {
    for (const member of group.members ?? []) {
      groupByProjectId.set(member.projectId, group);
    }
  }

  const emittedGroups = new Set();
  const output = [];
  for (const card of cards) {
    const group = groupByProjectId.get(card.projectId);
    if (!group) {
      output.push(card);
      continue;
    }
    if (emittedGroups.has(group.id)) continue;
    const groupCard = buildGroupCard(group, cardsByProjectId);
    if (groupCard) output.push(groupCard);
    emittedGroups.add(group.id);
  }

  return output;
}
