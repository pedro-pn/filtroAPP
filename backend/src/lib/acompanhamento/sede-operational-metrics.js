import prisma from "../prisma.js";

function dateKey(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function inRange(value, range) {
  if (!range) return true;
  const month = dateKey(value).slice(0, 7);
  return Boolean(month && month >= range.fromMonth && month <= range.toMonth);
}

function number(value) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function sortedGroups(map, labelKeys) {
  return [...map.values()].sort(
    (left, right) =>
      right.maintenanceCount - left.maintenanceCount ||
      String(left[labelKeys[0]] || "").localeCompare(
        String(right[labelKeys[0]] || ""),
        "pt-BR",
      ),
  );
}

function reportSummary(reports) {
  const collaborators = new Set();
  let workedMinutes = 0;
  let overtimeMinutes = 0;
  for (const report of reports) {
    workedMinutes +=
      number(report.daytimeWorkedMinutes) +
      number(report.nighttimeWorkedMinutes);
    overtimeMinutes += number(report.totalOvertimeMinutes);
    for (const link of report.collaborators || []) {
      const id = link.collaboratorId || link.collaborator?.id;
      if (id) collaborators.add(id);
    }
  }
  return {
    reportCount: reports.length,
    workedMinutes,
    overtimeMinutes,
    collaboratorCount: collaborators.size,
  };
}

export function buildSedeOperationalMetrics({
  reports = [],
  maintenanceRecords = [],
  range = null,
} = {}) {
  const approvedReports = reports.filter(
    (report) =>
      report.status === "APPROVED" && inRange(report.reportDate, range),
  );
  const maintenanceReports = approvedReports.filter(
    (report) => report.reportType === "RDO_MAINTENANCE",
  );
  const productionReports = approvedReports.filter(
    (report) => report.reportType === "RDO_PRODUCTION",
  );
  const approvedMaintenances = maintenanceRecords.filter(
    (record) =>
      record.status === "APPROVED" && inRange(record.maintenanceDate, range),
  );
  const byProfileMap = new Map();
  const byEquipmentMap = new Map();

  for (const record of approvedMaintenances) {
    const profileName = record.profileNameSnapshot || "Sem perfil";
    const profile = byProfileMap.get(profileName) || {
      profileName,
      maintenanceCount: 0,
    };
    profile.maintenanceCount += 1;
    byProfileMap.set(profileName, profile);

    const equipmentId = record.equipment?.id || record.equipmentId || "unknown";
    const equipment = byEquipmentMap.get(equipmentId) || {
      equipmentId,
      equipmentCode: record.equipment?.code || "—",
      equipmentName: record.equipment?.name || "Equipamento",
      maintenanceCount: 0,
    };
    equipment.maintenanceCount += 1;
    byEquipmentMap.set(equipmentId, equipment);
  }

  const byMaterialMap = new Map();
  let totalKg = 0;
  for (const report of productionReports) {
    for (const item of report.chemicalCleanings || []) {
      const material = item.material;
      const kg = number(item.quantityKg);
      totalKg += kg;
      const current = byMaterialMap.get(material) || {
        material,
        totalKg: 0,
        cleaningCount: 0,
      };
      current.totalKg += kg;
      current.cleaningCount += 1;
      byMaterialMap.set(material, current);
    }
  }

  return {
    range,
    maintenance: {
      summary: {
        ...reportSummary(maintenanceReports),
        maintenanceCount: approvedMaintenances.length,
      },
      byProfile: sortedGroups(byProfileMap, ["profileName"]),
      byEquipment: sortedGroups(byEquipmentMap, ["equipmentCode"]),
    },
    production: {
      summary: { ...reportSummary(productionReports), totalKg },
      byMaterial: [...byMaterialMap.values()].sort(
        (left, right) =>
          right.totalKg - left.totalKg ||
          left.material.localeCompare(right.material),
      ),
    },
  };
}

function dateWhere(range, field) {
  if (!range) return {};
  const [toYear, toMonth] = range.toMonth.split("-").map(Number);
  return {
    [field]: {
      gte: new Date(`${range.fromMonth}-01T00:00:00.000Z`),
      lt: new Date(Date.UTC(toYear, toMonth, 1)),
    },
  };
}

export async function listSedeOperationalMetrics({ range = null } = {}) {
  const [reports, maintenanceRecords] = await Promise.all([
    prisma.report.findMany({
      where: {
        status: "APPROVED",
        reportType: { in: ["RDO_MAINTENANCE", "RDO_PRODUCTION"] },
        deletedAt: null,
        ...dateWhere(range, "reportDate"),
      },
      select: {
        id: true,
        reportType: true,
        status: true,
        reportDate: true,
        daytimeWorkedMinutes: true,
        nighttimeWorkedMinutes: true,
        totalOvertimeMinutes: true,
        collaborators: { select: { collaboratorId: true } },
        chemicalCleanings: {
          select: { material: true, otherMaterial: true, quantityKg: true },
        },
      },
    }),
    prisma.maintenanceRecord.findMany({
      where: { status: "APPROVED", ...dateWhere(range, "maintenanceDate") },
      select: {
        id: true,
        status: true,
        maintenanceDate: true,
        profileNameSnapshot: true,
        equipmentId: true,
        equipment: { select: { id: true, code: true, name: true } },
      },
    }),
  ]);
  return buildSedeOperationalMetrics({ reports, maintenanceRecords, range });
}
