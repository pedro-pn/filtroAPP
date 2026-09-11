import { buildMaintenanceScheduleItem } from '../../operational-reports/domain.js';
import { calculateDailyCapacity } from '../planning/capacity.js';
import { missionEndsOnOrAfter } from '../planning/mission-period.js';

function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10) || null;
}

function utcDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function calibrationState(equipment, category, targetDate) {
  const required = category.supportsCalibration || equipment.hasCalibration;
  if (!required) return { required: false, status: 'NOT_REQUIRED', expiresAt: null, valid: true };
  const expiresAt = dateKey(equipment.expiresAt);
  if (!equipment.hasCalibration || !expiresAt) return { required: true, status: 'MISSING', expiresAt, valid: false };
  const valid = expiresAt >= targetDate;
  return { required: true, status: valid ? 'VALID' : 'EXPIRED', expiresAt, valid };
}

function maintenanceState(equipment, category, targetDate) {
  const schedule = buildMaintenanceScheduleItem({ ...equipment, category }, targetDate);
  const valid = ['UPCOMING', 'DUE_TODAY'].includes(schedule.status);
  return {
    status: schedule.status,
    lastMaintenanceDate: schedule.lastMaintenanceDate,
    nextMaintenanceDate: schedule.nextMaintenanceDate,
    valid
  };
}

export function equipmentAssignmentsAt(romaneios = [], targetDate) {
  const balances = new Map();
  const ordered = [...romaneios].sort((left, right) => (
    dateKey(left.romaneioDate).localeCompare(dateKey(right.romaneioDate))
    || String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
  ));
  for (const romaneio of ordered) {
    if (dateKey(romaneio.romaneioDate) > targetDate) continue;
    const multiplier = romaneio.type === 'INBOUND' ? -1 : 1;
    for (const item of romaneio.items || []) {
      const equipmentId = item.catalogItem?.sourceId;
      if (!equipmentId) continue;
      const key = `${equipmentId}:${romaneio.projectId}`;
      const previous = balances.get(key) || {
        equipmentId,
        projectId: romaneio.projectId,
        project: romaneio.project || null,
        quantity: 0,
        lastMovementAt: null
      };
      previous.quantity += multiplier * Number(item.quantity || 0);
      previous.project = romaneio.project || previous.project;
      previous.lastMovementAt = dateKey(romaneio.romaneioDate);
      balances.set(key, previous);
    }
  }
  const byEquipment = new Map();
  for (const assignment of balances.values()) {
    if (assignment.quantity <= 0.0001) continue;
    const entries = byEquipment.get(assignment.equipmentId) || [];
    entries.push(assignment);
    byEquipment.set(assignment.equipmentId, entries);
  }
  return byEquipment;
}

export function buildEquipmentPlanningCatalog(categories = [], romaneios = [], targetDate, currentProjectId = null) {
  const assignments = equipmentAssignmentsAt(romaneios, targetDate);
  return categories.map(category => {
    const equipment = (category.equipment || []).map(item => {
      const currentAssignments = (assignments.get(item.id) || []).filter(assignment => assignment.projectId !== currentProjectId);
      const expectedBack = currentAssignments.length > 0 && currentAssignments.every(assignment => {
        const returnDate = dateKey(assignment.project?.demobilizationDate);
        return Boolean(returnDate && returnDate < targetDate);
      });
      const availabilityStatus = currentAssignments.length === 0
        ? 'AVAILABLE'
        : expectedBack ? 'EXPECTED_RETURN' : 'ALLOCATED';
      return {
        id: item.id,
        code: item.code,
        name: item.name,
        availabilityStatus,
        availableAtMobilization: availabilityStatus !== 'ALLOCATED',
        assignments: currentAssignments.map(assignment => ({
          expectedReturnDate: dateKey(assignment.project?.demobilizationDate)
        })),
        calibration: calibrationState(item, category, targetDate),
        maintenance: maintenanceState(item, category, targetDate)
      };
    });
    return {
      id: category.id,
      name: category.name,
      order: category.order,
      equipment,
      totalCount: equipment.length,
      availableCount: equipment.filter(item => item.availableAtMobilization).length
    };
  });
}

function publicTeamPlanning(workflow, roleCatalog) {
  const availabilityByRole = new Map(roleCatalog.map(role => [role.id, role]));
  const demands = (workflow.teamDemands || []).map(item => {
    const role = availabilityByRole.get(item.jobRoleId);
    const availableCount = role?.availableCount || 0;
    const requiredCount = Number(item.requiredCount || 0);
    return {
      id: item.id,
      jobRoleId: item.jobRoleId,
      jobRoleName: item.jobRole?.name || role?.name || 'Cargo indisponível',
      calendarColor: item.jobRole?.calendarColor || role?.calendarColor || '#64748B',
      requiredCount,
      availableCount,
      hiringNeed: Math.max(0, requiredCount - availableCount)
    };
  });
  return {
    defined: workflow.teamPlanDefined ?? null,
    demands,
    catalog: roleCatalog,
    hiringRequired: demands.some(item => item.hiringNeed > 0),
    complianceSource: 'SOLIDES',
    complianceStatus: 'AWAITING_INTEGRATION'
  };
}

function publicEquipmentPlanning(workflow, categoryCatalog) {
  const selectedIds = new Set((workflow.equipmentCategoryPlans || []).map(item => item.categoryId));
  return {
    defined: workflow.equipmentPlanDefined ?? null,
    categoryIds: [...selectedIds],
    categories: categoryCatalog.filter(category => selectedIds.has(category.id)),
    catalog: categoryCatalog
  };
}

export function emptyProjectWorkflowResourcePlanning(workflow = {}) {
  return {
    team: publicTeamPlanning(workflow, []),
    equipment: publicEquipmentPlanning(workflow, [])
  };
}

async function loadTeamCatalog(database, targetDate, currentProjectId) {
  if (!database.jobRole?.findMany || !database.collaborator?.findMany) return [];
  const date = utcDate(targetDate);
  const [roles, collaborators, absences, plan] = await Promise.all([
    database.jobRole.findMany({
      where: { isActive: true, isOperational: true },
      select: { id: true, name: true, calendarColor: true, order: true, isActive: true, isOperational: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }]
    }),
    database.collaborator.findMany({
      where: {
        OR: [{ isActive: true }, { terminationDate: { gte: date } }],
        AND: [{ OR: [{ admissionDate: null }, { admissionDate: { lte: date } }] }]
      },
      select: { id: true, name: true, jobRoleId: true, admissionDate: true, terminationDate: true, isActive: true }
    }),
    database.collaboratorAbsence?.findMany
      ? database.collaboratorAbsence.findMany({
        where: { deletedAt: null, startDate: { lte: date }, endDate: { gte: date } }
      })
      : [],
    database.efetivoPlan?.findFirst
      ? database.efetivoPlan.findFirst({ where: { kind: 'OFFICIAL', status: 'ACTIVE' }, select: { id: true } })
      : null
  ]);
  const missions = plan && database.efetivoMissionPlan?.findMany
    ? await database.efetivoMissionPlan.findMany({
      where: {
        planId: plan.id,
        deletedAt: null,
        scheduleStatus: 'CONFIRMED',
        mobilizationDate: { lte: date },
        ...missionEndsOnOrAfter(date)
      },
      include: {
        cycles: { orderBy: { mobilizationDate: 'asc' } },
        demands: true,
        allocations: { where: { deletedAt: null }, include: { cycles: { orderBy: { mobilizationDate: 'asc' } } } }
      }
    })
    : [];
  const capacity = calculateDailyCapacity({
    date: targetDate,
    jobRoles: roles,
    collaborators,
    missions: missions.filter(mission => mission.projectId !== currentProjectId),
    absences
  });
  const byRole = new Map(capacity.byRole.map(item => [item.jobRoleId, item]));
  return roles.map(role => ({
    id: role.id,
    name: role.name,
    calendarColor: role.calendarColor,
    order: role.order,
    activeCount: byRole.get(role.id)?.active || 0,
    availableCount: byRole.get(role.id)?.free || 0
  }));
}

async function loadEquipmentCatalog(database, targetDate, currentProjectId) {
  if (!database.equipmentCategory?.findMany) return [];
  const categories = await database.equipmentCategory.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      order: true,
      supportsCalibration: true,
      maintenanceIntervalDays: true,
      equipment: {
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          hasCalibration: true,
          expiresAt: true,
          maintenanceRecords: {
            where: { status: 'APPROVED' },
            orderBy: [{ maintenanceDate: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            select: { id: true, maintenanceDate: true }
          }
        },
        orderBy: [{ code: 'asc' }]
      }
    },
    orderBy: [{ order: 'asc' }, { name: 'asc' }]
  });
  const equipmentIds = categories.flatMap(category => category.equipment.map(item => item.id));
  const romaneios = equipmentIds.length && database.romaneio?.findMany
    ? await database.romaneio.findMany({
      where: {
        romaneioDate: { lte: utcDate(targetDate) },
        items: { some: { catalogItem: { sourceType: 'EQUIPAMENTOS', sourceId: { in: equipmentIds } } } }
      },
      select: {
        projectId: true,
        type: true,
        romaneioDate: true,
        createdAt: true,
        project: { select: { demobilizationDate: true } },
        items: {
          where: { catalogItem: { sourceType: 'EQUIPAMENTOS', sourceId: { in: equipmentIds } } },
          select: { quantity: true, catalogItem: { select: { sourceId: true } } }
        }
      },
      orderBy: [{ romaneioDate: 'asc' }, { createdAt: 'asc' }]
    })
    : [];
  return buildEquipmentPlanningCatalog(categories, romaneios, targetDate, currentProjectId);
}

export async function loadProjectWorkflowResourcePlanning(database, workflow) {
  if (!workflow) return emptyProjectWorkflowResourcePlanning();
  const targetDate = dateKey(workflow.plannedMobilizationDate);
  if (!targetDate) return emptyProjectWorkflowResourcePlanning(workflow);
  const [teamCatalog, equipmentCatalog] = await Promise.all([
    loadTeamCatalog(database, targetDate, workflow.projectId),
    loadEquipmentCatalog(database, targetDate, workflow.projectId)
  ]);
  return {
    targetDate,
    team: publicTeamPlanning(workflow, teamCatalog),
    equipment: publicEquipmentPlanning(workflow, equipmentCatalog)
  };
}
