import {
  buildMaintenanceScheduleItem,
  resolveEffectiveMaintenanceProfile
} from '../../operational-reports/domain.js';
import { getItemBalances } from '../../estoque/stock-balance.js';
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
  const profile = resolveEffectiveMaintenanceProfile({ ...equipment, category });
  const required = category.showInMaintenance !== false && profile?.isActive === true;
  if (!required) {
    return {
      required: false,
      status: 'NOT_REQUIRED',
      lastMaintenanceDate: null,
      nextMaintenanceDate: null,
      valid: true
    };
  }
  const schedule = buildMaintenanceScheduleItem({ ...equipment, category }, targetDate);
  const valid = ['UPCOMING', 'DUE_TODAY'].includes(schedule.status);
  return {
    required: true,
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
  const categoryById = new Map(categoryCatalog.map(category => [category.id, category]));
  const selections = (workflow.equipmentCategoryPlans || []).map(plan => {
    const category = categoryById.get(plan.categoryId);
    const storedIds = Array.isArray(plan.equipmentIds) ? plan.equipmentIds : [];
    const equipmentIds = storedIds.length ? storedIds : (category?.equipment || []).map(item => item.id);
    const activeIds = new Set((category?.equipment || []).map(item => item.id));
    return { categoryId: plan.categoryId, equipmentIds: equipmentIds.filter(id => activeIds.has(id)) };
  });
  const selectedIds = new Set(selections.map(item => item.categoryId));
  const equipmentIds = selections.flatMap(item => item.equipmentIds);
  const equipmentIdSet = new Set(equipmentIds);
  return {
    defined: workflow.equipmentPlanDefined ?? null,
    categoryIds: [...selectedIds],
    equipmentIds,
    selections,
    categories: categoryCatalog
      .filter(category => selectedIds.has(category.id))
      .map(category => ({
        ...category,
        equipment: category.equipment.filter(item => equipmentIdSet.has(item.id))
      })),
    catalog: categoryCatalog
  };
}

export function buildSupplyPlanning(workflow, catalog) {
  const catalogById = new Map(catalog.map(item => [item.id, item]));
  const storedItems = Array.isArray(workflow?.supplyPlan) ? workflow.supplyPlan : [];
  const items = storedItems.map(item => {
    const stockItem = item.stockItemId ? catalogById.get(item.stockItemId) : null;
    const availableQuantity = stockItem?.balance ?? 0;
    const requiredQuantity = Number(item.requiredQuantity || 0);
    const shortageQuantity = stockItem ? Math.max(0, requiredQuantity - availableQuantity) : requiredQuantity;
    const purchaseRequired = !stockItem || shortageQuantity > 0;
    return {
      id: item.id,
      stockItemId: stockItem?.id || null,
      type: stockItem?.type || item.type,
      code: stockItem?.code || null,
      name: stockItem?.name || item.name,
      unitLabel: stockItem?.unitLabel || item.unitLabel,
      requiredQuantity,
      availableQuantity,
      shortageQuantity,
      purchaseRequired,
      requestedAt: dateKey(item.requestedAt),
      purchasedAt: dateKey(item.purchasedAt)
    };
  });
  return {
    defined: workflow?.supplyPlanDefined ?? null,
    items,
    catalog,
    purchasePendingCount: items.filter(item => item.purchaseRequired && !item.purchasedAt).length
  };
}

export function buildLogisticsPlanning(workflow, targetDate = null) {
  const plan = workflow?.logisticsPlan && typeof workflow.logisticsPlan === 'object' && !Array.isArray(workflow.logisticsPlan)
    ? workflow.logisticsPlan
    : {};
  const vehicleRequired = typeof plan.vehicleRequired === 'boolean' ? plan.vehicleRequired : null;
  const freightRequired = typeof plan.freightRequired === 'boolean' ? plan.freightRequired : null;
  const lodgingRequired = typeof plan.lodgingRequired === 'boolean' ? plan.lodgingRequired : null;
  const lodgingRequested = lodgingRequired && typeof plan.lodgingRequested === 'boolean' ? plan.lodgingRequested : null;
  const result = {
    vehicleRequired,
    vehicleQuantity: vehicleRequired ? Number(plan.vehicleQuantity || 0) || null : null,
    vehicleType: vehicleRequired && ['CARRO', 'CAMINHAO'].includes(plan.vehicleType) ? plan.vehicleType : null,
    freightRequired,
    lodgingRequired,
    lodgingPeopleCount: lodgingRequired ? Number(plan.lodgingPeopleCount || 0) || null : null,
    lodgingExpectedDate: lodgingRequired ? dateKey(plan.lodgingExpectedDate) || targetDate : null,
    lodgingRequested,
    lodgingRequestedAt: lodgingRequired && lodgingRequested ? dateKey(plan.lodgingRequestedAt) : null,
    lodgingCompletedAt: lodgingRequired && lodgingRequested ? dateKey(plan.lodgingCompletedAt) : null
  };
  const issues = [];
  if (vehicleRequired == null) issues.push('Informar se será necessário veículo');
  if (vehicleRequired === true && (!result.vehicleQuantity || !result.vehicleType)) issues.push('Detalhar quantidade e tipo dos veículos');
  if (freightRequired == null) issues.push('Informar se será necessário frete');
  if (lodgingRequired == null) issues.push('Informar se será necessária hospedagem');
  if (lodgingRequired === true && (!result.lodgingPeopleCount || !result.lodgingExpectedDate)) issues.push('Detalhar pessoas e data prevista da hospedagem');
  if (lodgingRequired === true && lodgingRequested == null) issues.push('Informar se a hospedagem já foi solicitada');
  if (lodgingRequired === true && lodgingRequested === true && !result.lodgingRequestedAt) issues.push('Informar a data da solicitação da hospedagem');
  const warnings = [];
  if (lodgingRequired === true && lodgingRequested === false) warnings.push('Hospedagem ainda não solicitada');
  if (lodgingRequired === true && lodgingRequested === true && result.lodgingRequestedAt && !result.lodgingCompletedAt) {
    warnings.push('Hospedagem solicitada e aguardando conclusão');
  }
  return { ...result, complete: issues.length === 0, issues, warnings };
}

export function emptyProjectWorkflowResourcePlanning(workflow = {}) {
  const targetDate = dateKey(workflow.plannedMobilizationDate);
  return {
    targetDate,
    team: publicTeamPlanning(workflow, []),
    equipment: publicEquipmentPlanning(workflow, []),
    supplies: buildSupplyPlanning(workflow, []),
    logistics: buildLogisticsPlanning(workflow, targetDate)
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
      showInMaintenance: true,
      maintenanceIntervalDays: true,
      maintenanceProfile: { select: { isActive: true } },
      equipment: {
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          hasCalibration: true,
          expiresAt: true,
          maintenanceProfileOverride: true,
          maintenanceProfile: { select: { isActive: true } },
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

async function loadSupplyCatalog(database) {
  if (!database.stockItem?.findMany) return [];
  const items = await database.stockItem.findMany({
    where: { isActive: true, type: { in: ['FILTRO', 'PRODUTO_QUIMICO'] } },
    select: {
      id: true,
      type: true,
      code: true,
      name: true,
      unitLabel: true,
      category: { select: { name: true } }
    },
    orderBy: [{ type: 'asc' }, { name: 'asc' }]
  });
  const balances = database.stockMovement?.groupBy
    ? await getItemBalances(database, items.map(item => item.id))
    : new Map();
  return items.map(item => ({
    id: item.id,
    type: item.type,
    code: item.code,
    name: item.name,
    unitLabel: item.unitLabel,
    categoryName: item.category?.name || null,
    balance: Number(balances.get(item.id) || 0)
  }));
}

export async function loadProjectWorkflowResourcePlanning(database, workflow) {
  if (!workflow) return emptyProjectWorkflowResourcePlanning();
  const targetDate = dateKey(workflow.plannedMobilizationDate);
  if (!targetDate) return emptyProjectWorkflowResourcePlanning(workflow);
  const [teamCatalog, equipmentCatalog, supplyCatalog] = await Promise.all([
    loadTeamCatalog(database, targetDate, workflow.projectId),
    loadEquipmentCatalog(database, targetDate, workflow.projectId),
    loadSupplyCatalog(database)
  ]);
  return {
    targetDate,
    team: publicTeamPlanning(workflow, teamCatalog),
    equipment: publicEquipmentPlanning(workflow, equipmentCatalog),
    supplies: buildSupplyPlanning(workflow, supplyCatalog),
    logistics: buildLogisticsPlanning(workflow, targetDate)
  };
}
