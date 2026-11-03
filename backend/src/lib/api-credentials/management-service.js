import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { buildWeeklyProgressComparison, corporateToday, dateOnlyKey, weekStartKey, effectiveWeeklyProgressTarget } from '../../../../shared/modules/mission-weekly-progress.js';
import { projectCostSummary } from '../../../../shared/modules/project-cost-summary.js';
import { PROJECT_EXECUTION_WEEKLY_CHECKS } from '../../../../shared/schemas/project-execution.js';
import { addDays, isWeeklyReviewComplete, normalizeWeeklyChecks } from '../efetivo/project-workflow/weekly-review.js';
import { computeProgressDetailsForProjects } from '../acompanhamento/avanco.js';
import { getProjectDetail } from '../acompanhamento/project-detail.js';
import { loadAllocatedAttendanceDays } from '../acompanhamento/labor-cost.js';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { createSignedCursor, readSignedCursor, stableJson } from './cursor.js';
import { serializeOperationalResource } from './operational-serialization.js';
import { CONDITIONS_VALUE_SCOPE } from './management-resources.js';
import { buildWeeklyComparisonHistories, loadWeeklyComparisonSources } from '../acompanhamento/weekly-service-history.js';
import { weeklyTargetsNeedAttendance } from '../acompanhamento/weekly-progress-targets.js';
import { projectWeeklyTarget } from './weekly-target-projection.js';

const invalid = message => new IntegrationApiError(400, 'VALIDATION_ERROR', message);
const money = value => value == null ? null : new Prisma.Decimal(value).toFixed(2);
const latestDate = (...dates) => new Date(Math.max(...dates.filter(Boolean).map(value => +new Date(value))));
const compareKey = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function managementWeeks(query, snapshotAt) {
  if (query.weekStart && (query.from || query.to)) throw invalid('Informe weekStart ou from/to, não ambos.');
  if (Boolean(query.from) !== Boolean(query.to)) throw invalid('Informe from e to juntos.');
  if (query.weekStart && weekStartKey(query.weekStart) !== query.weekStart) throw invalid('weekStart deve ser uma segunda-feira.');
  const current = weekStartKey(corporateToday(snapshotAt));
  const from = weekStartKey(query.weekStart || query.from || current);
  const to = weekStartKey(query.weekStart || query.to || current);
  if (!from || !to || (query.from && query.from > query.to) || from > to || to > current) throw invalid('Informe semanas válidas, sem semanas futuras.');
  if ((Date.parse(to) - Date.parse(from)) / 604800000 >= 12) throw invalid('O período deve abranger no máximo 12 semanas.');
  const weeks = [];
  for (let week = from; week <= to; week = addDays(week, 7)) weeks.push(week);
  return weeks;
}

export function projectWeeklyReview(row) {
  if (!row) return null;
  const checks = normalizeWeeklyChecks(row.checks);
  const complete = isWeeklyReviewComplete(row);
  return { concluidaEm: complete ? new Date(row.completedAt).toISOString() : null,
    pendencias: complete ? 0 : Object.values(checks).filter(value => !value).length,
    itens: PROJECT_EXECUTION_WEEKLY_CHECKS.map(item => ({ codigo: item.key, rotulo: item.label, ok: checks[item.key] })) };
}

async function projectWeeks(client, candidates, snapshotAt) {
  const ids = [...new Set(candidates.map(row => row.projectId))];
  if (!ids.length) return [];
  const [sources, targets, members, reviews] = await Promise.all([
    loadWeeklyComparisonSources(ids, { client, includeProgress: true }),
    client.missionWeeklyProgressTarget.findMany({ where: { projectId: { in: ids }, createdAt: { lte: snapshotAt } },
      select: { projectId: true, weekStartDate: true, plannedPctPoints: true, definition: true, isDeleted: true, revision: true } }),
    client.acompanhamentoMissionGroupMember.findMany({ where: { projectId: { in: ids }, activeProjectId: { not: null }, group: { status: 'ACTIVE' } },
      select: { projectId: true, groupId: true } }),
    client.projectExecutionWeeklyReview.findMany({ where: { projectId: { in: ids }, updatedAt: { lte: snapshotAt } },
      select: { projectId: true, weekStartDate: true, checks: true, completedAt: true } })
  ]);
  const groupIds = [...new Set(members.map(row => row.groupId))];
  const groupTargets = groupIds.length ? await client.missionWeeklyProgressTarget.findMany({
    where: { groupId: { in: groupIds }, createdAt: { lte: snapshotAt } },
    select: { groupId: true, weekStartDate: true, plannedPctPoints: true, definition: true, isDeleted: true, revision: true }
  }) : [];
  const comparisons = new Map();
  for (const id of ids) {
    const ownTargets = targets.filter(target => target.projectId === id);
    const groupId = members.find(member => member.projectId === id)?.groupId;
    const inheritedTargets = groupTargets.filter(target => target.groupId === groupId);
    const histories = buildWeeklyComparisonHistories([id], sources, { includeAttendance: weeklyTargetsNeedAttendance([...ownTargets, ...inheritedTargets]) });
    const input = { ...histories, progressHistory: sources.progressDetails.get(id)?.dailyProgressHistory ?? [], today: corporateToday(snapshotAt) };
    // Cada proprietário é resolvido por inteiro, preservando repetição e cortes
    // de períodos adjacentes, inclusive fora das semanas pedidas nesta página.
    comparisons.set(id, {
      own: new Map(buildWeeklyProgressComparison({ ...input, targets: ownTargets }).map(row => [row.weekStartDate, row])),
      group: new Map(buildWeeklyProgressComparison({ ...input, targets: inheritedTargets }).map(row => [row.weekStartDate, row]))
    });
  }
  return candidates.map(row => {
    const detail = sources.progressDetails.get(row.projectId);
    const history = detail?.dailyProgressHistory || [];
    const end = [addDays(row.weekStart, 6), corporateToday(snapshotAt)].sort()[0];
    const pointAt = (day, inclusive) => history.filter(point => inclusive ? dateOnlyKey(point.date) <= day : dateOnlyKey(point.date) < day).at(-1)?.progressPct ?? null;
    const own = effectiveWeeklyProgressTarget(targets.filter(target => target.projectId === row.projectId), row.weekStart);
    const groupId = members.find(member => member.projectId === row.projectId)?.groupId;
    const group = effectiveWeeklyProgressTarget(groupTargets.filter(target => target.groupId === groupId), row.weekStart);
    const target = own || group;
    return { ...row, avancoInicio: pointAt(row.weekStart, false), avancoFim: pointAt(end, true),
      metaPontos: target?.plannedPctPoints == null ? null : Number(target.plannedPctPoints),
      metaDefinidaPor: target ? (own ? 'PROJETO' : 'GRUPO') : null,
      meta: projectWeeklyTarget(comparisons.get(row.projectId)[own ? 'own' : 'group'].get(row.weekStart)),
      revisao: projectWeeklyReview(reviews.find(review => review.projectId === row.projectId && dateOnlyKey(review.weekStartDate) === row.weekStart)),
      updatedAt: snapshotAt };
  });
}

async function projectCosts(client, candidates, snapshotAt) {
  if (!candidates.length) return [];
  const ids = candidates.map(row => row.projectId);
  const [budgets, progress] = await Promise.all([
    client.projectBudget.findMany({ where: { projectId: { in: ids }, version: 1 }, select: { projectId: true } }),
    computeProgressDetailsForProjects(ids, { database: client })
  ]);
  // Limita a concorrência dos detalhes: cada um já realiza várias consultas.
  const result = [];
  for (const row of candidates) {
    const detail = await getProjectDetail(row.projectId, { projectChannel: 'api', includeUnlinked: true,
      includeCollaboratorCosts: false, includeAdminOnlyCategories: true, progressDetails: progress.get(row.projectId) });
    const costs = projectCostSummary(detail);
    result.push({ ...row, orcamento: budgets.some(budget => budget.projectId === row.projectId) ? {
      precoVenda: money(detail.faturamento.previsto), custoPrevisto: money(detail.consumo.previsto),
      margemPrevista: detail.budgetBreakdown?.totals?.expectedMargin ?? null, diasPrevistos: detail.diasCorridos.planned
    } : null, custoRealizado: { total: money(costs.total), porCategoria: costs.categories.map(category => ({
      codigo: category.code, rotulo: category.label, valor: money(category.value)
    })), ate: corporateToday(snapshotAt) }, avancoFisico: detail.avancoPct,
    consumoDoCusto: budgets.some(budget => budget.projectId === row.projectId) ? costs.percent : null,
    currency: 'BRL', atualizadoEm: snapshotAt });
  }
  return result;
}

async function projectConditions(client, projects, context) {
  const budgets = await client.projectBudget.findMany({ where: { projectId: { in: projects.map(row => row.id) }, version: 1 },
    select: { projectId: true, plannedDays: true, sourceProposalCodBd: true, updatedAt: true } });
  const codes = budgets.map(row => row.sourceProposalCodBd).filter(value => value != null);
  const proposals = codes.length ? await client.commercialProposal.findMany({ where: { codBd: { in: codes } },
    select: { codBd: true, plannedDays: true, updatedAt: true, ...(context.scopes.has(CONDITIONS_VALUE_SCOPE) ? { components: true } : {}) } }) : [];
  return projects.map(project => {
    const budget = budgets.find(row => row.projectId === project.id);
    const proposal = proposals.find(row => row.codBd === budget?.sourceProposalCodBd);
    const daily = proposal?.components?.diariaEquipamento;
    return { projectId: project.id, projectCode: project.code, permanenciaPrevistaDias: budget?.plannedDays ?? proposal?.plannedDays ?? null,
      updatedAt: latestDate(project.updatedAt, budget?.updatedAt, proposal?.updatedAt),
      ...(context.scopes.has(CONDITIONS_VALUE_SCOPE) ? { diariaStandByEquipamento: daily == null ? null : money(daily), currency: 'BRL' } : {}) };
  });
}

async function allocations(client, projects, snapshotAt) {
  const rows = await client.efetivoMissionAllocation.findMany({ where: {
    updatedAt: { lte: snapshotAt }, mission: { projectId: { in: projects.map(row => row.id) }, deletedAt: null,
      scheduleStatus: 'CONFIRMED', plan: { kind: 'OFFICIAL', status: 'ACTIVE' } }
  }, select: { id: true, collaboratorId: true, jobRoleNameSnapshot: true, mobilizationDate: true, demobilizationDate: true,
    updatedAt: true, deletedAt: true, mission: { select: { projectId: true } } } });
  const byId = new Map(projects.map(row => [row.id, row]));
  return rows.map(row => ({ id: row.id, projectId: row.mission.projectId, projectCode: byId.get(row.mission.projectId).code,
    collaboratorId: row.collaboratorId, funcao: row.jobRoleNameSnapshot, mobilizacao: dateOnlyKey(row.mobilizationDate),
    desmobilizacao: dateOnlyKey(row.demobilizationDate), updatedAt: row.updatedAt, deletedAt: row.deletedAt }));
}

async function attendanceWeeks(client, projects, weeks, snapshotAt) {
  if (!projects.length) return [];
  const allowed = new Map(projects.map(row => [row.id, row.code]));
  const rows = await loadAllocatedAttendanceDays({ database: client });
  const groups = new Map();
  for (const row of rows) {
    const week = weekStartKey(row.date);
    if (!allowed.has(row.projectId) || !weeks.includes(week) || row.date > corporateToday(snapshotAt)) continue;
    const key = row.projectId + '/' + week;
    if (!groups.has(key)) groups.set(key, { projectId: row.projectId, projectCode: allowed.get(row.projectId), weekStart: week,
      minutosNormais: 0, minutosExtra70: 0, minutosExtra100: 0, minutosNoturnos: 0, collaborators: new Set() });
    const group = groups.get(key);
    group.minutosNormais += row.normalMinutes; group.minutosExtra70 += row.he70Minutes;
    group.minutosExtra100 += row.he100Minutes; group.minutosNoturnos += row.nightMinutes;
    if (row.normalMinutes + row.he70Minutes + row.he100Minutes + row.nightMinutes > 0) group.collaborators.add(row.collaboratorId);
  }
  return [...groups.values()].filter(row => row.collaborators.size >= 2).map(({ collaborators, ...row }) => ({ ...row,
    ...Object.fromEntries(['minutosNormais','minutosExtra70','minutosExtra100','minutosNoturnos'].map(key => [key, Math.round(row[key] * 100) / 100])),
    pessoas: collaborators.size, atualizadoEm: snapshotAt }));
}

export async function listManagementResources(client, resource, query, context, visibility) {
  const weekly = resource.queryParams.includes('weekStart');
  const filters = { ...Object.fromEntries(Object.entries(query).filter(([key]) => !['cursor','limit','snapshotAt'].includes(key))),
    policy: createHash('sha256').update(stableJson({ credentialId: context.credentialId ?? null, scopes: [...context.scopes].sort(),
      mode: context.projectAccessMode, ids: context.projectAccessMode === 'SELECTED' ? [...context.projectIds].sort() : [] })).digest('hex') };
  const now = new Date(context.snapshotAt || new Date());
  const positionKeys = weekly ? ['key', 'from', 'to'] : ['key'];
  const cursor = query.cursor ? readSignedCursor({ cursor: query.cursor, key: context.cursorKey,
    operationId: resource.operationId, filters, positionKeys }) : null;
  const snapshotAt = new Date(cursor?.snapshotAt || query.snapshotAt || now);
  if (!Number.isFinite(+snapshotAt) || snapshotAt > now || (query.updatedSince && new Date(query.updatedSince) > snapshotAt)) throw invalid('Snapshot inválido ou intervalo futuro.');
  if (cursor && query.snapshotAt && +new Date(query.snapshotAt) !== +snapshotAt) throw invalid('Snapshot incompatível com o cursor.');
  const weeks = weekly ? managementWeeks(cursor ? { from: cursor.position.from, to: cursor.position.to } : query, snapshotAt) : [];
  const projects = await client.project.findMany({ where: visibility, select: { id: true, code: true, updatedAt: true } });
  let rows;
  if (resource.operationId === 'projects.conditions.list') rows = await projectConditions(client, projects, context);
  else if (resource.operationId === 'efetivo.allocations.list') rows = await allocations(client, projects, snapshotAt);
  else if (resource.operationId === 'ponto.projects.weeks.list') rows = await attendanceWeeks(client, projects, weeks, snapshotAt);
  else rows = projects.flatMap(project => (weekly ? weeks : [null]).map(week => ({ projectId: project.id, projectCode: project.code,
    ...(week ? { weekStart: week } : {}), updatedAt: snapshotAt })));
  const rowKey = row => resource.operationId === 'efetivo.allocations.list' ? `${new Date(row.updatedAt).toISOString()}/${row.id}`
    : resource.operationId === 'projects.conditions.list' ? `${new Date(row.updatedAt).toISOString()}/${row.projectId}`
    : `${row.projectId}/${row.weekStart || ''}`;
  rows = rows.filter(row => {
    const stamp = row.updatedAt || row.atualizadoEm;
    return (!stamp || (+new Date(stamp) <= +snapshotAt && (!query.updatedSince || +new Date(stamp) >= +new Date(query.updatedSince))))
      && (!cursor || rowKey(row) > cursor.position.key);
  }).sort((a, b) => compareKey(rowKey(a), rowKey(b)));
  const hasMore = rows.length > query.limit;
  const pageRows = rows.slice(0, query.limit);
  const nextCursor = hasMore ? createSignedCursor({ key: context.cursorKey, payload: { version: 1,
    operationId: resource.operationId, filters, snapshotAt: snapshotAt.toISOString(), position: { key: rowKey(pageRows.at(-1)),
      ...(weekly ? { from: weeks[0], to: weeks.at(-1) } : {}) } } }) : null;
  const output = resource.operationId === 'acompanhamento.projects.weeks.list' ? await projectWeeks(client, pageRows, snapshotAt)
    : resource.operationId === 'acompanhamento.projects.costs.list' ? await projectCosts(client, pageRows, snapshotAt) : pageRows;
  return { items: output.map(row => serializeOperationalResource(resource, row, context)),
    page: { limit: query.limit, hasMore, nextCursor, snapshotAt: snapshotAt.toISOString() } };
}
