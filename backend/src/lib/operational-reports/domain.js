import { z } from "zod";

import { hasModuleRole } from "../module-roles.js";

export const OperationalReportKinds = Object.freeze({
  MAINTENANCE: "MAINTENANCE",
  PRODUCTION: "PRODUCTION",
});

export const OPERATIONAL_REPORT_TYPE_BY_KIND = Object.freeze({
  MAINTENANCE: "RDO_MAINTENANCE",
  PRODUCTION: "RDO_PRODUCTION",
});

export const OPERATIONAL_PROJECT_CODE_BY_KIND = Object.freeze({
  MAINTENANCE: "5002",
  PRODUCTION: "5004",
});

const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida.");
const timeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Informe um horário válido.");
const breakSchema = z
  .string()
  .trim()
  .regex(
    /^\d{1,2}:[0-5]\d(?::[0-5]\d)?$/,
    "Informe o intervalo no formato HH:mm ou HH:mm:ss.",
  );
const idSchema = z.string().trim().min(1);

export const maintenancePhotoSchema = z.object({
  fileName: z.string().trim().min(1).max(240).optional(),
  mimeType: z.string().trim().min(1).max(100).optional(),
  dataUrl: z.string().min(1),
});

export const thirdPartyServiceSchema = z.object({
  serviceDate: dateSchema,
  location: z.string().trim().min(1, "Informe o local.").max(300),
  description: z.string().trim().min(1, "Informe o serviço.").max(2000),
});

export const maintenanceCardSchema = z.object({
  id: idSchema.optional(),
  equipmentId: idSchema,
  selectedServiceIds: z.array(idSchema).min(1, "Marque ao menos um serviço."),
  observations: z.string().trim().max(5000).optional().nullable(),
  thirdPartyServices: z.array(thirdPartyServiceSchema).default([]),
  photos: z
    .array(maintenancePhotoSchema)
    .max(10, "Cada manutenção aceita no máximo 10 fotos.")
    .default([]),
  removePhotoIds: z.array(idSchema).max(10).optional().default([]),
});

export const maintenanceInputSchema = maintenanceCardSchema.extend({
  maintenanceDate: dateSchema,
});

export const chemicalCleaningSchema = z
  .object({
    description: z.string().trim().min(1, "Informe a descrição.").max(2000),
    material: z.enum(["CARBON_STEEL", "STAINLESS_STEEL", "CUNIFE", "OTHER"]),
    otherMaterial: z.string().trim().max(300).optional().nullable(),
    quantityKg: z.coerce
      .number()
      .positive("A quantidade deve ser maior que zero.")
      .max(999999999),
  })
  .superRefine((data, ctx) => {
    if (data.material === "OTHER" && !data.otherMaterial) {
      ctx.addIssue({
        code: "custom",
        path: ["otherMaterial"],
        message: "Informe qual é o outro material.",
      });
    }
  });

const nightShiftSchema = z
  .object({
    enabled: z.boolean().default(false),
    arrivalTime: z.string().trim().optional().default(""),
    departureTime: z.string().trim().optional().default(""),
    breakTime: z.string().trim().optional().default(""),
    collaboratorIds: z.array(idSchema).default([]),
  })
  .superRefine((data, ctx) => {
    if (!data.enabled) return;
    for (const [key, value, schema] of [
      ["arrivalTime", data.arrivalTime, timeSchema],
      ["departureTime", data.departureTime, timeSchema],
      ["breakTime", data.breakTime, breakSchema],
    ]) {
      if (!schema.safeParse(value).success) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message:
            key === "breakTime"
              ? "Informe o intervalo noturno."
              : "Informe o horário noturno.",
        });
      }
    }
    if (!data.collaboratorIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["collaboratorIds"],
        message: "Selecione ao menos um colaborador noturno.",
      });
    }
  });

export const operationalReportInputSchema = z
  .object({
    kind: z.enum(["MAINTENANCE", "PRODUCTION"]),
    reportDate: dateSchema,
    arrivalTime: timeSchema,
    departureTime: timeSchema,
    lunchBreak: breakSchema,
    collaboratorIds: z
      .array(idSchema)
      .min(1, "Selecione ao menos um colaborador."),
    nightShift: nightShiftSchema.default({
      enabled: false,
      collaboratorIds: [],
    }),
    overtimeReason: z.string().trim().max(2000).optional().nullable(),
    dailyDescription: z.string().trim().max(10000).optional().nullable(),
    maintenanceRecords: z.array(maintenanceCardSchema).default([]),
    chemicalCleanings: z.array(chemicalCleaningSchema).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "MAINTENANCE") {
      if (!data.dailyDescription) {
        ctx.addIssue({
          code: "custom",
          path: ["dailyDescription"],
          message: "Descreva as atividades do dia.",
        });
      }
      if (!data.maintenanceRecords.length) {
        ctx.addIssue({
          code: "custom",
          path: ["maintenanceRecords"],
          message: "Adicione ao menos uma manutenção.",
        });
      }
      if (data.chemicalCleanings.length) {
        ctx.addIssue({
          code: "custom",
          path: ["chemicalCleanings"],
          message: "RDO de manutenção não aceita limpeza química.",
        });
      }
    }
    if (data.kind === "PRODUCTION") {
      if (!data.chemicalCleanings.length) {
        ctx.addIssue({
          code: "custom",
          path: ["chemicalCleanings"],
          message: "Adicione ao menos uma limpeza química.",
        });
      }
      if (data.maintenanceRecords.length) {
        ctx.addIssue({
          code: "custom",
          path: ["maintenanceRecords"],
          message: "RDO de produção não aceita manutenção.",
        });
      }
    }
  });

export const operationalStatusInputSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "RETURNED"]),
  reviewNotes: z.string().trim().max(4000).optional().nullable(),
});

export const operationalListQuerySchema = z.object({
  kind: z.enum(["MAINTENANCE", "PRODUCTION"]).optional(),
  status: z.enum(["PENDING", "APPROVED", "RETURNED"]).optional(),
  mine: z.enum(["true", "false"]).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(30),
});

export const maintenanceListQuerySchema = operationalListQuerySchema
  .omit({ kind: true })
  .extend({
    equipmentId: idSchema.optional(),
  });

export const maintenanceHistoryQuerySchema = z.object({
  q: z.string().trim().max(160).optional().default(""),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z
    .enum([
      "maintenanceDate",
      "tag",
      "equipment",
      "category",
      "responsible",
    ])
    .default("maintenanceDate"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
});

export const maintenanceScheduleQuerySchema = z.object({
  q: z.string().trim().max(160).optional().default(""),
  categoryId: idSchema.optional(),
  status: z
    .enum(["OVERDUE", "DUE_TODAY", "UPCOMING", "NO_HISTORY", "UNCONFIGURED"])
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

export const maintenanceConfigSchema = z.object({
  supervisorCollaboratorId: idSchema.nullable(),
});

export const maintenanceProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    order: z.number().int().nonnegative().optional(),
    isActive: z.boolean().optional(),
    items: z
      .array(
        z.object({
          id: idSchema.optional(),
          label: z.string().trim().min(1).max(300),
          order: z.number().int().positive().optional(),
          isActive: z.boolean().optional().default(true),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((data, ctx) => {
    const labels = data.items.map((item) =>
      item.label.toLocaleLowerCase("pt-BR"),
    );
    if (new Set(labels).size !== labels.length) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "O perfil não pode conter serviços duplicados.",
      });
    }
  });

function scheduleDateKey(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const key = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

function addCalendarDays(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function buildMaintenanceScheduleItem(equipment, today) {
  const intervalDays = Number.isInteger(equipment?.category?.maintenanceIntervalDays)
    && equipment.category.maintenanceIntervalDays > 0
    ? equipment.category.maintenanceIntervalDays
    : null;
  const latest = equipment?.maintenanceRecords?.[0] || null;
  const lastMaintenanceDate = scheduleDateKey(latest?.maintenanceDate);
  const nextMaintenanceDate = intervalDays && lastMaintenanceDate
    ? addCalendarDays(lastMaintenanceDate, intervalDays)
    : null;
  let status = "UPCOMING";
  if (!intervalDays) status = "UNCONFIGURED";
  else if (!lastMaintenanceDate) status = "NO_HISTORY";
  else if (nextMaintenanceDate < today) status = "OVERDUE";
  else if (nextMaintenanceDate === today) status = "DUE_TODAY";
  const daysUntilDue = nextMaintenanceDate
    ? Math.round(
        (new Date(`${nextMaintenanceDate}T00:00:00.000Z`).getTime()
          - new Date(`${today}T00:00:00.000Z`).getTime())
          / 86_400_000,
      )
    : null;
  return {
    equipment: {
      id: equipment.id,
      code: equipment.code,
      name: equipment.name,
    },
    category: {
      id: equipment.category.id,
      name: equipment.category.name,
      maintenanceIntervalDays: intervalDays,
    },
    lastMaintenanceId: latest?.id || null,
    lastMaintenanceDate,
    nextMaintenanceDate,
    status,
    daysUntilDue,
  };
}

export function reportTypeForOperationalKind(kind) {
  return OPERATIONAL_REPORT_TYPE_BY_KIND[kind] || null;
}

export function projectCodeForOperationalKind(kind) {
  return OPERATIONAL_PROJECT_CODE_BY_KIND[kind] || null;
}

export function uniqueIds(value) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
}

export function buildOperationalSpecialConditions(data) {
  const night = data.nightShift || {};
  return {
    operationalReport: true,
    noturno: Boolean(night.enabled),
    noturnoDetails: {
      enabled: Boolean(night.enabled),
      inicio: night.enabled ? night.arrivalTime : "",
      termino: night.enabled ? night.departureTime : "",
      intervalo: night.enabled ? night.breakTime : "",
      collaboratorIds: night.enabled ? uniqueIds(night.collaboratorIds) : [],
    },
  };
}

export function validateOvertimeReason(overtime, reason) {
  if (
    Number(overtime?.totalOvertimeMinutes || 0) <= 0 ||
    String(reason || "").trim()
  )
    return;
  const error = new Error("Informe a justificativa das horas extras.");
  error.statusCode = 400;
  throw error;
}

export function resolveEffectiveMaintenanceProfile(equipment) {
  if (equipment?.maintenanceProfileOverride === true) {
    return equipment.maintenanceProfile || null;
  }
  if (equipment?.category?.maintenanceProfile) {
    return equipment.category.maintenanceProfile;
  }
  if (equipment?.maintenanceProfileOverride === false) return null;
  // Compatibilidade com objetos antigos e fixtures que ainda não possuem o flag.
  return equipment?.maintenanceProfile || null;
}

export function resolveSelectedServiceSnapshots(equipment, selectedServiceIds) {
  const profile = resolveEffectiveMaintenanceProfile(equipment);
  if (!profile?.isActive) {
    const error = new Error(
      "O equipamento não possui um perfil de manutenção ativo.",
    );
    error.statusCode = 400;
    throw error;
  }
  const selected = new Set(uniqueIds(selectedServiceIds));
  const activeItems = (profile.items || []).filter((item) => item.isActive);
  const snapshots = activeItems
    .filter((item) => selected.has(item.id))
    .sort((a, b) => a.order - b.order)
    .map((item) => ({ itemId: item.id, label: item.label, order: item.order }));
  if (!snapshots.length || snapshots.length !== selected.size) {
    const error = new Error(
      "Selecione serviços disponíveis no checklist vigente do equipamento.",
    );
    error.statusCode = 400;
    throw error;
  }
  return snapshots;
}

export function mergeSelectedServiceSnapshots(
  equipment,
  selectedServiceIds,
  previousSnapshots = [],
) {
  const profile = resolveEffectiveMaintenanceProfile(equipment);
  if (!profile?.isActive) {
    const error = new Error(
      "O equipamento não possui um perfil de manutenção ativo.",
    );
    error.statusCode = 400;
    throw error;
  }

  const currentItems = new Map(
    (profile.items || [])
      .filter((item) => item.isActive)
      .map((item) => [item.id, item]),
  );
  const historicalItems = new Map(
    (previousSnapshots || []).map((item) => [item.itemId, item]),
  );

  return uniqueIds(selectedServiceIds).map((itemId, index) => {
    const item = currentItems.get(itemId) || historicalItems.get(itemId);
    if (!item) {
      const error = new Error(
        "Selecione serviços disponíveis no checklist vigente do equipamento.",
      );
      error.statusCode = 400;
      throw error;
    }
    return {
      itemId,
      label: item.label,
      order: index + 1,
    };
  });
}

export function canReviewMaintenance(user, supervisor) {
  return (
    user?.accountType === "ADMIN" ||
    Boolean(supervisor?.userId && user?.id === supervisor.userId)
  );
}

export function canReviewProduction(user) {
  return hasModuleRole(user, "rdo:manager");
}

export function assertEditableStatus(status) {
  if (status === "PENDING" || status === "RETURNED") return;
  const error = new Error("Registro aprovado não pode ser alterado.");
  error.statusCode = 409;
  throw error;
}

export function assertOperationalTransition(previousStatus, nextStatus) {
  const allowed = {
    PENDING: new Set(["APPROVED", "RETURNED"]),
    RETURNED: new Set(["PENDING", "APPROVED", "RETURNED"]),
    APPROVED: new Set([]),
  };
  if (previousStatus === nextStatus && previousStatus !== "APPROVED") return;
  if (allowed[previousStatus]?.has(nextStatus)) return;
  const error = new Error("Transição de status inválida para este registro.");
  error.statusCode = 409;
  throw error;
}

export function shouldGenerateGeneralReportDocument(reportType) {
  return reportType !== "RDO_MAINTENANCE" && reportType !== "RDO_PRODUCTION";
}

export const maintenanceRecordInclude = {
  equipment: {
    include: {
      category: {
        include: {
          maintenanceProfile: {
            include: { items: { orderBy: { order: "asc" } } },
          },
        },
      },
      maintenanceProfile: { include: { items: { orderBy: { order: "asc" } } } },
    },
  },
  profile: { include: { items: { orderBy: { order: "asc" } } } },
  createdBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
  thirdPartyServices: { orderBy: { order: "asc" } },
  attachments: { orderBy: { createdAt: "asc" } },
  reviewAudits: { orderBy: { createdAt: "asc" } },
};

export const operationalReportInclude = {
  project: true,
  createdBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
  collaborators: { include: { collaborator: { include: { jobRole: true } } } },
  maintenanceRecords: {
    include: maintenanceRecordInclude,
    orderBy: { createdAt: "asc" },
  },
  chemicalCleanings: { orderBy: { order: "asc" } },
  operationalReviewAudits: { orderBy: { createdAt: "asc" } },
};
