import prisma from '../prisma.js';
import {
  buildDailyProjectWeights,
  allocationDecisionRequiresAction,
  buildEffectiveAllocationIndex,
  effectiveProjectsForDay,
  buildScheduleWindowEligibility,
  buildScheduleWindows,
  scheduleWindowsForDay,
  buildMissionGroupProjectIndex,
  rdoDataByCollaboratorFromReports
} from '../acompanhamento/labor-cost.js';
import { normalizeName as normalizePontoName } from '../acompanhamento/ponto-import.js';
import { createPontoMaisClient, PontoMaisError, pontomaisConfigured } from './client.js';
import {
  buildProjectTagResolver,
  isPontoTravelTag,
  normalizePontoMaisSnapshot,
  extractMissionCode,
  normalizeProjectTag,
  normalizeRegistrationNumber
} from './normalize.js';

const RUN_STALE_AFTER_MS = 15 * 60 * 1000;
const SYNC_ADVISORY_LOCK_ID = 1_948_211_307;

export const PONTO_SYNC_TRIGGER = Object.freeze({
  MANUAL: 'MANUAL',
  AUTOMATIC_BOOTSTRAP: 'AUTOMATIC_BOOTSTRAP',
  AUTOMATIC_DAILY: 'AUTOMATIC_DAILY'
});

export class PontoSyncError extends Error {
  constructor(message, { code = 'PONTOMAIS_UNAVAILABLE', runId = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PontoSyncError';
    this.code = code;
    this.runId = runId;
  }
}

function dateFromKey(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function getOfficialEffectiveAllocations(database) {
  if (!database.efetivoMissionAllocation?.findMany) return Promise.resolve([]);
  return database.efetivoMissionAllocation.findMany({
    where: {
      deletedAt: null,
      mission: {
        deletedAt: null,
        scheduleStatus: 'CONFIRMED',
        plan: { kind: 'OFFICIAL', status: 'ACTIVE' }
      }
    },
    select: {
      id: true,
      collaboratorId: true,
      deletedAt: true,
      mobilizationDate: true,
      demobilizationDate: true,
      cycles: { select: { id: true, mobilizationDate: true, demobilizationDate: true } },
      mission: {
        select: {
          id: true,
          projectId: true,
          scheduleStatus: true,
          deletedAt: true,
          mobilizationDate: true,
          executionEndDate: true,
          returnDate: true,
          cycles: { select: { id: true, mobilizationDate: true, demobilizationDate: true } },
          plan: { select: { kind: true, status: true } }
        }
      }
    }
  });
}

function getOfficialEffectiveMissionProjectIds(database) {
  if (!database.efetivoMissionPlan?.findMany) return Promise.resolve([]);
  return database.efetivoMissionPlan.findMany({
    where: {
      deletedAt: null,
      scheduleStatus: 'CONFIRMED',
      plan: { kind: 'OFFICIAL', status: 'ACTIVE' }
    },
    select: { projectId: true }
  }).then(missions => missions.map(mission => mission.projectId));
}

function errorDescriptor(error) {
  if (error instanceof PontoSyncError) return { code: error.code, message: error.message };
  if (error instanceof PontoMaisError) {
    if (error.code === 'NOT_CONFIGURED') {
      return { code: 'PONTOMAIS_NOT_CONFIGURED', message: 'A integração com o Ponto Mais não está configurada.' };
    }
    if (error.code === 'AUTH') {
      return { code: 'PONTOMAIS_AUTH', message: 'O Ponto Mais recusou a credencial configurada.' };
    }
    if (error.code === 'INVALID_RESPONSE' || error.code === 'INVALID_REQUEST') {
      return { code: 'PONTOMAIS_INVALID_RESPONSE', message: 'O Ponto Mais retornou dados incompatíveis com a integração.' };
    }
  }
  return {
    code: 'PONTOMAIS_UNAVAILABLE',
    message: 'Não foi possível consultar o Ponto Mais. Os dados anteriores foram preservados.'
  };
}

function resultFromRun(run, extra = {}) {
  return {
    runId: run.id,
    status: run.status,
    trigger: run.trigger || PONTO_SYNC_TRIGGER.MANUAL,
    periodStart: new Date(run.periodStart).toISOString().slice(0, 10),
    periodEnd: new Date(run.periodEnd).toISOString().slice(0, 10),
    employeesRead: run.employeesRead || 0,
    workDaysRead: run.workDaysRead || 0,
    timeCardsRead: run.timeCardsRead || 0,
    collaboratorsTotal: run.summary?.collaboratorsTotal || 0,
    collaboratorsMatched: run.collaboratorsMatched || 0,
    pendingCount: run.pendingCount || 0,
    ...extra
  };
}

function safePendingProjection(summary) {
  const pending = summary?.pending || {};
  return {
    employees: (pending.employees || []).map(item => ({
      externalEmployeeId: String(item.externalEmployeeId),
      registrationNumber: item.registrationNumber ? String(item.registrationNumber) : null,
      externalName: String(item.externalName || ''),
      reason: String(item.reason || 'NO_UNIQUE_MATCH')
    })),
    projectTags: (pending.projectTags || []).map(item => ({
      rawTag: String(item.rawTag || ''),
      normalizedTag: normalizeProjectTag(item.normalizedTag || item.rawTag),
      reason: String(item.reason || 'PROJECT_NOT_FOUND')
    })),
    ambiguousDays: (pending.ambiguousDays || []).map(item => ({
      externalEmployeeId: String(item.externalEmployeeId),
      date: String(item.date),
      projectCodes: [...new Set((item.projectCodes || []).map(String))].sort(),
      tagProjectCodes: [...new Set((item.tagProjectCodes || []).map(String))].sort(),
      rdoProjectCodes: [...new Set((item.rdoProjectCodes || []).map(String))].sort(),
      reason: String(item.reason || 'RDO_NOT_CONFIRMED'),
      ...(item.travelContext ? { travelContext: true } : {})
    }))
  };
}

function safeRunProjection(run) {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger || PONTO_SYNC_TRIGGER.MANUAL,
    periodStart: new Date(run.periodStart).toISOString().slice(0, 10),
    periodEnd: new Date(run.periodEnd).toISOString().slice(0, 10),
    employeesRead: run.employeesRead || 0,
    workDaysRead: run.workDaysRead || 0,
    timeCardsRead: run.timeCardsRead || 0,
    collaboratorsMatched: run.collaboratorsMatched || 0,
    pendingCount: run.pendingCount || 0,
    errorCode: run.errorCode || null,
    errorMessage: run.errorMessage || null,
    startedAt: run.startedAt,
    completedAt: run.completedAt || null
  };
}

function periodDayRows(period) {
  const monthly = period?.monthly && typeof period.monthly === 'object' && !Array.isArray(period.monthly)
    ? period.monthly
    : null;
  const months = monthly?.schemaVersion === 2 && monthly.months && typeof monthly.months === 'object'
    ? monthly.months
    : monthly;
  return Object.values(months || {}).flatMap(month => (
    Array.isArray(month?.days) ? month.days.filter(day => day?.date) : []
  ));
}

function latestPeriodDays(periods) {
  const byEmployeeAndDate = new Map();
  const sorted = [...periods].sort((left, right) => {
    const leftTime = new Date(left.import?.createdAt || left.createdAt || 0).getTime();
    const rightTime = new Date(right.import?.createdAt || right.createdAt || 0).getTime();
    return leftTime - rightTime;
  });
  for (const period of sorted) {
    if (!period?.externalEmployeeId || !period?.collaboratorId) continue;
    for (const day of periodDayRows(period)) {
      byEmployeeAndDate.set(`${period.externalEmployeeId}:${day.date}`, { period, day });
    }
  }
  return [...byEmployeeAndDate.values()];
}

export function buildAmbiguousDayPendencies({
  periods = [],
  rdoReports = [],
  projects = [],
  tagAliases = [],
  manualDayOverrides = [],
  missionGroups = [],
  effectiveAllocations = [],
  effectiveMissionProjectIds = []
} = {}) {
  const rdoByCollaborator = rdoDataByCollaboratorFromReports(rdoReports);
  const resolveTag = buildProjectTagResolver({ projects, tagAliases });
  const missionGroupProjectsByProjectId = buildMissionGroupProjectIndex(missionGroups);
  const effectiveAllocationIndex = buildEffectiveAllocationIndex(effectiveAllocations);
  // A janela global é apenas fallback legado, condicionado a RDO nominal. O Efetivo individual é
  // consultado antes dela pela mesma função usada no cálculo financeiro.
  const scheduleWindows = buildScheduleWindows(projects, effectiveMissionProjectIds);
  const scheduleEligibility = buildScheduleWindowEligibility(scheduleWindows, rdoByCollaborator);
  const codeByProjectId = new Map(projects.map(project => [project.id, String(project.code || '')]).filter(([, code]) => code));
  const manualProjectsByDay = new Map();
  for (const item of manualDayOverrides) {
    const key = `${item.collaboratorId}:${new Date(item.workDate).toISOString().slice(0, 10)}`;
    if (!manualProjectsByDay.has(key)) manualProjectsByDay.set(key, []);
    if (item.projectId) manualProjectsByDay.get(key).push(item.projectId);
  }
  const pending = [];

  for (const { period, day } of latestPeriodDays(periods)) {
    const rdo = rdoByCollaborator.get(period.collaboratorId) || { dayProjects: new Map() };
    const manualProjectIds = manualProjectsByDay.get(`${period.collaboratorId}:${day.date}`) || [];
    const rdoProjects = rdo.dayProjects.get(day.date) || new Map();
    const mobilizationProjectIds = rdo.mobilizationProjectsByDate?.get(day.date) || new Set();
    const effectiveProjectIds = effectiveProjectsForDay({
      effectiveAllocationIndex,
      collaboratorId: period.collaboratorId,
      dateKey: day.date
    });
    const decision = buildDailyProjectWeights({
      tags: day.tags,
      rdoProjects,
      resolveTag,
      manualProjectIds,
      mobilizationProjectIds,
      effectiveProjectIds,
      scheduleWindowProjectIds: scheduleWindowsForDay({
        scheduleWindows,
        eligibleByProject: scheduleEligibility,
        collaboratorId: period.collaboratorId,
        dateKey: day.date
      }),
      missionGroupProjectsByProjectId
    });
    if (!allocationDecisionRequiresAction(decision)) continue;
    const tagProjectIds = new Set((day.tags || []).map(resolveTag).filter(Boolean));
    const rdoProjectIds = new Set(rdoProjects.keys());
    const projectIds = new Set([
      ...tagProjectIds,
      ...rdoProjectIds,
      ...(decision.candidateProjectIds || [])
    ]);
    pending.push({
      externalEmployeeId: period.externalEmployeeId,
      date: day.date,
      projectCodes: [...projectIds].map(id => codeByProjectId.get(id)).filter(Boolean).sort(),
      tagProjectCodes: [...tagProjectIds].map(id => codeByProjectId.get(id)).filter(Boolean).sort(),
      rdoProjectCodes: [...rdoProjectIds].map(id => codeByProjectId.get(id)).filter(Boolean).sort(),
      reason: decision.reason,
      ...((day.tags || []).some(isPontoTravelTag) ? { travelContext: true } : {})
    });
  }
  return pending.sort((left, right) => (
    left.date.localeCompare(right.date)
    || left.externalEmployeeId.localeCompare(right.externalEmployeeId)
  ));
}

export function filterCurrentlyResolvedAmbiguousDays({
  ambiguousDays = [],
  periodLinks = [],
  projects = [],
  rdoReports = [],
  manualDayOverrides = [],
  missionGroups = [],
  effectiveAllocations = [],
  effectiveMissionProjectIds = []
} = {}) {
  const collaboratorByExternalId = new Map();
  for (const link of periodLinks) {
    const externalEmployeeId = String(link.externalEmployeeId || '');
    if (externalEmployeeId && link.collaboratorId && !collaboratorByExternalId.has(externalEmployeeId)) {
      collaboratorByExternalId.set(externalEmployeeId, link.collaboratorId);
    }
  }
  const projectIdByCode = new Map(projects
    .filter(project => project?.id && project?.code)
    .map(project => [String(project.code).trim(), project.id]));
  const rdoByCollaborator = rdoDataByCollaboratorFromReports(rdoReports);
  const missionGroupProjectsByProjectId = buildMissionGroupProjectIndex(missionGroups);
  const effectiveAllocationIndex = buildEffectiveAllocationIndex(effectiveAllocations);
  const scheduleWindows = buildScheduleWindows(projects, effectiveMissionProjectIds);
  const scheduleEligibility = buildScheduleWindowEligibility(scheduleWindows, rdoByCollaborator);
  const manualProjectsByDay = new Map();
  for (const item of manualDayOverrides) {
    const key = `${item.collaboratorId}:${new Date(item.workDate).toISOString().slice(0, 10)}`;
    if (!manualProjectsByDay.has(key)) manualProjectsByDay.set(key, []);
    if (item.projectId) manualProjectsByDay.get(key).push(item.projectId);
  }

  return ambiguousDays.filter(item => {
    const collaboratorId = collaboratorByExternalId.get(String(item.externalEmployeeId));
    if (!collaboratorId) return true;
    const manualProjectIds = manualProjectsByDay.get(`${collaboratorId}:${item.date}`) || [];
    const collaboratorRdo = rdoByCollaborator.get(collaboratorId);
    const rdoProjects = collaboratorRdo?.dayProjects?.get(item.date) || new Map();
    const mobilizationProjectIds = collaboratorRdo?.mobilizationProjectsByDate?.get(item.date) || new Set();
    const effectiveProjectIds = effectiveProjectsForDay({
      effectiveAllocationIndex,
      collaboratorId,
      dateKey: item.date
    });
    const decision = buildDailyProjectWeights({
      tags: item.travelContext
        ? ['EM VIAGEM', ...(item.tagProjectCodes || [])]
        : item.tagProjectCodes || [],
      rdoProjects,
      resolveTag: code => projectIdByCode.get(String(code).trim()) || null,
      manualProjectIds,
      mobilizationProjectIds,
      effectiveProjectIds,
      scheduleWindowProjectIds: scheduleWindowsForDay({
        scheduleWindows,
        eligibleByProject: scheduleEligibility,
        collaboratorId,
        dateKey: item.date
      }),
      missionGroupProjectsByProjectId
    });
    return allocationDecisionRequiresAction(decision);
  });
}

export function partitionMissingProjectPendencies({
  ambiguousDays = [],
  projects = []
} = {}) {
  const knownProjectCodes = new Set(projects
    .map(project => String(project?.code || '').trim())
    .filter(Boolean));
  const actionableDays = [];
  const missingDays = [];

  for (const item of ambiguousDays) {
    const candidateCodes = [...new Set((item.projectCodes || [])
      .map(code => String(code || '').trim())
      .filter(Boolean))];
    if (candidateCodes.length > 0 && candidateCodes.every(code => !knownProjectCodes.has(code))) {
      missingDays.push(item);
    } else {
      actionableDays.push(item);
    }
  }

  return { actionableDays, missingDays };
}

function externalEmployeeDirectoryData(employee, seenAt) {
  const externalEmployeeId = String(employee?.id ?? '').trim();
  const externalName = String(employee?.name || `${employee?.first_name || ''} ${employee?.last_name || ''}`)
    .replace(/\s+/g, ' ')
    .trim() || `ID externo ${externalEmployeeId}`;
  return {
    externalEmployeeId,
    registrationNumber: normalizeRegistrationNumber(employee?.registration_number) || null,
    externalName,
    isActive: typeof employee?.active === 'boolean' ? employee.active : null,
    lastSeenAt: seenAt
  };
}

function safeExternalEmployeeProjection(employee) {
  return {
    externalEmployeeId: String(employee.externalEmployeeId),
    registrationNumber: employee.registrationNumber ? String(employee.registrationNumber) : null,
    externalName: String(employee.externalName || ''),
    isActive: typeof employee.isActive === 'boolean' ? employee.isActive : null,
    ignored: Boolean(employee.ignoredAt)
  };
}

export function createPontoMaisSyncService({
  db = prisma,
  configured = pontomaisConfigured,
  clientFactory = () => createPontoMaisClient(),
  now = () => new Date()
} = {}) {
  async function refreshExternalEmployeeDirectory(employees, seenAt) {
    const records = employees.map(employee => externalEmployeeDirectoryData(employee, seenAt));
    const ids = records.map(item => item.externalEmployeeId).filter(Boolean);
    if (!ids.length) return new Set();
    const existing = await db.pontoExternalEmployee.findMany({
      where: { externalEmployeeId: { in: ids } },
      select: {
        externalEmployeeId: true,
        registrationNumber: true,
        externalName: true,
        isActive: true,
        ignoredAt: true
      }
    });
    const existingById = new Map(existing.map(item => [String(item.externalEmployeeId), item]));
    const missing = records.filter(item => !existingById.has(item.externalEmployeeId));
    if (missing.length) {
      await db.pontoExternalEmployee.createMany({
        data: missing.map(item => ({ ...item, firstSeenAt: seenAt })),
        skipDuplicates: true
      });
    }
    const changed = records.filter(item => {
      const current = existingById.get(item.externalEmployeeId);
      return current && (
        current.registrationNumber !== item.registrationNumber
        || current.externalName !== item.externalName
        || current.isActive !== item.isActive
      );
    });
    await Promise.all(changed.map(item => db.pontoExternalEmployee.update({
      where: { externalEmployeeId: item.externalEmployeeId },
      data: {
        registrationNumber: item.registrationNumber,
        externalName: item.externalName,
        isActive: item.isActive
      }
    })));
    await db.pontoExternalEmployee.updateMany({
      where: { externalEmployeeId: { in: ids } },
      data: { lastSeenAt: seenAt }
    });
    return new Set(existing.filter(item => item.ignoredAt).map(item => String(item.externalEmployeeId)));
  }

  async function expireStaleRuns(currentTime, client = db) {
    const cutoff = new Date(currentTime.getTime() - RUN_STALE_AFTER_MS);
    await client.pontoSyncRun.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: cutoff } },
      data: {
        status: 'FAILED',
        completedAt: currentTime,
        errorCode: 'INTERRUPTED',
        errorMessage: 'A sincronização anterior foi interrompida antes da conclusão.'
      }
    });
    return cutoff;
  }

  async function admitRun({ startDate, endDate, requestedByUserId, trigger, startedAt }) {
    return db.$transaction(async tx => {
      // pg_advisory_xact_lock returns PostgreSQL void, which Prisma cannot
      // deserialize through $queryRaw. We only need the side effect here.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SYNC_ADVISORY_LOCK_ID})`;
      const cutoff = await expireStaleRuns(startedAt, tx);
      const running = await tx.pontoSyncRun.findFirst({
        where: { status: 'RUNNING', startedAt: { gte: cutoff } },
        orderBy: { startedAt: 'desc' }
      });
      if (running) return { running, run: null };
      const run = await tx.pontoSyncRun.create({
        data: {
          periodStart: dateFromKey(startDate),
          periodEnd: dateFromKey(endDate),
          status: 'RUNNING',
          trigger,
          requestedByUserId
        }
      });
      return { running: null, run };
    });
  }

  async function runSync({
    startDate,
    endDate,
    requestedByUserId = null,
    trigger = PONTO_SYNC_TRIGGER.MANUAL
  }) {
    if (!configured()) {
      throw new PontoSyncError('A integração com o Ponto Mais não está configurada.', {
        code: 'PONTOMAIS_NOT_CONFIGURED'
      });
    }

    const safeTrigger = Object.values(PONTO_SYNC_TRIGGER).includes(trigger)
      ? trigger
      : PONTO_SYNC_TRIGGER.MANUAL;
    const startedAt = now();
    const { running, run } = await admitRun({
      startDate,
      endDate,
      requestedByUserId,
      trigger: safeTrigger,
      startedAt
    });
    if (running) {
      throw new PontoSyncError('Já existe uma sincronização do Ponto Mais em andamento.', {
        code: 'SYNC_IN_PROGRESS', runId: running.id
      });
    }

    try {
      const client = clientFactory();
      const employees = await client.listEmployees();
      const ignoredExternalEmployeeIds = await refreshExternalEmployeeDirectory(employees, startedAt);
      const workDays = await client.listWorkDays(startDate, endDate);
      const timeCards = await client.listTimeCards(startDate, endDate);
      const [
        collaborators,
        externalLinks,
        projects,
        tagAliases,
        rdoReports,
        manualDayOverrides,
        missionGroups,
        effectiveAllocations,
        effectiveMissionProjectIds
      ] = await Promise.all([
        db.collaborator.findMany({
          select: { id: true, name: true, cpf: true, registrationNumber: true }
        }),
        db.pontoExternalEmployeeLink.findMany({
          select: { externalEmployeeId: true, collaboratorId: true }
        }),
        db.project.findMany({
          select: {
            id: true, code: true, name: true, isActive: true, deletedAt: true,
            mobilizationDate: true, demobilizationDate: true, operatorId: true, laborCollaboratorIds: true
          }
        }),
        db.pontoProjectTagAlias.findMany({
          select: { normalizedTag: true, projectId: true }
        }),
        db.report.findMany({
          where: {
            deletedAt: null,
            OR: [
              { reportType: 'RDO' },
              {
                reportDate: { gte: dateFromKey(startDate), lt: new Date(dateFromKey(endDate).getTime() + 86400000) },
                OR: [
                  { daytimeWorkedMinutes: { gt: 0 } },
                  { nighttimeWorkedMinutes: { gt: 0 } },
                  { services: { some: { startTime: { not: null }, endTime: { not: null } } } }
                ]
              }
            ]
          },
          select: {
            reportType: true,
            projectId: true,
            reportDate: true,
            daytimeWorkedMinutes: true,
            nighttimeWorkedMinutes: true,
            project: { select: { offshore: true, laborSleepModeByCollaborator: true, mobilizationDate: true } },
            collaborators: { select: { collaboratorId: true } },
            services: { select: { startTime: true, endTime: true } }
          }
        }),
        db.pontoDayProjectOverride.findMany({
          where: {
            workDate: {
              gte: dateFromKey(startDate),
              lt: new Date(dateFromKey(endDate).getTime() + 86400000)
            }
          },
          select: { collaboratorId: true, workDate: true, projectId: true }
        }),
        db.acompanhamentoMissionGroup?.findMany
          ? db.acompanhamentoMissionGroup.findMany({
            where: { status: 'ACTIVE' },
            select: {
              id: true,
              laborAllocationMode: true,
              primaryLaborProjectId: true,
              members: { select: { projectId: true } }
            }
          })
          : Promise.resolve([]),
        getOfficialEffectiveAllocations(db),
        getOfficialEffectiveMissionProjectIds(db)
      ]);

      const normalized = normalizePontoMaisSnapshot({
        periodStart: startDate,
        periodEnd: endDate,
        employees,
        workDays,
        timeCards,
        collaborators,
        externalLinks,
        ignoredExternalEmployeeIds: [...ignoredExternalEmployeeIds],
        projects,
        tagAliases
      });
      normalized.pending.ambiguousDays = buildAmbiguousDayPendencies({
        periods: normalized.periods,
        rdoReports,
        projects,
        tagAliases,
        manualDayOverrides,
        missionGroups,
        effectiveAllocations,
        effectiveMissionProjectIds
      });
      const pendingCount = normalized.pending.employees.length
        + normalized.pending.projectTags.length
        + normalized.pending.ambiguousDays.length;
      const summary = {
        collaboratorsTotal: normalized.collaboratorsTotal,
        pending: normalized.pending
      };

      const existing = await db.pontoImport.findFirst({
        where: { contentHash: normalized.contentHash, source: 'PONTOMAIS_API' },
        orderBy: { createdAt: 'desc' }
      });
      if (existing) {
        const completed = await db.pontoSyncRun.update({
          where: { id: run.id },
          data: {
            status: 'SUCCEEDED',
            importId: existing.id,
            employeesRead: employees.length,
            workDaysRead: workDays.length,
            timeCardsRead: timeCards.length,
            collaboratorsMatched: normalized.collaboratorsMatched,
            pendingCount,
            summary,
            completedAt: now()
          }
        });
        return resultFromRun(completed, {
          skippedDuplicate: true,
          importId: existing.id
        });
      }

      const created = await db.$transaction(async tx => {
        const imported = await tx.pontoImport.create({
          data: {
            fileName: `VR Ponto Mais — ${startDate} a ${endDate}`,
            contentHash: normalized.contentHash,
            source: 'PONTOMAIS_API',
            periodStart: dateFromKey(startDate),
            periodEnd: dateFromKey(endDate),
            rowsRead: normalized.rowsRead,
            collaboratorsTotal: normalized.collaboratorsTotal,
            collaboratorsMatched: normalized.collaboratorsMatched,
            summary,
            status: 'OK',
            importedByUserId: requestedByUserId,
            periods: { create: normalized.periods }
          }
        });
        const completed = await tx.pontoSyncRun.update({
          where: { id: run.id },
          data: {
            status: 'SUCCEEDED',
            importId: imported.id,
            employeesRead: employees.length,
            workDaysRead: workDays.length,
            timeCardsRead: timeCards.length,
            collaboratorsMatched: normalized.collaboratorsMatched,
            pendingCount,
            summary,
            completedAt: now()
          }
        });
        return { imported, completed };
      });

      return resultFromRun(created.completed, {
        skippedDuplicate: false,
        importId: created.imported.id
      });
    } catch (error) {
      const descriptor = errorDescriptor(error);
      await db.pontoSyncRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          errorCode: descriptor.code,
          errorMessage: descriptor.message,
          completedAt: now()
        }
      });
      throw new PontoSyncError(descriptor.message, {
        code: descriptor.code,
        runId: run.id,
        cause: error
      });
    }
  }

  async function getIntegrationStatus() {
    const cutoff = new Date(now().getTime() - RUN_STALE_AFTER_MS);
    const [running, lastSuccessfulRun, lastFailure, automationState] = await Promise.all([
      db.pontoSyncRun.findFirst({
        where: { status: 'RUNNING', startedAt: { gte: cutoff } },
        orderBy: { startedAt: 'desc' }
      }),
      db.pontoSyncRun.findFirst({ where: { status: 'SUCCEEDED' }, orderBy: { completedAt: 'desc' } }),
      db.pontoSyncRun.findFirst({ where: { status: 'FAILED' }, orderBy: { completedAt: 'desc' } }),
      db.pontoSyncState?.findUnique
        ? db.pontoSyncState.findUnique({ where: { id: 'pontomais' } })
        : Promise.resolve(null)
    ]);
    const projectRun = item => item ? {
      id: item.id,
      trigger: item.trigger || PONTO_SYNC_TRIGGER.MANUAL,
      periodStart: new Date(item.periodStart).toISOString().slice(0, 10),
      periodEnd: new Date(item.periodEnd).toISOString().slice(0, 10),
      completedAt: item.completedAt,
      pendingCount: item.pendingCount || 0,
      errorCode: item.errorCode || null,
      errorMessage: item.errorMessage || null
    } : null;
    return {
      configured: configured(),
      running: Boolean(running),
      automation: {
        bootstrapStatus: automationState?.bootstrapStatus || 'PENDING',
        historyStart: automationState?.historyStart ? new Date(automationState.historyStart).toISOString().slice(0, 10) : null,
        historyThrough: automationState?.historyThrough ? new Date(automationState.historyThrough).toISOString().slice(0, 10) : null,
        nextPeriodStart: automationState?.nextPeriodStart ? new Date(automationState.nextPeriodStart).toISOString().slice(0, 10) : null,
        lastDailySyncDate: automationState?.lastDailySyncDate ? new Date(automationState.lastDailySyncDate).toISOString().slice(0, 10) : null,
        lastAttemptAt: automationState?.lastAttemptAt || null,
        lastSuccessfulAt: automationState?.lastSuccessfulAt || null,
        lastErrorCode: automationState?.lastErrorCode || null,
        lastErrorMessage: automationState?.lastErrorMessage || null,
        scheduledTime: '03:00',
        timeZone: 'America/Sao_Paulo'
      },
      lastSuccessfulRun: projectRun(lastSuccessfulRun),
      lastFailure: projectRun(lastFailure)
    };
  }

  async function listSyncRuns({ limit = 50 } = {}) {
    const runs = await db.pontoSyncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: Math.min(200, Math.max(1, Number(limit) || 50))
    });
    return runs.map(safeRunProjection);
  }

  async function getPending() {
    const runs = await db.pontoSyncRun.findMany({
      where: { status: 'SUCCEEDED' },
      orderBy: { completedAt: 'desc' },
      select: { periodStart: true, periodEnd: true, summary: true }
    });
    if (!runs.length) {
      return {
        employees: [],
        ambiguousDays: [],
        missingProjects: { projectTags: [], ambiguousDays: [] }
      };
    }

    const employeesById = new Map();
    const tagsByKey = new Map();
    const ambiguousByDay = new Map();
    const newerCoveredDays = new Set();
    for (const run of runs) {
      const runPending = safePendingProjection(run.summary);
      for (const item of runPending.employees) {
        if (!employeesById.has(item.externalEmployeeId)) employeesById.set(item.externalEmployeeId, item);
      }
      for (const item of runPending.projectTags) {
        if (!tagsByKey.has(item.normalizedTag)) tagsByKey.set(item.normalizedTag, item);
      }
      for (const item of runPending.ambiguousDays) {
        const key = `${item.externalEmployeeId}:${item.date}`;
        if (!newerCoveredDays.has(item.date) && !ambiguousByDay.has(key)) ambiguousByDay.set(key, item);
      }

      const start = new Date(run.periodStart);
      const end = new Date(run.periodEnd);
      for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 86400000) {
        newerCoveredDays.add(new Date(cursor).toISOString().slice(0, 10));
      }
    }

    const pending = {
      employees: [...employeesById.values()],
      projectTags: [...tagsByKey.values()],
      ambiguousDays: [...ambiguousByDay.values()].sort((left, right) => (
        left.date.localeCompare(right.date)
        || left.externalEmployeeId.localeCompare(right.externalEmployeeId)
      ))
    };
    const [
      employeeLinks,
      tagAliases,
      ignoredEmployees,
      ignoredTags,
      storedPeriods,
      projects,
      missionGroups,
      effectiveAllocations,
      effectiveMissionProjectIds
    ] = await Promise.all([
      db.pontoExternalEmployeeLink.findMany({
        where: { externalEmployeeId: { in: pending.employees.map(item => item.externalEmployeeId) } },
        select: { externalEmployeeId: true }
      }),
      db.pontoProjectTagAlias.findMany({
        select: { normalizedTag: true, projectId: true }
      }),
      db.pontoExternalEmployee.findMany({
        where: { ignoredAt: { not: null } },
        select: { externalEmployeeId: true }
      }),
      db.pontoIgnoredProjectTag?.findMany
        ? db.pontoIgnoredProjectTag.findMany({ select: { normalizedTag: true } })
        : Promise.resolve([]),
      db.pontoPeriodSummary.findMany({
        where: {
          externalEmployeeId: { not: null },
          collaboratorId: { not: null },
          import: { source: 'PONTOMAIS_API' }
        },
        select: {
          externalEmployeeId: true,
          collaboratorId: true,
          monthly: true,
          createdAt: true,
          import: { select: { createdAt: true } }
        }
      }),
      db.project.findMany({
        select: {
          id: true, code: true,
          mobilizationDate: true, demobilizationDate: true, operatorId: true, laborCollaboratorIds: true
        }
      }),
      db.acompanhamentoMissionGroup?.findMany
        ? db.acompanhamentoMissionGroup.findMany({
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            laborAllocationMode: true,
            primaryLaborProjectId: true,
            members: { select: { projectId: true } }
          }
        })
        : Promise.resolve([]),
      getOfficialEffectiveAllocations(db),
      getOfficialEffectiveMissionProjectIds(db)
    ]);
    const linkedEmployees = new Set(employeeLinks.map(item => String(item.externalEmployeeId)));
    const linkedTags = new Set(tagAliases.map(item => normalizeProjectTag(item.normalizedTag)));
    const ignoredExternalIds = new Set(ignoredEmployees.map(item => String(item.externalEmployeeId)));
    const ignoredTagSet = new Set(ignoredTags.map(item => normalizeProjectTag(item.normalizedTag)));
    const allDateKeys = [...new Set([
      ...pending.ambiguousDays.map(item => item.date),
      ...latestPeriodDays(storedPeriods).map(item => item.day.date)
    ])].sort();
    const reportDates = allDateKeys.map(dateFromKey);
    const collaboratorIds = [...new Set(storedPeriods.map(item => item.collaboratorId).filter(Boolean))];
    const reportScope = [{
      reportDate: { in: reportDates },
      OR: [
        { reportType: 'RDO' },
        { daytimeWorkedMinutes: { gt: 0 } },
        { nighttimeWorkedMinutes: { gt: 0 } },
        { services: { some: { startTime: { not: null }, endTime: { not: null } } } }
      ]
    }];
    if (allDateKeys.length && collaboratorIds.length) {
      reportScope.push({
        reportType: 'RDO',
        // O fallback legado precisa saber se o colaborador aparece nominalmente em algum RDO do
        // período, não apenas no dia pendente. Relatórios independentes continuam restritos aos
        // dias exatos acima; este escopo ampliado é exclusivo para RDO.
        reportDate: { lte: now() },
        collaborators: { some: { collaboratorId: { in: collaboratorIds } } }
      });
    }
    const [rdoReports, manualDayOverrides] = reportDates.length
      ? await Promise.all([
        db.report.findMany({
          where: {
            deletedAt: null,
            OR: reportScope
          },
          select: {
            reportType: true,
            projectId: true,
            reportDate: true,
            daytimeWorkedMinutes: true,
            nighttimeWorkedMinutes: true,
            project: { select: { offshore: true, laborSleepModeByCollaborator: true, mobilizationDate: true } },
            collaborators: { select: { collaboratorId: true } },
            services: { select: { startTime: true, endTime: true } }
          }
        }),
        collaboratorIds.length
          ? db.pontoDayProjectOverride.findMany({
            where: {
              collaboratorId: { in: collaboratorIds },
              workDate: { in: reportDates }
            },
            select: { collaboratorId: true, workDate: true, projectId: true }
          })
          : Promise.resolve([])
      ])
      : [[], []];
    const currentAmbiguousByDay = new Map(pending.ambiguousDays.map(item => (
      [`${item.externalEmployeeId}:${item.date}`, item]
    )));
    for (const item of buildAmbiguousDayPendencies({
      periods: storedPeriods,
      rdoReports,
      projects,
      tagAliases,
      manualDayOverrides,
      missionGroups,
      effectiveAllocations,
      effectiveMissionProjectIds
    })) {
      currentAmbiguousByDay.set(`${item.externalEmployeeId}:${item.date}`, item);
    }
    let ambiguousDays = [...currentAmbiguousByDay.values()]
      .filter(item => !ignoredExternalIds.has(item.externalEmployeeId));
    if (ambiguousDays.length) {
      const periodLinks = storedPeriods.map(item => ({
        externalEmployeeId: item.externalEmployeeId,
        collaboratorId: item.collaboratorId
      }));
      ambiguousDays = filterCurrentlyResolvedAmbiguousDays({
        ambiguousDays,
        periodLinks,
        projects,
        rdoReports,
        manualDayOverrides,
        missionGroups,
        effectiveAllocations,
        effectiveMissionProjectIds
      });
    }
    const externalDirectory = ambiguousDays.length
      ? await db.pontoExternalEmployee.findMany({
        where: { externalEmployeeId: { in: [...new Set(ambiguousDays.map(item => item.externalEmployeeId))] } },
        select: { externalEmployeeId: true, externalName: true }
      })
      : [];
    const externalNameById = new Map(externalDirectory.map(item => [String(item.externalEmployeeId), String(item.externalName || '')]));
    const visibleProjectTags = pending.projectTags.filter(item => (
      !linkedTags.has(item.normalizedTag) && !ignoredTagSet.has(normalizeProjectTag(item.normalizedTag))
    ));
    const namedAmbiguousDays = ambiguousDays.map(item => ({
      ...item,
      externalName: externalNameById.get(item.externalEmployeeId) || `ID externo ${item.externalEmployeeId}`
    }));
    const { actionableDays, missingDays } = partitionMissingProjectPendencies({
      ambiguousDays: namedAmbiguousDays,
      projects
    });
    // Etiqueta ignorada leva junto os dias que citavam só aquela missão: senão o gestor tiraria a
    // etiqueta da fila e os dias dela continuariam cobrando cadastro.
    const ignoredMissionCodes = new Set([...ignoredTagSet].map(extractMissionCode).filter(Boolean));
    const visibleMissingDays = missingDays.filter(item => (
      !(item.projectCodes || []).length
      || !(item.projectCodes || []).every(code => ignoredMissionCodes.has(String(code)))
    ));
    return {
      employees: pending.employees.filter(item => (
        !linkedEmployees.has(item.externalEmployeeId) && !ignoredExternalIds.has(item.externalEmployeeId)
      )),
      ambiguousDays: actionableDays,
      missingProjects: {
        projectTags: visibleProjectTags,
        ambiguousDays: visibleMissingDays
      }
    };
  }

  async function listExternalEmployees() {
    const employees = await db.pontoExternalEmployee.findMany({
      orderBy: [{ ignoredAt: 'asc' }, { externalName: 'asc' }],
      select: {
        externalEmployeeId: true,
        registrationNumber: true,
        externalName: true,
        isActive: true,
        ignoredAt: true
      }
    });
    return employees.map(safeExternalEmployeeProjection);
  }

  async function setExternalEmployeeIgnored({ externalEmployeeId, ignored, ignoredByUserId = null }) {
    const existing = await db.pontoExternalEmployee.findUnique({ where: { externalEmployeeId } });
    if (!existing) {
      throw new PontoSyncError('Colaborador do Ponto Mais não encontrado.', { code: 'EXTERNAL_EMPLOYEE_NOT_FOUND' });
    }
    const updated = await db.pontoExternalEmployee.update({
      where: { externalEmployeeId },
      data: {
        ignoredAt: ignored ? now() : null,
        ignoredByUserId: ignored ? ignoredByUserId : null
      }
    });
    return safeExternalEmployeeProjection(updated);
  }

  async function linkExternalEmployee({ externalEmployeeId, collaboratorId, createdByUserId = null }) {
    const collaborator = await db.collaborator.findUnique({ where: { id: collaboratorId } });
    if (!collaborator) {
      throw new PontoSyncError('Colaborador não encontrado.', { code: 'COLLABORATOR_NOT_FOUND' });
    }
    const latestSummary = await db.pontoPeriodSummary.findFirst({
      where: { externalEmployeeId },
      orderBy: { createdAt: 'desc' },
      select: { registrationNumber: true, rawName: true, normalizedName: true }
    });
    const normalizedName = normalizePontoName(latestSummary?.normalizedName || latestSummary?.rawName);

    return db.$transaction(async tx => {
      await tx.pontoExternalEmployeeLink.upsert({
        where: { externalEmployeeId },
        create: {
          externalEmployeeId,
          registrationNumber: latestSummary?.registrationNumber || null,
          externalName: latestSummary?.rawName || `ID externo ${externalEmployeeId}`,
          collaboratorId,
          matchSource: 'MANUAL',
          createdByUserId
        },
        update: {
          registrationNumber: latestSummary?.registrationNumber || null,
          externalName: latestSummary?.rawName || `ID externo ${externalEmployeeId}`,
          collaboratorId,
          matchSource: 'MANUAL',
          createdByUserId
        }
      });
      if (normalizedName) {
        await tx.pontoNameAlias.upsert({
          where: { normalizedName },
          create: {
            normalizedName,
            rawName: latestSummary?.rawName || normalizedName,
            collaboratorId,
            createdByUserId
          },
          update: {
            rawName: latestSummary?.rawName || normalizedName,
            collaboratorId,
            createdByUserId
          }
        });
      }
      const result = await tx.pontoPeriodSummary.updateMany({
        where: {
          OR: [
            { externalEmployeeId },
            ...(normalizedName ? [{ externalEmployeeId: null, normalizedName }] : [])
          ]
        },
        data: { collaboratorId }
      });
      return { externalEmployeeId, collaboratorId, normalizedName: normalizedName || null, relinked: result.count };
    });
  }

  async function linkProjectTag({ rawTag, projectId, createdByUserId = null }) {
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) throw new PontoSyncError('Projeto não encontrado.', { code: 'PROJECT_NOT_FOUND' });
    const normalizedTag = normalizeProjectTag(rawTag);
    if (!normalizedTag) throw new PontoSyncError('Etiqueta inválida.', { code: 'INVALID_TAG' });
    if (isPontoTravelTag(rawTag)) {
      throw new PontoSyncError('Etiqueta de viagem não pode ser vinculada como projeto.', { code: 'INVALID_TAG' });
    }
    await db.pontoProjectTagAlias.upsert({
      where: { normalizedTag },
      create: { normalizedTag, rawTag: String(rawTag).trim(), projectId, createdByUserId },
      update: { rawTag: String(rawTag).trim(), projectId, createdByUserId }
    });
    return { normalizedTag, projectId };
  }

  async function setDayProjectOverride({
    externalEmployeeId,
    date,
    projectId = null,
    projectIds = null,
    createdByUserId = null
  }) {
    const selectedProjectIds = [...new Set([
      ...(Array.isArray(projectIds) ? projectIds : []),
      ...(projectId ? [projectId] : [])
    ].map(value => String(value || '').trim()).filter(Boolean))];
    if (selectedProjectIds.length === 0) {
      throw new PontoSyncError('Selecione ao menos um projeto candidato.', { code: 'INVALID_PROJECT_SELECTION' });
    }
    const pending = await getPending();
    const item = [
      ...pending.ambiguousDays,
      ...pending.missingProjects.ambiguousDays
    ].find(candidate => (
      candidate.externalEmployeeId === externalEmployeeId && candidate.date === date
    ));
    if (!item) {
      throw new PontoSyncError('Pendência de jornada não encontrada.', { code: 'PENDING_NOT_FOUND' });
    }
    const projects = await Promise.all(selectedProjectIds.map(selectedProjectId => (
      db.project.findUnique({ where: { id: selectedProjectId } })
    )));
    if (projects.some(project => !project)) {
      throw new PontoSyncError('Projeto não encontrado.', { code: 'PROJECT_NOT_FOUND' });
    }
    if (projects.some(project => !item.projectCodes.includes(String(project.code)))) {
      throw new PontoSyncError('O projeto selecionado não pertence aos candidatos desta pendência.', {
        code: 'INVALID_PROJECT_SELECTION'
      });
    }
    const period = await db.pontoPeriodSummary.findFirst({
      where: {
        externalEmployeeId,
        collaboratorId: { not: null },
        periodStart: { lte: dateFromKey(date) },
        periodEnd: { gte: dateFromKey(date) }
      },
      orderBy: { createdAt: 'desc' },
      select: { collaboratorId: true }
    });
    if (!period?.collaboratorId) {
      throw new PontoSyncError('Colaborador não encontrado para esta jornada.', { code: 'COLLABORATOR_NOT_FOUND' });
    }
    const workDate = dateFromKey(date);
    if (db.pontoDayProjectOverride.deleteMany && db.pontoDayProjectOverride.createMany) {
      const persist = async tx => {
        await tx.pontoDayProjectOverride.deleteMany({
          where: { collaboratorId: period.collaboratorId, workDate }
        });
        await tx.pontoDayProjectOverride.createMany({
          data: selectedProjectIds.map(selectedProjectId => ({
            collaboratorId: period.collaboratorId,
            workDate,
            projectId: selectedProjectId,
            externalEmployeeId,
            createdByUserId
          }))
        });
      };
      if (db.$transaction) await db.$transaction(persist);
      else await persist(db);
    } else if (selectedProjectIds.length === 1 && db.pontoDayProjectOverride.upsert) {
      // Compatibilidade para doubles de teste anteriores à cardinalidade múltipla.
      await db.pontoDayProjectOverride.upsert({
        where: {
          collaboratorId_workDate: {
            collaboratorId: period.collaboratorId,
            workDate
          }
        },
        create: {
          collaboratorId: period.collaboratorId,
          workDate,
          projectId: selectedProjectIds[0],
          externalEmployeeId,
          createdByUserId
        },
        update: { projectId: selectedProjectIds[0], externalEmployeeId, createdByUserId }
      });
    } else {
      throw new PontoSyncError('Não foi possível persistir a seleção múltipla.', { code: 'INVALID_PROJECT_SELECTION' });
    }
    return projectIds
      ? { externalEmployeeId, date, projectIds: selectedProjectIds }
      : { externalEmployeeId, date, projectId: selectedProjectIds[0] };
  }

  async function setProjectTagIgnored({ rawTag, ignored = true, ignoredByUserId = null }) {
    const normalizedTag = normalizeProjectTag(rawTag);
    if (!normalizedTag) throw new PontoSyncError('Etiqueta inválida.', { code: 'INVALID_TAG' });
    if (!ignored) {
      await db.pontoIgnoredProjectTag.deleteMany({ where: { normalizedTag } });
      return { normalizedTag, ignored: false };
    }
    const alias = await db.pontoProjectTagAlias.findUnique({ where: { normalizedTag } });
    if (alias) {
      throw new PontoSyncError('Esta etiqueta já está vinculada a um projeto.', { code: 'INVALID_TAG' });
    }
    await db.pontoIgnoredProjectTag.upsert({
      where: { normalizedTag },
      create: { normalizedTag, rawTag: String(rawTag).trim(), ignoredByUserId },
      update: { rawTag: String(rawTag).trim(), ignoredByUserId }
    });
    return { normalizedTag, ignored: true };
  }

  async function listIgnoredProjectTags() {
    const rows = await db.pontoIgnoredProjectTag.findMany({ orderBy: { rawTag: 'asc' } });
    return rows.map(item => ({ normalizedTag: item.normalizedTag, rawTag: item.rawTag }));
  }

  async function setDayProjectOverridesBatch({ items = [], createdByUserId = null }) {
    const results = [];
    for (const item of items) {
      results.push(await setDayProjectOverride({ ...item, createdByUserId }));
    }
    return { updated: results.length, items: results };
  }

  return {
    runSync,
    getIntegrationStatus,
    listSyncRuns,
    getPending,
    listExternalEmployees,
    setExternalEmployeeIgnored,
    linkExternalEmployee,
    linkProjectTag,
    setProjectTagIgnored,
    listIgnoredProjectTags,
    setDayProjectOverride,
    setDayProjectOverridesBatch
  };
}

const defaultService = createPontoMaisSyncService();

export const runPontoMaisSync = input => defaultService.runSync(input);
export const getPontoMaisIntegrationStatus = () => defaultService.getIntegrationStatus();
export const listPontoMaisSyncRuns = input => defaultService.listSyncRuns(input);
export const getPontoMaisPending = () => defaultService.getPending();
export const listPontoMaisExternalEmployees = () => defaultService.listExternalEmployees();
export const setPontoMaisExternalEmployeeIgnored = input => defaultService.setExternalEmployeeIgnored(input);
export const linkPontoMaisExternalEmployee = input => defaultService.linkExternalEmployee(input);
export const linkPontoMaisProjectTag = input => defaultService.linkProjectTag(input);
export const setPontoMaisProjectTagIgnored = input => defaultService.setProjectTagIgnored(input);
export const listPontoMaisIgnoredProjectTags = () => defaultService.listIgnoredProjectTags();
export const setPontoMaisDayProjectOverride = input => defaultService.setDayProjectOverride(input);
export const setPontoMaisDayProjectOverridesBatch = input => defaultService.setDayProjectOverridesBatch(input);
