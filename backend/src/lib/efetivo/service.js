import { getEfetivoReferenceSetting } from './settings.js';
import { buildProductivityReport } from './productivity.js';
import { ensureNoAbsenceOverlap, validateAbsencePeriod } from './absences.js';
import { withCurrentJobRole } from '../collaborators/job-role-service.js';

export function efetivoStatus() {
  return {
    module: 'efetivo',
    status: 'ok'
  };
}

async function resolveDependencies(dependencies = {}) {
  const database = dependencies.database || (await import('../prisma.js')).default;
  const laborCost = dependencies.laborCost || await import('../acompanhamento/labor-cost.js');
  return { database, laborCost };
}

function periodBounds(year, cutoffMonth) {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year, cutoffMonth, 0))
  };
}

function pendingUnlinkedRows(rows) {
  const unique = new Map();
  for (const row of rows) {
    const key = String(row.externalEmployeeId || row.normalizedName || row.rawName || row.id || '').trim();
    if (!key || unique.has(key)) continue;
    unique.set(key, {
      tipo: 'PONTO_SEM_VINCULO',
      descricao: `${row.rawName || row.normalizedName || 'Pessoa do ponto'} está sem vínculo com o cadastro.`,
      referencia: row.externalEmployeeId || row.normalizedName || null
    });
  }
  return [...unique.values()];
}

function collaboratorPendingItems(collaborators, jobRoles, reportedIds) {
  const roles = new Map(jobRoles.map(role => [role.id, role]));
  const pending = [];
  for (const collaborator of collaborators) {
    const role = roles.get(collaborator.jobRoleId);
    if (!role) {
      pending.push({
        tipo: 'CARGO_NAO_CADASTRADO',
        descricao: `${collaborator.name} não possui um cargo canônico válido.`,
        referencia: collaborator.id
      });
      continue;
    }
    if (role.isOperational !== false && !reportedIds.has(collaborator.id)) {
      pending.push({
        tipo: 'SEM_DADOS_PERIODO',
        descricao: `${collaborator.name} não possui dados de ponto no período analisado.`,
        referencia: collaborator.id
      });
    }
  }
  return pending;
}

function serializeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function buildEfetivoProductivity(filters, dependencies = {}) {
  const year = Number(filters.year ?? filters.ano);
  const cutoffMonth = Number(filters.cutoffMonth ?? filters.ateMes);
  const now = dependencies.now ? new Date(dependencies.now) : new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const { start, end } = periodBounds(year, cutoffMonth);
  const { database, laborCost } = await resolveDependencies(dependencies);

  const [
    rows,
    ignoredEmployees,
    collaborators,
    jobRoles,
    absences,
    syncState,
    referenceSetting
  ] = await Promise.all([
    database.pontoPeriodSummary.findMany({
      where: {
        periodStart: { lte: end },
        periodEnd: { gte: start }
      },
      include: {
        collaborator: {
          select: {
            id: true,
            name: true,
            jobRoleId: true,
            jobRole: { select: { id: true, name: true } },
            admissionDate: true,
            terminationDate: true,
            isActive: true
          }
        },
        import: { select: { createdAt: true } }
      }
    }),
    database.pontoExternalEmployee.findMany({
      where: { ignoredAt: { not: null } },
      select: { externalEmployeeId: true }
    }),
    database.collaborator.findMany({
      where: {
        OR: [
          { isActive: true },
          { terminationDate: { not: null } }
        ],
        AND: [
          { OR: [{ admissionDate: null }, { admissionDate: { lte: end } }] },
          { OR: [{ terminationDate: null }, { terminationDate: { gte: start } }] }
        ]
      },
      select: {
        id: true,
        name: true,
        jobRoleId: true,
        jobRole: { select: { id: true, name: true } },
        admissionDate: true,
        terminationDate: true,
        isActive: true
      },
      orderBy: { name: 'asc' }
    }),
    database.jobRole.findMany({
      select: { id: true, name: true, isOperational: true, isActive: true }
    }),
    database.collaboratorAbsence.findMany({
      where: {
        deletedAt: null,
        type: 'FERIAS',
        startDate: { lte: end },
        endDate: { gte: start }
      },
      select: {
        collaboratorId: true,
        type: true,
        startDate: true,
        endDate: true,
        deletedAt: true
      }
    }),
    database.pontoSyncState.findUnique({
      where: { id: 'pontomais' },
      select: { lastDailySyncDate: true, historyStart: true, historyThrough: true }
    }),
    getEfetivoReferenceSetting(database)
  ]);

  const ignoredIds = ignoredEmployees.map(item => item.externalEmployeeId);
  const linkedRows = rows.filter(row => row.collaboratorId);
  const unlinkedRows = rows.filter(row => !row.collaboratorId);
  const filteredLinkedRows = laborCost.filterIgnoredPontoPeriods(linkedRows, ignoredIds);
  const filteredUnlinkedRows = laborCost.filterIgnoredPontoPeriods(unlinkedRows, ignoredIds);
  const mergedPeriods = laborCost.mergePontoPeriods(filteredLinkedRows);
  const report = buildProductivityReport({
    collaborators,
    jobRoles,
    periods: mergedPeriods,
    filters: { year, cutoffMonth, currentMonth },
    reference: referenceSetting.referenciaMensalHH,
    absences,
    stabilityReferenceDate: syncState?.lastDailySyncDate || now
  });
  const reportedIds = new Set(report.colaboradores.map(item => item.id));
  const pendentes = [
    ...pendingUnlinkedRows(filteredUnlinkedRows),
    ...collaboratorPendingItems(collaborators, jobRoles, reportedIds)
  ];
  report.resumo.pendencias = pendentes.length;

  return {
    report,
    pendentes,
    sincronizacao: {
      ultimaSincronizacao: serializeDate(syncState?.lastDailySyncDate),
      inicioHistorico: serializeDate(syncState?.historyStart),
      fimHistorico: serializeDate(syncState?.historyThrough)
    }
  };
}

export async function getEfetivoProductivity(filters, dependencies = {}) {
  const result = await buildEfetivoProductivity(filters, dependencies);
  const { detalhesPorColaborador: _details, ...report } = result.report;
  return {
    ...report,
    sincronizacao: result.sincronizacao,
    pendentes: result.pendentes
  };
}

export async function getEfetivoCollaboratorProductivity(collaboratorId, filters, dependencies = {}) {
  const result = await buildEfetivoProductivity(filters, dependencies);
  const collaborator = result.report.colaboradores.find(item => item.id === collaboratorId);
  if (!collaborator) return null;
  return {
    colaborador: collaborator,
    meses: result.report.detalhesPorColaborador.get(collaboratorId) || []
  };
}

export async function listEfetivoCollaborators(dependencies = {}) {
  const { database } = await resolveDependencies({ ...dependencies, laborCost: dependencies.laborCost || {} });
  const items = await database.collaborator.findMany({
    select: { id: true, name: true, jobRoleId: true, jobRole: { select: { id: true, name: true } }, isActive: true },
    orderBy: { name: 'asc' }
  });
  return items.map(withCurrentJobRole);
}

function absenceDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function absenceBounds(year) {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year, 11, 31))
  };
}

export async function listEfetivoAbsences(filters, dependencies = {}) {
  const { database } = await resolveDependencies({ ...dependencies, laborCost: dependencies.laborCost || {} });
  const { start, end } = absenceBounds(Number(filters.year ?? filters.ano));
  return database.collaboratorAbsence.findMany({
    where: {
      deletedAt: null,
      type: { in: ['FERIAS', 'FOLGA', 'AFASTAMENTO'] },
      startDate: { lte: end },
      endDate: { gte: start },
      ...(filters.collaboratorId ? { collaboratorId: filters.collaboratorId } : {})
    },
    include: { collaborator: { select: { id: true, name: true, jobRoleId: true, jobRole: { select: { id: true, name: true } } } } },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }]
  }).then(items => items.map(item => ({ ...item, collaborator: withCurrentJobRole(item.collaborator) })));
}

async function absenceConflicts(database, collaboratorId) {
  return database.collaboratorAbsence.findMany({
    where: { collaboratorId, deletedAt: null, type: { in: ['FERIAS', 'FOLGA', 'AFASTAMENTO'] } },
    select: { id: true, startDate: true, endDate: true, deletedAt: true }
  });
}

export async function createEfetivoAbsence(payload, createdByUserId, dependencies = {}) {
  const { database } = await resolveDependencies({ ...dependencies, laborCost: dependencies.laborCost || {} });
  const period = validateAbsencePeriod(payload);
  const existing = await absenceConflicts(database, payload.collaboratorId);
  ensureNoAbsenceOverlap(existing, period);
  return database.collaboratorAbsence.create({
    data: {
      collaboratorId: payload.collaboratorId,
      type: payload.type || 'FERIAS',
      startDate: absenceDate(period.startDate),
      endDate: absenceDate(period.endDate),
      note: String(payload.note || '').trim() || null,
      createdByUserId: createdByUserId || null
    },
    include: { collaborator: { select: { id: true, name: true, jobRoleId: true, jobRole: { select: { id: true, name: true } } } } }
  }).then(item => ({ ...item, collaborator: withCurrentJobRole(item.collaborator) }));
}

export async function updateEfetivoAbsence(id, payload, dependencies = {}) {
  const { database } = await resolveDependencies({ ...dependencies, laborCost: dependencies.laborCost || {} });
  const existing = await database.collaboratorAbsence.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) {
    const error = new Error('Período de férias não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  const period = validateAbsencePeriod({
    startDate: payload.startDate ?? existing.startDate,
    endDate: payload.endDate ?? existing.endDate
  });
  const conflicts = await absenceConflicts(database, existing.collaboratorId);
  ensureNoAbsenceOverlap(conflicts, period, existing.id);
  return database.collaboratorAbsence.update({
    where: { id },
    data: {
      startDate: absenceDate(period.startDate),
      endDate: absenceDate(period.endDate),
      ...(payload.type !== undefined ? { type: payload.type } : {}),
      ...(payload.note !== undefined ? { note: String(payload.note || '').trim() || null } : {})
    },
    include: { collaborator: { select: { id: true, name: true, jobRoleId: true, jobRole: { select: { id: true, name: true } } } } }
  }).then(item => ({ ...item, collaborator: withCurrentJobRole(item.collaborator) }));
}

export async function deleteEfetivoAbsence(id, dependencies = {}) {
  const { database } = await resolveDependencies({ ...dependencies, laborCost: dependencies.laborCost || {} });
  const existing = await database.collaboratorAbsence.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) {
    const error = new Error('Período de férias não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  return database.collaboratorAbsence.update({
    where: { id },
    data: { deletedAt: new Date() }
  });
}
