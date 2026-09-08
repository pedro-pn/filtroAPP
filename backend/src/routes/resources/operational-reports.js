import { Router } from "express";
import { randomUUID } from "node:crypto";

import asyncHandler from "../../lib/async-handler.js";
import { loadCorporateCalendar } from "../../lib/calendar/corporate-calendar.js";
import {
  cleanupMaintenanceStoragePaths,
  createMaintenanceDocument,
  createMaintenancePhoto,
  maintenanceAttachmentDisposition,
  readMaintenanceAttachment,
  removeAllMaintenanceAttachments,
  removeMaintenancePhotos,
  resolveMaintenancePhotoAssets,
  resolveSignatureAsset,
  serializeMaintenanceAttachment,
} from "../../lib/operational-reports/maintenance-attachments.js";
import {
  generateMaintenancePdf,
  maintenanceDocumentFileName,
} from "../../lib/operational-reports/maintenance-docx.js";
import { logOperationalReportEvent } from "../../lib/operational-reports/events.js";
import { hasModuleRole } from "../../lib/module-roles.js";
import {
  assertEditableStatus,
  assertOperationalTransition,
  buildOperationalSpecialConditions,
  buildMaintenanceScheduleItem,
  canReviewMaintenance,
  canReviewProduction,
  maintenanceInputSchema,
  maintenanceHistoryQuerySchema,
  maintenanceScheduleQuerySchema,
  maintenanceListQuerySchema,
  maintenanceRecordInclude,
  operationalListQuerySchema,
  operationalReportInclude,
  operationalReportInputSchema,
  operationalStatusInputSchema,
  projectCodeForOperationalKind,
  reportTypeForOperationalKind,
  resolveEffectiveMaintenanceProfile,
  mergeSelectedServiceSnapshots,
  resolveSelectedServiceSnapshots,
  uniqueIds,
  validateOvertimeReason,
} from "../../lib/operational-reports/domain.js";
import { calculateReportOvertime } from "../../lib/overtime.js";
import prisma from "../../lib/prisma.js";
import {
  ReportEmissionPermissions,
  assertReportEmissionPermission,
  hasReportEmissionPermission,
} from "../../lib/operational-reports/permissions.js";
import { reportCollaboratorCreateManyData } from "../../lib/report-collaborators.js";
import { statisticsProjectsCache } from "../../lib/resource-list-cache.js";
import { requireAuth } from "../../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertInternalAccount(user) {
  if (user?.accountType === "ADMIN" || user?.accountType === "INTERNAL") return;
  throw fail(403, "Acesso restrito a contas internas.");
}

router.use((req, _res, next) => {
  assertInternalAccount(req.auth?.user);
  next();
});

function dateValue(value) {
  return new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
}

function dateKey(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function brDate(value) {
  const [year, month, day] = dateKey(value).split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

function saoPauloDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function permissionForKind(kind) {
  return kind === "MAINTENANCE"
    ? ReportEmissionPermissions.MAINTENANCE
    : ReportEmissionPermissions.PRODUCTION;
}

function kindForReportType(reportType) {
  if (reportType === "RDO_MAINTENANCE") return "MAINTENANCE";
  if (reportType === "RDO_PRODUCTION") return "PRODUCTION";
  return null;
}

function assertCanEditOperationalRecord(user, kind, createdByUserId) {
  assertReportEmissionPermission(user, permissionForKind(kind));
  if (user?.accountType === "ADMIN" || user?.id === createdByUserId) return;
  throw fail(403, "Somente o responsável pode editar este relatório.");
}

async function reserveSequence(tx, projectId, reportType) {
  const row = await tx.projectReportSeq.upsert({
    where: { projectId_reportType: { projectId, reportType } },
    create: { projectId, reportType, nextNumber: 1 },
    update: { nextNumber: { increment: 1 } },
    select: { nextNumber: true },
  });
  return Math.max(1, row.nextNumber || 1);
}

async function maintenanceSupervisorState(database = prisma) {
  const config = await database.maintenanceConfiguration.findUnique({
    where: { id: "global" },
    include: {
      supervisor: {
        include: { user: true },
      },
    },
  });
  const collaborator = config?.supervisor || null;
  const user = collaborator?.user || null;
  const valid = Boolean(
    collaborator?.isActive &&
    collaborator?.signatureImage &&
    user?.isActive &&
    user?.accountType === "INTERNAL",
  );
  return {
    id: collaborator?.id || null,
    name: collaborator?.name || null,
    userId: user?.id || null,
    signatureImage: valid ? collaborator.signatureImage : null,
    valid,
    reason: valid
      ? null
      : "Configure um supervisor ativo, com conta interna ativa e assinatura cadastrada.",
  };
}

async function loadEquipmentForMaintenance(database, equipmentId) {
  const equipment = await database.companyEquipment.findFirst({
    where: { id: equipmentId, isActive: true },
    include: {
      category: {
        include: {
          maintenanceProfile: {
            include: {
              items: { where: { isActive: true }, orderBy: { order: "asc" } },
            },
          },
        },
      },
      maintenanceProfile: {
        include: {
          items: { where: { isActive: true }, orderBy: { order: "asc" } },
        },
      },
    },
  });
  if (!equipment) throw fail(400, "Equipamento ativo não encontrado.");
  if (equipment.category?.showInMaintenance === false) {
    throw fail(
      400,
      "A categoria deste equipamento não está disponível no módulo de manutenção.",
    );
  }
  const maintenanceProfile = resolveEffectiveMaintenanceProfile(equipment);
  if (!maintenanceProfile?.isActive) {
    throw fail(
      400,
      "Associe um perfil de manutenção ativo à categoria ou crie uma exceção para o equipamento.",
    );
  }
  return { ...equipment, maintenanceProfile };
}

async function maintenanceCreateData(
  database,
  input,
  maintenanceDate,
  user,
  reportId = null,
  previousSnapshots = null,
) {
  const equipment = await loadEquipmentForMaintenance(
    database,
    input.equipmentId,
  );
  const selectedServices = previousSnapshots
    ? mergeSelectedServiceSnapshots(
        equipment,
        input.selectedServiceIds,
        previousSnapshots,
      )
    : resolveSelectedServiceSnapshots(equipment, input.selectedServiceIds);
  return {
    id: input.id || randomUUID(),
    reportId,
    equipmentId: equipment.id,
    profileId: equipment.maintenanceProfile.id,
    maintenanceDate: dateValue(maintenanceDate),
    status: "PENDING",
    createdByUserId: user.id,
    responsibleNameSnapshot: user.name,
    profileNameSnapshot: equipment.maintenanceProfile.name,
    selectedServices,
    observations: input.observations || null,
    thirdPartyServices: {
      create: (input.thirdPartyServices || []).map((service, index) => ({
        serviceDate: dateValue(service.serviceDate),
        location: service.location,
        description: service.description,
        order: index + 1,
      })),
    },
  };
}

function publicMaintenance(record) {
  if (!record) return record;
  const {
    supervisorSignatureSnapshot: _supervisorSignatureSnapshot,
    attachments = [],
    ...rest
  } = record;
  return {
    ...rest,
    maintenanceDate: dateKey(record.maintenanceDate),
    selectedServices: Array.isArray(record.selectedServices)
      ? record.selectedServices
      : [],
    thirdPartyServices: (record.thirdPartyServices || []).map((item) => ({
      ...item,
      serviceDate: dateKey(item.serviceDate),
    })),
    attachments: attachments.map((item) =>
      serializeMaintenanceAttachment(item),
    ),
    document: serializeMaintenanceAttachment(
      attachments.find((item) => item.kind === "DOCUMENT"),
    ),
    photos: attachments
      .filter((item) => item.kind === "PHOTO")
      .map((item) => serializeMaintenanceAttachment(item)),
  };
}

function publicOperationalReport(report) {
  if (!report) return report;
  return {
    ...report,
    kind: kindForReportType(report.reportType),
    reportDate: dateKey(report.reportDate),
    maintenanceRecords: (report.maintenanceRecords || []).map(
      publicMaintenance,
    ),
    chemicalCleanings: (report.chemicalCleanings || []).map((item) => ({
      ...item,
      quantityKg: Number(item.quantityKg),
    })),
  };
}

function canAccessMaintenance(user, _supervisor, record) {
  return (
    hasReportEmissionPermission(
      user,
      ReportEmissionPermissions.MAINTENANCE,
    ) ||
    (record?.status === "APPROVED" &&
      hasModuleRole(user, ["equipamentos:manager", "equipamentos:viewer"]))
  );
}

function canAccessOperationalReport(user, _supervisor, report) {
  const kind = kindForReportType(report?.reportType);
  return Boolean(
    kind &&
    hasReportEmissionPermission(user, permissionForKind(kind))
  );
}

async function persistPhotos(recordId, equipmentCode, photos) {
  const uploads = photos || [];
  if (!uploads.length) return;
  try {
    for (const photo of uploads) {
      // eslint-disable-next-line no-await-in-loop
      await createMaintenancePhoto(prisma, {
        maintenanceId: recordId,
        equipmentCode,
        upload: photo,
      });
    }
    logOperationalReportEvent("photos_processed", {
      maintenanceId: recordId,
      photoCount: uploads.length,
      outcome: "success",
    });
  } catch (error) {
    logOperationalReportEvent(
      "photos_processed",
      {
        maintenanceId: recordId,
        photoCount: uploads.length,
        outcome: "failure",
        errorName: error?.name || "Error",
        errorCode: error?.code || error?.statusCode,
      },
      { level: "error" },
    );
    throw error;
  }
}

async function cleanupRecords(records) {
  for (const record of records || []) {
    // eslint-disable-next-line no-await-in-loop
    await removeAllMaintenanceAttachments(prisma, record.id).catch(() => {});
  }
}

async function freshReport(id) {
  return prisma.report.findUnique({
    where: { id },
    include: operationalReportInclude,
  });
}

async function freshMaintenance(id) {
  return prisma.maintenanceRecord.findUnique({
    where: { id },
    include: maintenanceRecordInclude,
  });
}

router.get(
  "/context",
  asyncHandler(async (req, res) => {
    const canEmitMaintenance = hasReportEmissionPermission(
      req.auth.user,
      ReportEmissionPermissions.MAINTENANCE,
    );
    const canEmitProduction = hasReportEmissionPermission(
      req.auth.user,
      ReportEmissionPermissions.PRODUCTION,
    );
    if (!canEmitMaintenance && !canEmitProduction)
      throw fail(
        403,
        "Sem permissão para acessar manutenção ou produção.",
      );
    const [supervisor, projects, collaborators, equipment] = await Promise.all([
      maintenanceSupervisorState(),
      prisma.project.findMany({
        where: { code: { in: ["5002", "5004"] }, deletedAt: null },
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          workdayHours: true,
          weekendWorkdayHours: true,
          includesSaturday: true,
          includesSunday: true,
        },
      }),
      prisma.collaborator.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          jobRole: { select: { name: true } },
        },
        orderBy: { name: "asc" },
      }),
      canEmitMaintenance
        ? prisma.companyEquipment.findMany({
            where: {
              isActive: true,
              category: {
                is: { isActive: true, showInMaintenance: true },
              },
            },
            select: {
              id: true,
              code: true,
              name: true,
              attributes: true,
              maintenanceProfileOverride: true,
              category: {
                select: {
                  id: true,
                  name: true,
                  fieldSchema: true,
                  maintenanceProfile: {
                    select: {
                      id: true,
                      key: true,
                      name: true,
                      isActive: true,
                      items: {
                        where: { isActive: true },
                        orderBy: { order: "asc" },
                        select: { id: true, label: true, order: true },
                      },
                    },
                  },
                },
              },
              maintenanceProfile: {
                select: {
                  id: true,
                  key: true,
                  name: true,
                  isActive: true,
                  items: {
                    where: { isActive: true },
                    orderBy: { order: "asc" },
                    select: { id: true, label: true, order: true },
                  },
                },
              },
            },
            orderBy: { code: "asc" },
          })
        : Promise.resolve([]),
    ]);
    const byCode = new Map(projects.map((project) => [project.code, project]));
    const availableEquipment = equipment
      .map((item) => {
        const maintenanceProfile = resolveEffectiveMaintenanceProfile(item);
        if (!maintenanceProfile?.isActive) return null;
        const { maintenanceProfile: _categoryProfile, ...category } =
          item.category || {};
        return { ...item, category, maintenanceProfile };
      })
      .filter(Boolean);
    res.json({
      permissions: req.auth.user.reportEmissionPermissions || [],
      canReviewMaintenance: canReviewMaintenance(req.auth.user, supervisor),
      canReviewProduction: canReviewProduction(req.auth.user),
      maintenanceSupervisor: {
        id: supervisor.id,
        name: supervisor.name,
        valid: supervisor.valid,
        reason: supervisor.reason,
      },
      projects: {
        maintenance: byCode.get("5002") || null,
        production: byCode.get("5004") || null,
      },
      collaborators,
      equipment: availableEquipment,
    });
  }),
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = operationalListQuerySchema.parse(req.query);
    const allowedTypes = [];
    if (hasReportEmissionPermission(
      req.auth.user,
      ReportEmissionPermissions.MAINTENANCE,
    ))
      allowedTypes.push("RDO_MAINTENANCE");
    if (hasReportEmissionPermission(
      req.auth.user,
      ReportEmissionPermissions.PRODUCTION,
    ))
      allowedTypes.push("RDO_PRODUCTION");
    const requestedType = query.kind
      ? reportTypeForOperationalKind(query.kind)
      : null;
    if (!allowedTypes.length || (requestedType && !allowedTypes.includes(requestedType))) {
      throw fail(403, "Sua conta não possui permissão para consultar esta área.");
    }
    const where = {
      reportType: requestedType
        ? requestedType
        : { in: allowedTypes },
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.mine === "true" ? { createdByUserId: req.auth.user.id } : {}),
      ...(query.from || query.to
        ? {
            reportDate: {
              ...(query.from ? { gte: dateValue(query.from) } : {}),
              ...(query.to ? { lte: dateValue(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.report.findMany({
        where,
        include: operationalReportInclude,
        orderBy: [{ reportDate: "desc" }, { sequenceNumber: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.report.count({ where }),
    ]);
    res.json({
      items: items.map(publicOperationalReport),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = operationalReportInputSchema.parse(req.body);
    assertReportEmissionPermission(req.auth.user, permissionForKind(data.kind));
    const reportType = reportTypeForOperationalKind(data.kind);
    const projectCode = projectCodeForOperationalKind(data.kind);
    const allCollaboratorIds = uniqueIds([
      ...data.collaboratorIds,
      ...(data.nightShift.enabled ? data.nightShift.collaboratorIds : []),
    ]);
    const created = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { code: projectCode, isActive: true, deletedAt: null },
      });
      if (!project)
        throw fail(409, `O código interno ${projectCode} não está ativo.`);
      const duplicate = await tx.report.findFirst({
        where: {
          projectId: project.id,
          reportType,
          reportDate: dateValue(data.reportDate),
          deletedAt: null,
        },
        select: { id: true },
      });
      if (duplicate)
        throw fail(409, `Já existe um relatório ${projectCode} nesta data.`);
      const calendar = await loadCorporateCalendar(
        tx,
        data.reportDate,
        data.reportDate,
      );
      const specialConditions = {
        ...buildOperationalSpecialConditions(data),
        daytimeCollaboratorIds: uniqueIds(data.collaboratorIds),
      };
      const overtime = calculateReportOvertime(
        project,
        {
          reportDate: data.reportDate,
          arrivalTime: data.arrivalTime,
          departureTime: data.departureTime,
          lunchBreak: data.lunchBreak,
          specialConditions,
        },
        calendar,
      );
      validateOvertimeReason(overtime, data.overtimeReason);
      const collaborators = await reportCollaboratorCreateManyData(
        tx,
        allCollaboratorIds,
      );
      const maintenanceRows = [];
      for (const input of data.maintenanceRecords) {
        // eslint-disable-next-line no-await-in-loop
        maintenanceRows.push(
          await maintenanceCreateData(
            tx,
            input,
            data.reportDate,
            req.auth.user,
          ),
        );
      }
      return tx.report.create({
        data: {
          projectId: project.id,
          createdByUserId: req.auth.user.id,
          reportType,
          sequenceNumber: await reserveSequence(tx, project.id, reportType),
          status: "PENDING",
          reportDate: dateValue(data.reportDate),
          arrivalTime: data.arrivalTime,
          departureTime: data.departureTime,
          lunchBreak: data.lunchBreak,
          daytimeCount: uniqueIds(data.collaboratorIds).length,
          daytimeWorkedMinutes: overtime.daytimeWorkedMinutes,
          nighttimeWorkedMinutes: overtime.nighttimeWorkedMinutes,
          daytimeOvertimeMinutes: overtime.daytimeOvertimeMinutes,
          nighttimeOvertimeMinutes: overtime.nighttimeOvertimeMinutes,
          totalOvertimeMinutes: overtime.totalOvertimeMinutes,
          overtimeReason: data.overtimeReason || null,
          dailyDescription: data.dailyDescription,
          specialConditions: {
            ...specialConditions,
            overtimeSummary: overtime,
          },
          collaborators: { create: collaborators },
          maintenanceRecords: {
            create: maintenanceRows.map((row) => ({
              ...row,
              reportId: undefined,
            })),
          },
          chemicalCleanings: {
            create: data.chemicalCleanings.map((item, index) => ({
              description: item.description,
              material: item.material,
              otherMaterial:
                item.material === "OTHER" ? item.otherMaterial : null,
              quantityKg: item.quantityKg,
              order: index + 1,
            })),
          },
        },
        include: operationalReportInclude,
      });
    });

    try {
      for (let index = 0; index < data.maintenanceRecords.length; index += 1) {
        const record = created.maintenanceRecords[index];
        // eslint-disable-next-line no-await-in-loop
        await persistPhotos(
          record.id,
          record.equipment.code,
          data.maintenanceRecords[index].photos,
        );
      }
    } catch (error) {
      await cleanupRecords(created.maintenanceRecords);
      await prisma.report.delete({ where: { id: created.id } }).catch(() => {});
      throw error;
    }
    statisticsProjectsCache.clear();
    res
      .status(201)
      .json(publicOperationalReport(await freshReport(created.id)));
  }),
);

router.get(
  "/maintenance",
  asyncHandler(async (req, res) => {
    assertReportEmissionPermission(
      req.auth.user,
      ReportEmissionPermissions.MAINTENANCE,
    );
    const query = maintenanceListQuerySchema.parse(req.query);
    const where = {
      reportId: null,
      ...(query.mine === "true" ? { createdByUserId: req.auth.user.id } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.equipmentId ? { equipmentId: query.equipmentId } : {}),
      ...(query.from || query.to
        ? {
            maintenanceDate: {
              ...(query.from ? { gte: dateValue(query.from) } : {}),
              ...(query.to ? { lte: dateValue(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.maintenanceRecord.findMany({
        where,
        include: maintenanceRecordInclude,
        orderBy: [{ maintenanceDate: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.maintenanceRecord.count({ where }),
    ]);
    res.json({
      items: items.map(publicMaintenance),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  }),
);

router.post(
  "/maintenance",
  asyncHandler(async (req, res) => {
    assertReportEmissionPermission(
      req.auth.user,
      ReportEmissionPermissions.MAINTENANCE,
    );
    const data = maintenanceInputSchema.parse(req.body);
    const row = await prisma.$transaction(async (tx) => {
      const createData = await maintenanceCreateData(
        tx,
        data,
        data.maintenanceDate,
        req.auth.user,
      );
      return tx.maintenanceRecord.create({
        data: createData,
        include: maintenanceRecordInclude,
      });
    });
    try {
      await persistPhotos(row.id, row.equipment.code, data.photos);
    } catch (error) {
      await removeAllMaintenanceAttachments(prisma, row.id).catch(() => {});
      await prisma.maintenanceRecord
        .delete({ where: { id: row.id } })
        .catch(() => {});
      throw error;
    }
    res.status(201).json(publicMaintenance(await freshMaintenance(row.id)));
  }),
);

router.get(
  "/maintenance/history",
  asyncHandler(async (req, res) => {
    assertReportEmissionPermission(
      req.auth.user,
      ReportEmissionPermissions.MAINTENANCE,
    );
    const query = maintenanceHistoryQuerySchema.parse(req.query);
    const search = query.q.trim();
    const where = {
      status: "APPROVED",
      ...(search
        ? {
            OR: [
              {
                equipment: {
                  code: { contains: search, mode: "insensitive" },
                },
              },
              {
                equipment: {
                  name: { contains: search, mode: "insensitive" },
                },
              },
              {
                equipment: {
                  category: {
                    is: {
                      name: { contains: search, mode: "insensitive" },
                    },
                  },
                },
              },
              {
                profileNameSnapshot: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    };
    const direction = query.sortDirection;
    const primaryOrder = {
      maintenanceDate: { maintenanceDate: direction },
      tag: { equipment: { code: direction } },
      equipment: { equipment: { name: direction } },
      category: { equipment: { category: { name: direction } } },
      responsible: { responsibleNameSnapshot: direction },
    }[query.sortBy];
    const [items, total] = await prisma.$transaction([
      prisma.maintenanceRecord.findMany({
        where,
        include: maintenanceRecordInclude,
        orderBy: [
          primaryOrder,
          ...(query.sortBy === "maintenanceDate"
            ? []
            : [{ maintenanceDate: "desc" }]),
          { createdAt: "desc" },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.maintenanceRecord.count({ where }),
    ]);
    res.json({
      items: items.map(publicMaintenance),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  }),
);

router.get(
  "/maintenance/schedule",
  asyncHandler(async (req, res) => {
    assertReportEmissionPermission(
      req.auth.user,
      ReportEmissionPermissions.MAINTENANCE,
    );
    const query = maintenanceScheduleQuerySchema.parse(req.query);
    const search = query.q.trim();
    const equipmentWhere = {
      isActive: true,
      category: {
        is: { isActive: true, showInMaintenance: true },
      },
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
              {
                category: {
                  is: { name: { contains: search, mode: "insensitive" } },
                },
              },
            ],
          }
        : {}),
    };
    const [equipment, categories] = await Promise.all([
      prisma.companyEquipment.findMany({
        where: equipmentWhere,
        select: {
          id: true,
          code: true,
          name: true,
          category: {
            select: {
              id: true,
              name: true,
              maintenanceIntervalDays: true,
            },
          },
          maintenanceRecords: {
            where: { status: "APPROVED" },
            orderBy: [{ maintenanceDate: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: { id: true, maintenanceDate: true },
          },
        },
      }),
      prisma.equipmentCategory.findMany({
        where: { isActive: true, showInMaintenance: true },
        select: { id: true, name: true, maintenanceIntervalDays: true },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      }),
    ]);
    const today = saoPauloDateKey();
    const schedule = equipment.map((item) =>
      buildMaintenanceScheduleItem(item, today),
    );
    const summary = schedule.reduce(
      (totals, item) => {
        totals.total += 1;
        totals[item.status] += 1;
        return totals;
      },
      {
        total: 0,
        OVERDUE: 0,
        DUE_TODAY: 0,
        UPCOMING: 0,
        NO_HISTORY: 0,
        UNCONFIGURED: 0,
      },
    );
    const filtered = query.status
      ? schedule.filter((item) => item.status === query.status)
      : schedule;
    filtered.sort((left, right) => {
      const categoryOrder = left.category.name.localeCompare(
        right.category.name,
        "pt-BR",
      );
      if (categoryOrder) return categoryOrder;
      const leftDate = left.nextMaintenanceDate || "9999-12-31";
      const rightDate = right.nextMaintenanceDate || "9999-12-31";
      return leftDate.localeCompare(rightDate)
        || left.equipment.code.localeCompare(right.equipment.code, "pt-BR", {
          numeric: true,
        });
    });
    const start = (query.page - 1) * query.pageSize;
    const items = filtered.slice(start, start + query.pageSize);
    res.json({
      items,
      categories,
      summary,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: filtered.length,
        totalPages: Math.ceil(filtered.length / query.pageSize),
      },
      referenceDate: today,
    });
  }),
);

router.get(
  "/maintenance/attachments/:attachmentId",
  asyncHandler(async (req, res) => {
    const [attachment, supervisor] = await Promise.all([
      prisma.maintenanceAttachment.findUnique({
        where: { id: req.params.attachmentId },
        include: { maintenance: true },
      }),
      maintenanceSupervisorState(),
    ]);
    if (
      !attachment ||
      !canAccessMaintenance(req.auth.user, supervisor, attachment.maintenance)
    ) {
      return res.status(404).json({ error: "Anexo não encontrado." });
    }
    const stored = await readMaintenanceAttachment(attachment);
    if (!stored)
      return res.status(404).json({ error: "Arquivo não encontrado." });
    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader(
      "Content-Disposition",
      maintenanceAttachmentDisposition(attachment.fileName),
    );
    res.send(stored.bytes);
  }),
);

router.get(
  "/maintenance/:id/document",
  asyncHandler(async (req, res) => {
    const [record, supervisor] = await Promise.all([
      freshMaintenance(req.params.id),
      maintenanceSupervisorState(),
    ]);
    if (
      !record ||
      record.status !== "APPROVED" ||
      !canAccessMaintenance(req.auth.user, supervisor, record)
    ) {
      return res.status(404).json({ error: "Documento não encontrado." });
    }
    const attachment = record.attachments.find(
      (item) => item.kind === "DOCUMENT",
    );
    if (!attachment)
      return res.status(404).json({ error: "Documento não encontrado." });
    const stored = await readMaintenanceAttachment(attachment);
    if (!stored)
      return res.status(404).json({ error: "Arquivo não encontrado." });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      maintenanceAttachmentDisposition(attachment.fileName),
    );
    res.send(stored.bytes);
  }),
);

router.get(
  "/maintenance/:id",
  asyncHandler(async (req, res) => {
    const [record, supervisor] = await Promise.all([
      freshMaintenance(req.params.id),
      maintenanceSupervisorState(),
    ]);
    if (!record || !canAccessMaintenance(req.auth.user, supervisor, record)) {
      return res.status(404).json({ error: "Manutenção não encontrada." });
    }
    res.json(publicMaintenance(record));
  }),
);

router.put(
  "/maintenance/:id",
  asyncHandler(async (req, res) => {
    const data = maintenanceInputSchema.parse(req.body);
    const existing = await freshMaintenance(req.params.id);
    if (!existing || existing.reportId)
      return res
        .status(404)
        .json({ error: "Manutenção avulsa não encontrada." });
    assertCanEditOperationalRecord(
      req.auth.user,
      "MAINTENANCE",
      existing.createdByUserId,
    );
    assertEditableStatus(existing.status);
    const retainedPhotoCount = existing.attachments.filter(
      (item) => item.kind === "PHOTO" && !data.removePhotoIds.includes(item.id),
    ).length;
    if (retainedPhotoCount + data.photos.length > 10)
      throw fail(400, "Cada manutenção aceita no máximo 10 fotos.");
    const updated = await prisma.$transaction(async (tx) => {
      const equipment = await loadEquipmentForMaintenance(tx, data.equipmentId);
      const selectedServices =
        existing.equipmentId === data.equipmentId
          ? mergeSelectedServiceSnapshots(
              equipment,
              data.selectedServiceIds,
              existing.selectedServices,
            )
          : resolveSelectedServiceSnapshots(equipment, data.selectedServiceIds);
      await tx.maintenanceThirdPartyService.deleteMany({
        where: { maintenanceId: existing.id },
      });
      return tx.maintenanceRecord.update({
        where: { id: existing.id },
        data: {
          equipmentId: equipment.id,
          profileId: equipment.maintenanceProfile.id,
          maintenanceDate: dateValue(data.maintenanceDate),
          profileNameSnapshot: equipment.maintenanceProfile.name,
          selectedServices,
          observations: data.observations || null,
          status: "PENDING",
          reviewNotes: null,
          thirdPartyServices: {
            create: data.thirdPartyServices.map((item, index) => ({
              serviceDate: dateValue(item.serviceDate),
              location: item.location,
              description: item.description,
              order: index + 1,
            })),
          },
        },
        include: maintenanceRecordInclude,
      });
    });
    await removeMaintenancePhotos(prisma, existing.id, data.removePhotoIds);
    await persistPhotos(updated.id, updated.equipment.code, data.photos);
    res.json(publicMaintenance(await freshMaintenance(updated.id)));
  }),
);

async function maintenanceDocumentModel(record, supervisor) {
  return {
    responsible: record.responsibleNameSnapshot,
    date: brDate(record.maintenanceDate),
    equipmentName: record.equipment.name,
    equipmentCode: record.equipment.code,
    services: (record.selectedServices || []).map((item) => item.label),
    thirdPartyServices: (record.thirdPartyServices || []).map((item) => ({
      location: item.location,
      description: item.description,
      date: brDate(item.serviceDate),
    })),
    observations: record.observations || "",
    photos: await resolveMaintenancePhotoAssets(prisma, record.id),
    supervisorName: supervisor.name,
    supervisorSignature: await resolveSignatureAsset(supervisor.signatureImage),
  };
}

async function prepareMaintenanceDocuments(records, supervisor) {
  const prepared = [];
  for (const record of records) {
    if (record.attachments?.some((item) => item.kind === "DOCUMENT")) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const model = await maintenanceDocumentModel(record, supervisor);
      // eslint-disable-next-line no-await-in-loop
      const bytes = await generateMaintenancePdf(model);
      prepared.push({
        record,
        bytes,
        fileName: maintenanceDocumentFileName(record),
      });
      logOperationalReportEvent("maintenance_document_generated", {
        maintenanceId: record.id,
        outcome: "success",
      });
    } catch (error) {
      logOperationalReportEvent(
        "maintenance_document_generated",
        {
          maintenanceId: record.id,
          outcome: "failure",
          errorName: error?.name || "Error",
          errorCode: error?.code || error?.statusCode,
        },
        { level: "error" },
      );
      throw error;
    }
  }
  return prepared;
}

async function approveMaintenanceRecords(
  {
    records,
    reportId = null,
    supervisor,
    actor,
    reviewNotes,
  },
  dependencies = {},
) {
  const database = dependencies.database || prisma;
  const prepareDocuments =
    dependencies.prepareDocuments || prepareMaintenanceDocuments;
  const createDocument =
    dependencies.createDocument || createMaintenanceDocument;
  const cleanupPaths =
    dependencies.cleanupPaths || cleanupMaintenanceStoragePaths;
  logOperationalReportEvent("maintenance_approval", {
    actorUserId: actor.id,
    reportId,
    maintenanceId: reportId ? undefined : records[0]?.id,
    attachmentCount: records.length,
    outcome: "started",
  });
  let prepared = [];
  const writtenPaths = [];
  try {
    prepared = await prepareDocuments(records, supervisor);
    await database.$transaction(async (tx) => {
      if (reportId) {
        const changed = await tx.report.updateMany({
          where: { id: reportId, status: { in: ["PENDING", "RETURNED"] } },
          data: {
            status: "APPROVED",
            reviewedByUserId: actor.id,
            reviewNotes: reviewNotes || null,
            approvedAt: new Date(),
            returnedAt: null,
          },
        });
        if (changed.count !== 1)
          throw fail(409, "O relatório já foi revisado por outra pessoa.");
      }
      for (const record of records) {
        // eslint-disable-next-line no-await-in-loop
        const changed = await tx.maintenanceRecord.updateMany({
          where: { id: record.id, status: { in: ["PENDING", "RETURNED"] } },
          data: {
            status: "APPROVED",
            reviewedByUserId: actor.id,
            reviewNotes: reviewNotes || null,
            supervisorNameSnapshot: supervisor.name,
            supervisorSignatureSnapshot: supervisor.signatureImage,
            approvedAt: new Date(),
            returnedAt: null,
          },
        });
        if (changed.count !== 1)
          throw fail(409, "A manutenção já foi revisada por outra pessoa.");
      }
      for (const item of prepared) {
        // eslint-disable-next-line no-await-in-loop
        const attachment = await createDocument(tx, {
          maintenanceId: item.record.id,
          equipmentCode: item.record.equipment.code,
          fileName: item.fileName,
          bytes: item.bytes,
        });
        writtenPaths.push(attachment.storagePath);
      }
      await tx.operationalReviewAudit.create({
        data: reportId
          ? {
              reportId,
              actorUserId: actor.id,
              actorNameSnapshot: actor.name,
              previousStatus: records[0]?.status || "PENDING",
              nextStatus: "APPROVED",
              notes: reviewNotes || null,
            }
          : {
              maintenanceId: records[0].id,
              actorUserId: actor.id,
              actorNameSnapshot: actor.name,
              previousStatus: records[0].status,
              nextStatus: "APPROVED",
              notes: reviewNotes || null,
            },
      });
    });
    logOperationalReportEvent("maintenance_approval", {
      actorUserId: actor.id,
      reportId,
      maintenanceId: reportId ? undefined : records[0]?.id,
      attachmentCount: prepared.length,
      outcome: "success",
      status: "APPROVED",
    });
  } catch (error) {
    await cleanupPaths(writtenPaths);
    logOperationalReportEvent(
      "maintenance_approval",
      {
        actorUserId: actor.id,
        reportId,
        maintenanceId: reportId ? undefined : records[0]?.id,
        attachmentCount: prepared.length,
        outcome: "failure",
        errorName: error?.name || "Error",
        errorCode: error?.code || error?.statusCode,
      },
      { level: "error" },
    );
    throw error;
  }
}

router.patch(
  "/maintenance/:id/status",
  asyncHandler(async (req, res) => {
    const data = operationalStatusInputSchema.parse(req.body);
    const [record, supervisor] = await Promise.all([
      freshMaintenance(req.params.id),
      maintenanceSupervisorState(),
    ]);
    if (!record || record.reportId)
      return res
        .status(404)
        .json({ error: "Manutenção avulsa não encontrada." });
    assertReportEmissionPermission(
      req.auth.user,
      ReportEmissionPermissions.MAINTENANCE,
    );
    if (record.status === "APPROVED" && data.status === "APPROVED")
      return res.json(publicMaintenance(record));
    if (data.status === "PENDING") {
      if (
        record.createdByUserId !== req.auth.user.id &&
        req.auth.user.accountType !== "ADMIN"
      )
        throw fail(403, "Somente o responsável pode reenviar esta manutenção.");
      assertOperationalTransition(record.status, "PENDING");
      await prisma.$transaction(async (tx) => {
        const changed = await tx.maintenanceRecord.updateMany({
          where: {
            id: record.id,
            status: { in: ["PENDING", "RETURNED"] },
          },
          data: { status: "PENDING", reviewNotes: null, returnedAt: null },
        });
        if (changed.count !== 1)
          throw fail(409, "A manutenção já foi revisada por outra pessoa.");
        await tx.operationalReviewAudit.create({
          data: {
            maintenanceId: record.id,
            actorUserId: req.auth.user.id,
            actorNameSnapshot: req.auth.user.name,
            previousStatus: record.status,
            nextStatus: "PENDING",
          },
        });
      });
    } else {
      if (!canReviewMaintenance(req.auth.user, supervisor))
        throw fail(
          403,
          supervisor.reason ||
            "Apenas o supervisor da manutenção ou um administrador pode revisar.",
        );
      assertOperationalTransition(record.status, data.status);
      if (data.status === "APPROVED") {
        if (!supervisor.valid)
          throw fail(
            409,
            supervisor.reason ||
              "Configure um supervisor válido antes de aprovar.",
          );
        await approveMaintenanceRecords({
          records: [record],
          supervisor,
          actor: req.auth.user,
          reviewNotes: data.reviewNotes,
        });
      } else {
        await prisma.$transaction(async (tx) => {
          const changed = await tx.maintenanceRecord.updateMany({
            where: {
              id: record.id,
              status: { in: ["PENDING", "RETURNED"] },
            },
            data: {
              status: "RETURNED",
              reviewedByUserId: req.auth.user.id,
              reviewNotes: data.reviewNotes || null,
              returnedAt: new Date(),
              approvedAt: null,
            },
          });
          if (changed.count !== 1)
            throw fail(409, "A manutenção já foi revisada por outra pessoa.");
          await tx.operationalReviewAudit.create({
            data: {
              maintenanceId: record.id,
              actorUserId: req.auth.user.id,
              actorNameSnapshot: req.auth.user.name,
              previousStatus: record.status,
              nextStatus: "RETURNED",
              notes: data.reviewNotes || null,
            },
          });
        });
      }
    }
    logOperationalReportEvent("review_transition", {
      actorUserId: req.auth.user.id,
      maintenanceId: record.id,
      kind: "MAINTENANCE",
      outcome: "success",
      status: data.status,
    });
    res.json(publicMaintenance(await freshMaintenance(record.id)));
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [report, supervisor] = await Promise.all([
      freshReport(req.params.id),
      maintenanceSupervisorState(),
    ]);
    if (
      !report ||
      !kindForReportType(report.reportType) ||
      !canAccessOperationalReport(req.auth.user, supervisor, report)
    ) {
      return res
        .status(404)
        .json({ error: "Relatório interno não encontrado." });
    }
    res.json(publicOperationalReport(report));
  }),
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = operationalReportInputSchema.parse(req.body);
    const existing = await freshReport(req.params.id);
    const kind = kindForReportType(existing?.reportType);
    if (!existing || !kind)
      return res
        .status(404)
        .json({ error: "Relatório interno não encontrado." });
    if (kind !== data.kind)
      throw fail(400, "O tipo do relatório não pode ser alterado.");
    assertCanEditOperationalRecord(
      req.auth.user,
      kind,
      existing.createdByUserId,
    );
    assertEditableStatus(existing.status);
    for (const input of data.maintenanceRecords) {
      if (!input.id) continue;
      const oldRecord = existing.maintenanceRecords.find(
        (item) => item.id === input.id,
      );
      if (!oldRecord) throw fail(400, "Manutenção não pertence a este RDO.");
      const retainedPhotoCount = oldRecord.attachments.filter(
        (item) =>
          item.kind === "PHOTO" && !input.removePhotoIds.includes(item.id),
      ).length;
      if (retainedPhotoCount + input.photos.length > 10)
        throw fail(400, "Cada manutenção aceita no máximo 10 fotos.");
    }
    const allCollaboratorIds = uniqueIds([
      ...data.collaboratorIds,
      ...(data.nightShift.enabled ? data.nightShift.collaboratorIds : []),
    ]);
    const removedAttachmentPaths = [];
    const updated = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: existing.projectId },
      });
      const calendar = await loadCorporateCalendar(
        tx,
        data.reportDate,
        data.reportDate,
      );
      const specialConditions = {
        ...buildOperationalSpecialConditions(data),
        daytimeCollaboratorIds: uniqueIds(data.collaboratorIds),
      };
      const overtime = calculateReportOvertime(
        project,
        { ...data, specialConditions },
        calendar,
      );
      validateOvertimeReason(overtime, data.overtimeReason);
      const collaborators = await reportCollaboratorCreateManyData(
        tx,
        allCollaboratorIds,
      );
      await tx.reportCollaborator.deleteMany({
        where: { reportId: existing.id },
      });
      await tx.chemicalCleaning.deleteMany({
        where: { reportId: existing.id },
      });
      const requestedIds = new Set(
        data.maintenanceRecords.map((item) => item.id).filter(Boolean),
      );
      for (const oldRecord of existing.maintenanceRecords) {
        if (requestedIds.has(oldRecord.id)) continue;
        removedAttachmentPaths.push(
          ...oldRecord.attachments.map((item) => item.storagePath),
        );
        // eslint-disable-next-line no-await-in-loop
        await tx.maintenanceRecord.delete({ where: { id: oldRecord.id } });
      }
      for (const input of data.maintenanceRecords) {
        // eslint-disable-next-line no-await-in-loop
        const row = await maintenanceCreateData(
          tx,
          input,
          data.reportDate,
          req.auth.user,
          existing.id,
          input.id &&
            existing.maintenanceRecords.find((item) => item.id === input.id)
              ?.equipmentId === input.equipmentId
            ? existing.maintenanceRecords.find((item) => item.id === input.id)
                ?.selectedServices
            : null,
        );
        const { thirdPartyServices, ...fields } = row;
        if (input.id) {
          if (!existing.maintenanceRecords.some((item) => item.id === input.id))
            throw fail(400, "Manutenção não pertence a este RDO.");
          delete fields.id;
          delete fields.createdByUserId;
          delete fields.responsibleNameSnapshot;
          // eslint-disable-next-line no-await-in-loop
          await tx.maintenanceThirdPartyService.deleteMany({
            where: { maintenanceId: input.id },
          });
          // eslint-disable-next-line no-await-in-loop
          await tx.maintenanceRecord.update({
            where: { id: input.id },
            data: {
              ...fields,
              reportId: existing.id,
              status: "PENDING",
              reviewNotes: null,
              thirdPartyServices,
            },
          });
        } else {
          // eslint-disable-next-line no-await-in-loop
          await tx.maintenanceRecord.create({
            data: { ...row, reportId: existing.id },
          });
        }
      }
      return tx.report.update({
        where: { id: existing.id },
        data: {
          reportDate: dateValue(data.reportDate),
          arrivalTime: data.arrivalTime,
          departureTime: data.departureTime,
          lunchBreak: data.lunchBreak,
          daytimeCount: uniqueIds(data.collaboratorIds).length,
          daytimeWorkedMinutes: overtime.daytimeWorkedMinutes,
          nighttimeWorkedMinutes: overtime.nighttimeWorkedMinutes,
          daytimeOvertimeMinutes: overtime.daytimeOvertimeMinutes,
          nighttimeOvertimeMinutes: overtime.nighttimeOvertimeMinutes,
          totalOvertimeMinutes: overtime.totalOvertimeMinutes,
          overtimeReason: data.overtimeReason || null,
          dailyDescription: data.dailyDescription,
          status: "PENDING",
          reviewNotes: null,
          specialConditions: {
            ...specialConditions,
            overtimeSummary: overtime,
          },
          collaborators: { create: collaborators },
          chemicalCleanings: {
            create: data.chemicalCleanings.map((item, index) => ({
              description: item.description,
              material: item.material,
              otherMaterial:
                item.material === "OTHER" ? item.otherMaterial : null,
              quantityKg: item.quantityKg,
              order: index + 1,
            })),
          },
        },
        include: operationalReportInclude,
      });
    });
    await cleanupMaintenanceStoragePaths(removedAttachmentPaths);
    for (let index = 0; index < data.maintenanceRecords.length; index += 1) {
      const input = data.maintenanceRecords[index];
      const record =
        updated.maintenanceRecords.find((item) => item.id === input.id) ||
        updated.maintenanceRecords[index];
      // eslint-disable-next-line no-await-in-loop
      await removeMaintenancePhotos(prisma, record.id, input.removePhotoIds);
      // eslint-disable-next-line no-await-in-loop
      await persistPhotos(record.id, record.equipment.code, input.photos);
    }
    statisticsProjectsCache.clear();
    res.json(publicOperationalReport(await freshReport(updated.id)));
  }),
);

router.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const data = operationalStatusInputSchema.parse(req.body);
    const [report, supervisor] = await Promise.all([
      freshReport(req.params.id),
      maintenanceSupervisorState(),
    ]);
    const kind = kindForReportType(report?.reportType);
    if (!report || !kind)
      return res
        .status(404)
        .json({ error: "Relatório interno não encontrado." });
    assertReportEmissionPermission(req.auth.user, permissionForKind(kind));
    if (report.status === "APPROVED" && data.status === "APPROVED")
      return res.json(publicOperationalReport(report));
    if (data.status === "PENDING") {
      if (
        report.createdByUserId !== req.auth.user.id &&
        req.auth.user.accountType !== "ADMIN"
      )
        throw fail(403, "Somente o responsável pode reenviar este relatório.");
      assertOperationalTransition(report.status, "PENDING");
      await prisma.$transaction(async (tx) => {
        const changed = await tx.report.updateMany({
          where: {
            id: report.id,
            status: { in: ["PENDING", "RETURNED"] },
          },
          data: { status: "PENDING", reviewNotes: null, returnedAt: null },
        });
        if (changed.count !== 1)
          throw fail(409, "O relatório já foi revisado por outra pessoa.");
        if (kind === "MAINTENANCE")
          await tx.maintenanceRecord.updateMany({
            where: { reportId: report.id },
            data: { status: "PENDING", reviewNotes: null, returnedAt: null },
          });
        await tx.operationalReviewAudit.create({
          data: {
            reportId: report.id,
            actorUserId: req.auth.user.id,
            actorNameSnapshot: req.auth.user.name,
            previousStatus: report.status,
            nextStatus: "PENDING",
          },
        });
      });
    } else if (kind === "MAINTENANCE") {
      if (!canReviewMaintenance(req.auth.user, supervisor))
        throw fail(
          403,
          supervisor.reason ||
            "Apenas o supervisor da manutenção ou um administrador pode revisar.",
        );
      assertOperationalTransition(report.status, data.status);
      if (data.status === "APPROVED") {
        if (!supervisor.valid)
          throw fail(
            409,
            supervisor.reason ||
              "Configure um supervisor válido antes de aprovar.",
          );
        await approveMaintenanceRecords({
          records: report.maintenanceRecords,
          reportId: report.id,
          supervisor,
          actor: req.auth.user,
          reviewNotes: data.reviewNotes,
        });
      } else {
        await prisma.$transaction(async (tx) => {
          const changed = await tx.report.updateMany({
            where: {
              id: report.id,
              status: { in: ["PENDING", "RETURNED"] },
            },
            data: {
              status: "RETURNED",
              reviewedByUserId: req.auth.user.id,
              reviewNotes: data.reviewNotes || null,
              returnedAt: new Date(),
              approvedAt: null,
            },
          });
          if (changed.count !== 1)
            throw fail(409, "O relatório já foi revisado por outra pessoa.");
          await tx.maintenanceRecord.updateMany({
            where: { reportId: report.id },
            data: {
              status: "RETURNED",
              reviewedByUserId: req.auth.user.id,
              reviewNotes: data.reviewNotes || null,
              returnedAt: new Date(),
              approvedAt: null,
            },
          });
          await tx.operationalReviewAudit.create({
            data: {
              reportId: report.id,
              actorUserId: req.auth.user.id,
              actorNameSnapshot: req.auth.user.name,
              previousStatus: report.status,
              nextStatus: "RETURNED",
              notes: data.reviewNotes || null,
            },
          });
        });
      }
    } else {
      if (!canReviewProduction(req.auth.user))
        throw fail(
          403,
          "Apenas o gestor de RDO pode revisar relatórios de produção.",
        );
      assertOperationalTransition(report.status, data.status);
      await prisma.$transaction(async (tx) => {
        const changed = await tx.report.updateMany({
          where: { id: report.id, status: { in: ["PENDING", "RETURNED"] } },
          data: {
            status: data.status,
            reviewedByUserId: req.auth.user.id,
            reviewNotes: data.reviewNotes || null,
            approvedAt: data.status === "APPROVED" ? new Date() : null,
            returnedAt: data.status === "RETURNED" ? new Date() : null,
          },
        });
        if (changed.count !== 1)
          throw fail(409, "O relatório já foi revisado por outra pessoa.");
        await tx.operationalReviewAudit.create({
          data: {
            reportId: report.id,
            actorUserId: req.auth.user.id,
            actorNameSnapshot: req.auth.user.name,
            previousStatus: report.status,
            nextStatus: data.status,
            notes: data.reviewNotes || null,
          },
        });
      });
    }
    statisticsProjectsCache.clear();
    logOperationalReportEvent("review_transition", {
      actorUserId: req.auth.user.id,
      reportId: report.id,
      kind,
      outcome: "success",
      status: data.status,
    });
    res.json(publicOperationalReport(await freshReport(report.id)));
  }),
);

router.use((error, req, _res, next) => {
  if (error?.statusCode === 403) {
    logOperationalReportEvent(
      "permission_denied",
      {
        actorUserId: req.auth?.user?.id,
        reportId: req.params?.id,
        route: `${req.method} ${req.route?.path || req.path}`,
        outcome: "denied",
        errorCode: error.statusCode,
        errorName: error.name || "Error",
      },
      { level: "warn" },
    );
  }
  next(error);
});

export {
  approveMaintenanceRecords,
  assertCanEditOperationalRecord,
  loadEquipmentForMaintenance,
  maintenanceSupervisorState,
  publicMaintenance,
  publicOperationalReport,
};
export default router;
