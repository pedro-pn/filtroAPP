/*
 * Auditoria da alocação diária do ponto.
 *
 * Fonte única de duas telas: o painel de auditoria (todos os dias, por colaborador ou por projeto)
 * e a lista de pendências (só os dias com horas que não chegaram a projeto nenhum). Ambas leem a
 * trilha produzida por classifyProjectHours, derivada do estado atual — e não do snapshot gravado
 * em PontoSyncRun, que só cobre período sincronizado pela API e congela no momento do sync.
 */

import prisma from '../prisma.js';
import { computeCollaboratorRates } from './labor-cost.js';
import { extractMissionCode, normalizeProjectTag } from '../pontomais/normalize.js';

// O cálculo completo é caro (mescla todos os imports + relatórios do período). O painel usa
// polling, então memorizamos por impressão digital dos dados de entrada: agregações baratas
// evitam o recálculo enquanto nada mudou, e qualquer escrita relevante invalida sozinha.
let cache = { fingerprint: null, value: null };

async function currentFingerprint() {
  const [
    imports,
    reports,
    reportCollaborators,
    overrides,
    aliases,
    projects,
    ignoredTags,
    effectivePlans,
    effectiveMissions,
    effectiveAllocations,
    collaboratorRoleHistory
  ] = await Promise.all([
    prisma.pontoImport.aggregate({ _count: { _all: true }, _max: { createdAt: true } }),
    prisma.report.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.reportCollaborator.count(),
    prisma.pontoDayProjectOverride.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.pontoProjectTagAlias.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.project.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.pontoIgnoredProjectTag.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.efetivoPlan.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.efetivoMissionPlan.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.efetivoMissionAllocation.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.collaboratorJobRoleHistory.aggregate({ _count: { _all: true }, _max: { updatedAt: true } })
  ]);
  return JSON.stringify([
    imports._count._all, imports._max.createdAt,
    reports._count._all, reports._max.updatedAt,
    reportCollaborators,
    overrides._count._all, overrides._max.updatedAt,
    aliases._count._all, aliases._max.updatedAt,
    projects._count._all, projects._max.updatedAt,
    ignoredTags._count._all, ignoredTags._max.updatedAt,
    effectivePlans._count._all, effectivePlans._max.updatedAt,
    effectiveMissions._count._all, effectiveMissions._max.updatedAt,
    effectiveAllocations._count._all, effectiveAllocations._max.updatedAt,
    collaboratorRoleHistory._count._all, collaboratorRoleHistory._max.updatedAt
  ]);
}

export function invalidateAllocationAudit() {
  cache = { fingerprint: null, value: null };
}

async function loadTrails() {
  const fingerprint = await currentFingerprint();
  if (cache.fingerprint === fingerprint && cache.value) return cache.value;

  const [{ rates }, projects, ignoredTags] = await Promise.all([
    computeCollaboratorRates(),
    prisma.project.findMany({ select: { id: true, code: true, name: true } }),
    prisma.pontoIgnoredProjectTag.findMany({ select: { normalizedTag: true } })
  ]);
  const projectsById = new Map(projects.map(project => [project.id, project]));
  const knownMissionCodes = new Set(projects.map(project => String(project.code || '').trim()).filter(Boolean));
  const value = {
    rates,
    projectsById,
    knownMissionCodes,
    ignoredTagSet: new Set(ignoredTags.map(item => normalizeProjectTag(item.normalizedTag))),
    // A elegibilidade por RDO/Efetivo substitui o corte fixo: um projeto antigo que receba RDO
    // passa a ser recalculado, enquanto um ponto antigo sem evidência continua fora da pendência.
    cutoffDateKey: null
  };
  cache = { fingerprint, value };
  return value;
}

function projectRef(projectsById, projectId) {
  const project = projectsById.get(projectId);
  return {
    projectId,
    code: project?.code ?? null,
    name: project?.name ?? null
  };
}

// Dia não alocado cuja etiqueta cita uma missão que não existe no app já está representado na aba
// "Projetos não encontrados". Marcamos o balde para a UI separar e para o contador não somar.
function unallocatedBucket(day, knownMissionCodes, ignoredTagSet = new Set()) {
  const tags = day.tags || [];
  // Etiqueta que o gestor mandou ignorar tira o dia das duas listas e da contagem.
  if (tags.length > 0 && tags.every(tag => ignoredTagSet.has(normalizeProjectTag(tag)))) return 'IGNORED';
  const citedCodes = tags.map(extractMissionCode).filter(Boolean);
  const hasUnknownMission = citedCodes.length > 0 && citedCodes.every(code => !knownMissionCodes.has(code));
  return hasUnknownMission ? 'MISSING_PROJECT' : 'ACTIONABLE';
}

function decorateDay(day, projectsById, knownMissionCodes, ignoredTagSet = new Set()) {
  const allocated = day.allocations.length > 0;
  const appropriatedNormalHours = allocated
    ? Math.max(0, Number(day.costNormalHours ?? day.normalHours) || 0)
    : 0;
  return {
    date: day.date,
    normalHours: day.normalHours,
    appropriatedNormalHours,
    he70Hours: day.he70Hours,
    he100Hours: day.he100Hours,
    totalHours: day.normalHours + day.he70Hours + day.he100Hours,
    appropriatedTotalHours: allocated
      ? appropriatedNormalHours + day.he70Hours + day.he100Hours
      : 0,
    minimumNormalHoursApplied: Boolean(day.minimumNormalHoursApplied),
    tags: day.tags,
    tagProjects: day.tagProjectIds.map(id => projectRef(projectsById, id)),
    rdoProjects: day.rdoProjects.map(item => ({ ...projectRef(projectsById, item.projectId), hours: item.hours })),
    manualProjects: day.manualProjectIds.map(id => projectRef(projectsById, id)),
    effectiveProjects: (day.effectiveProjectIds || []).map(id => projectRef(projectsById, id)),
    candidateProjects: (day.candidateProjectIds || []).map(id => projectRef(projectsById, id)),
    allocations: day.allocations.map(item => ({ ...projectRef(projectsById, item.projectId), weight: item.weight })),
    planningMismatch: Boolean(day.planningMismatch),
    pending: Boolean(day.pending),
    reason: day.reason,
    allocated,
    bucket: allocated ? null : unallocatedBucket(day, knownMissionCodes, ignoredTagSet)
  };
}

// Dias que ficaram sem projeto por excesso de evidência conflitante, e não por falta dela.
const CONFLICT_REASONS = new Set([
  'TAG_RDO_CONFLICT',
  'UNCONFIRMED_MULTIPLE_TAGS',
  'AMBIGUOUS_WITHOUT_TAGS',
  'MOBILIZATION_RDO_AMBIGUOUS',
  'EFFECTIVE_ALLOCATION_AMBIGUOUS',
  'EFFECTIVE_TAG_CONFLICT',
  'SCHEDULE_WINDOW_AMBIGUOUS'
]);

function inRange(dateKey, from, to) {
  if (from && dateKey < from) return false;
  if (to && dateKey > to) return false;
  return true;
}

/*
 * Painel de auditoria. Sem projectId devolve a trilha do colaborador; com projectId devolve os dias
 * em que aquele projeto foi alocado OU apareceu como candidato (etiqueta/RDO) e não levou as horas —
 * que é justamente o que se quer olhar ao auditar um projeto específico.
 */
export async function getAllocationAudit(filters = {}) {
  const { rates, projectsById, knownMissionCodes, ignoredTagSet } = await loadTrails();
  return buildAllocationAudit({ rates, projectsById, knownMissionCodes, ignoredTagSet, ...filters });
}

export function buildAllocationAudit({
  rates = [],
  projectsById = new Map(),
  knownMissionCodes = new Set(),
  ignoredTagSet = new Set(),
  collaboratorId = null,
  projectId = null,
  from = null,
  to = null,
  onlyUnallocated = false
} = {}) {
  const collaborators = [];

  for (const entry of rates) {
    if (collaboratorId && entry.collaboratorId !== collaboratorId) continue;
    const days = [];
    for (const day of entry.allocationTrail || []) {
      if (!inRange(day.date, from, to)) continue;
      if (onlyUnallocated && day.allocations.length > 0) continue;
      if (projectId) {
        const mentions = day.allocations.some(item => item.projectId === projectId)
          || day.tagProjectIds.includes(projectId)
          || day.rdoProjects.some(item => item.projectId === projectId);
        if (!mentions) continue;
      }
      days.push(decorateDay(day, projectsById, knownMissionCodes, ignoredTagSet));
    }
    if (!days.length) continue;

    const byProject = new Map();
    let unallocatedHours = 0;
    for (const day of days) {
      if (!day.allocated) unallocatedHours += day.totalHours;
      for (const allocation of day.allocations) {
        const current = byProject.get(allocation.projectId)
          || { ...projectRef(projectsById, allocation.projectId), normalHours: 0, he70Hours: 0, he100Hours: 0, days: 0 };
        current.normalHours += day.appropriatedNormalHours * allocation.weight;
        current.he70Hours += day.he70Hours * allocation.weight;
        current.he100Hours += day.he100Hours * allocation.weight;
        current.days += allocation.weight;
        byProject.set(allocation.projectId, current);
      }
    }

    collaborators.push({
      collaboratorId: entry.collaboratorId,
      name: entry.name,
      role: entry.role,
      days,
      totals: {
        hours: days.reduce((sum, day) => sum + day.totalHours, 0),
        unallocatedHours,
        byProject: [...byProject.values()].sort((left, right) => right.normalHours - left.normalHours)
      }
    });
  }

  collaborators.sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR'));
  return { collaborators };
}

/*
 * Pendências de dia sem alocação. Só entram dias com horas e evidência operacional real que exija
 * decisão (RDO conflitante, Efetivo ambíguo ou período divergente). Uma etiqueta isolada continua
 * na auditoria, mas não vira pendência. Dias contíguos equivalentes são agrupados.
 */
export async function getUnallocatedDays({ from = null, to = null } = {}) {
  const { rates, projectsById, knownMissionCodes, ignoredTagSet, cutoffDateKey } = await loadTrails();
  return groupUnallocatedDays({ rates, projectsById, knownMissionCodes, ignoredTagSet, cutoffDateKey, from, to });
}

export function groupUnallocatedDays({
  rates = [],
  projectsById = new Map(),
  knownMissionCodes = new Set(),
  ignoredTagSet = new Set(),
  cutoffDateKey = null,
  from = null,
  to = null
} = {}) {
  const items = [];

  for (const entry of rates) {
    const trailByDate = new Map((entry.allocationTrail || []).map(day => [day.date, day]));
    const days = (entry.unresolvedDays || [])
      .filter(day => {
        if (!inRange(day.date, from, to)) return false;
        return trailByDate.get(day.date)?.pending === true;
      })
      .map(day => day.date)
      .sort();
    if (!days.length) continue;

    let block = null;
    const flush = () => { if (block) items.push(block); block = null; };

    for (const date of days) {
      const trailDay = trailByDate.get(date);
      if (!trailDay) continue;
      const decorated = decorateDay(trailDay, projectsById, knownMissionCodes, ignoredTagSet);
      const previous = block?.days[block.days.length - 1]?.date;
      const contiguous = previous
        && new Date(`${date}T00:00:00.000Z`) - new Date(`${previous}T00:00:00.000Z`) === 86400000
        && block.bucket === decorated.bucket
        && block.reason === decorated.reason;
      if (!contiguous) {
        flush();
        block = {
          collaboratorId: entry.collaboratorId,
          name: entry.name,
          role: entry.role,
          bucket: decorated.bucket,
          reason: decorated.reason,
          days: [],
          hours: 0
        };
      }
      block.days.push(decorated);
      block.hours += decorated.totalHours;
    }
    flush();
  }

  items.sort((left, right) => (
    left.days[0].date.localeCompare(right.days[0].date)
    || String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR')
  ));

  const actionable = items.filter(item => item.bucket === 'ACTIONABLE');
  const missingProjects = items.filter(item => item.bucket === 'MISSING_PROJECT');
  return {
    cutoffDateKey,
    actionable,
    missingProjects,
    counts: {
      // O contador da navegação ignora de propósito o balde de projeto não cadastrado: aquilo é
      // fila de cadastro, não de resolução. O balde IGNORED nem chega aqui.
      actionableDays: actionable.reduce((sum, item) => sum + item.days.length, 0),
      actionableHours: actionable.reduce((sum, item) => sum + item.hours, 0),
      // Conflito é um subconjunto dos dias sem alocação, não uma fila paralela: o dia tem evidência
      // demais (etiqueta contra RDO, vários RDOs, janelas sobrepostas) em vez de nenhuma.
      conflictDays: actionable
        .filter(item => CONFLICT_REASONS.has(item.reason))
        .reduce((sum, item) => sum + item.days.length, 0),
      missingProjectDays: missingProjects.reduce((sum, item) => sum + item.days.length, 0)
    }
  };
}

export class AllocationAuditError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AllocationAuditError';
    this.code = code;
  }
}

function dateFromKey(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/*
 * Resolve dias sem alocação gravando PontoDayProjectOverride — a mesma tabela que a regra já lê
 * como MANUAL_OVERRIDE, então nada muda no motor de custo.
 *
 * Caminho de escrita separado do setDayProjectOverride da integração de propósito: aquele exige
 * que o dia esteja na lista de pendências do sync e que o projeto seja um dos candidatos apurados.
 * Dia sem evidência nenhuma não tem candidato — é justamente a definição dele —, então aqui a
 * escolha do gestor é livre, e a trava é outra: o dia precisa estar hoje sem alocação.
 */
/*
 * Valida um item da resolução e devolve os projetos normalizados.
 *
 * A trava aqui é diferente da do override da integração: como o dia sem evidência não tem projeto
 * candidato, a escolha do gestor é livre — o que se exige é que o dia esteja hoje sem alocação, para
 * que esta porta não vire um jeito de sobrescrever silenciosamente um dia já resolvido.
 */
export function validateUnallocatedSelection(item, { unallocatedKeys, knownProjectIds } = {}) {
  const projectIds = [...new Set((item?.projectIds || []).map(value => String(value || '').trim()).filter(Boolean))];
  if (projectIds.length === 0) {
    throw new AllocationAuditError('INVALID_PROJECT_SELECTION', 'Selecione ao menos um projeto.');
  }
  if (projectIds.some(projectId => !knownProjectIds.has(projectId))) {
    throw new AllocationAuditError('PROJECT_NOT_FOUND', 'Projeto não encontrado.');
  }
  if (!unallocatedKeys.has(`${item.collaboratorId}:${item.date}`)) {
    throw new AllocationAuditError(
      'DAY_NOT_UNALLOCATED',
      `O dia ${item.date} não está pendente de alocação. Recarregue a lista.`
    );
  }
  return projectIds;
}

export async function resolveUnallocatedDays({ items = [], createdByUserId = null } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new AllocationAuditError('EMPTY_SELECTION', 'Nenhum dia selecionado.');
  }

  const { actionable, missingProjects } = await getUnallocatedDays();
  const unallocatedKeys = new Set([...actionable, ...missingProjects].flatMap(block => (
    block.days.map(day => `${block.collaboratorId}:${day.date}`)
  )));

  const requestedProjectIds = [...new Set(items.flatMap(item => item.projectIds || []))];
  const projects = await prisma.project.findMany({
    where: { id: { in: requestedProjectIds } },
    select: { id: true }
  });
  const knownProjectIds = new Set(projects.map(project => project.id));

  const results = [];
  for (const item of items) {
    const projectIds = validateUnallocatedSelection(item, { unallocatedKeys, knownProjectIds });

    const period = await prisma.pontoPeriodSummary.findFirst({
      where: {
        collaboratorId: item.collaboratorId,
        periodStart: { lte: dateFromKey(item.date) },
        periodEnd: { gte: dateFromKey(item.date) }
      },
      orderBy: { createdAt: 'desc' },
      select: { externalEmployeeId: true }
    });

    const workDate = dateFromKey(item.date);
    await prisma.$transaction(async tx => {
      await tx.pontoDayProjectOverride.deleteMany({
        where: { collaboratorId: item.collaboratorId, workDate }
      });
      await tx.pontoDayProjectOverride.createMany({
        data: projectIds.map(projectId => ({
          collaboratorId: item.collaboratorId,
          workDate,
          projectId,
          externalEmployeeId: period?.externalEmployeeId ?? null,
          createdByUserId
        }))
      });
    });
    results.push({ collaboratorId: item.collaboratorId, date: item.date, projectIds });
  }

  invalidateAllocationAudit();
  return { updated: results.length, items: results };
}
