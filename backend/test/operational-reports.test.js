import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMaintenanceScheduleItem,
  canReviewMaintenance,
  canReviewProduction,
  maintenanceInputSchema,
  maintenanceProfileSchema,
  maintenanceScheduleQuerySchema,
  mergeSelectedServiceSnapshots,
  operationalReportInputSchema,
  operationalStatusInputSchema,
  resolveEffectiveMaintenanceProfile,
  resolveSelectedServiceSnapshots,
  shouldGenerateGeneralReportDocument,
  validateOvertimeReason,
} from "../src/lib/operational-reports/domain.js";

const maintenanceCard = {
  equipmentId: "equipment-1",
  selectedServiceIds: ["item-2", "item-1"],
  observations: "",
  thirdPartyServices: [],
  photos: [],
};

const baseReport = {
  kind: "MAINTENANCE",
  reportDate: "2026-09-03",
  arrivalTime: "07:00",
  departureTime: "17:00",
  lunchBreak: "01:00:00",
  collaboratorIds: ["collab-1"],
  nightShift: { enabled: false, collaboratorIds: [] },
  dailyDescription: "Manutenção preventiva",
  maintenanceRecords: [maintenanceCard],
  chemicalCleanings: [],
};

test("maintenance report requires cards and production requires chemical cleanings", () => {
  assert.equal(
    operationalReportInputSchema.safeParse(baseReport).success,
    true,
  );
  assert.equal(
    operationalReportInputSchema.safeParse({
      ...baseReport,
      maintenanceRecords: [],
    }).success,
    false,
  );

  const production = {
    ...baseReport,
    kind: "PRODUCTION",
    maintenanceRecords: [],
    chemicalCleanings: [
      {
        description: "Decapagem",
        material: "CARBON_STEEL",
        quantityKg: 12.5,
      },
    ],
  };
  assert.equal(
    operationalReportInputSchema.safeParse(production).success,
    true,
  );
  assert.equal(
    operationalReportInputSchema.safeParse({
      ...production,
      dailyDescription: undefined,
    }).success,
    true,
  );
  assert.equal(
    operationalReportInputSchema.safeParse({
      ...baseReport,
      dailyDescription: "",
    }).success,
    false,
  );
  assert.equal(
    operationalReportInputSchema.safeParse({
      ...production,
      chemicalCleanings: [
        { ...production.chemicalCleanings[0], quantityKg: 0 },
      ],
    }).success,
    false,
  );
});

test("other material and third-party rows validate conditional required fields", () => {
  const production = {
    ...baseReport,
    kind: "PRODUCTION",
    maintenanceRecords: [],
    chemicalCleanings: [
      { description: "Peça", material: "OTHER", quantityKg: 1 },
    ],
  };
  assert.equal(
    operationalReportInputSchema.safeParse(production).success,
    false,
  );
  assert.equal(
    operationalReportInputSchema.safeParse({
      ...production,
      chemicalCleanings: [
        { ...production.chemicalCleanings[0], otherMaterial: "Latão" },
      ],
    }).success,
    true,
  );

  assert.equal(
    maintenanceInputSchema.safeParse({
      ...maintenanceCard,
      maintenanceDate: "2026-09-03",
      thirdPartyServices: [{ serviceDate: "", location: "", description: "" }],
    }).success,
    false,
  );
});

test("selected service snapshots follow configured profile order, not request order", () => {
  const equipment = {
    maintenanceProfile: {
      id: "profile-1",
      name: "UFI",
      isActive: true,
      items: [
        { id: "item-1", label: "Pintura", order: 1, isActive: true },
        { id: "item-2", label: "Teste", order: 2, isActive: true },
      ],
    },
  };
  assert.deepEqual(
    resolveSelectedServiceSnapshots(equipment, ["item-2", "item-1"]),
    [
      { itemId: "item-1", label: "Pintura", order: 1 },
      { itemId: "item-2", label: "Teste", order: 2 },
    ],
  );
  assert.throws(
    () => resolveSelectedServiceSnapshots(equipment, ["unknown"]),
    /checklist vigente/,
  );
});

test("maintenance profile inherits from category and allows explicit equipment exceptions", () => {
  const inheritedProfile = { id: "profile-category", isActive: true, items: [] };
  const individualProfile = { id: "profile-equipment", isActive: true, items: [] };

  assert.equal(
    resolveEffectiveMaintenanceProfile({
      maintenanceProfileOverride: false,
      maintenanceProfile: null,
      category: { maintenanceProfile: inheritedProfile },
    }),
    inheritedProfile,
  );
  assert.equal(
    resolveEffectiveMaintenanceProfile({
      maintenanceProfileOverride: true,
      maintenanceProfile: individualProfile,
      category: { maintenanceProfile: inheritedProfile },
    }),
    individualProfile,
  );
  assert.equal(
    resolveEffectiveMaintenanceProfile({
      maintenanceProfileOverride: true,
      maintenanceProfile: null,
      category: { maintenanceProfile: inheritedProfile },
    }),
    null,
  );
});

test("maintenance profile contract preserves stable checklist items and their active state", () => {
  const parsed = maintenanceProfileSchema.parse({
    name: "UFI",
    items: [
      { id: "item-1", label: "Pintura", order: 2, isActive: false },
      { label: "Teste", order: 1, isActive: true },
    ],
  });

  assert.equal(parsed.items[0].id, "item-1");
  assert.equal(parsed.items[0].isActive, false);
  assert.equal(parsed.items[1].isActive, true);
  assert.equal(
    maintenanceProfileSchema.safeParse({
      name: "UFI",
      items: [
        { label: "Teste", order: 1, isActive: true },
        { label: " teste ", order: 2, isActive: false },
      ],
    }).success,
    false,
  );
});

test("maintenance edit keeps historical service snapshots when profile items changed", () => {
  const equipment = {
    maintenanceProfile: {
      id: "profile-1",
      name: "UFI revisado",
      isActive: true,
      items: [
        { id: "new-item", label: "Teste novo", order: 1, isActive: true },
      ],
    },
  };

  assert.deepEqual(
    mergeSelectedServiceSnapshots(equipment, ["old-item", "new-item"], [
      { itemId: "old-item", label: "Pintura", order: 1 },
    ]),
    [
      { itemId: "old-item", label: "Pintura", order: 1 },
      { itemId: "new-item", label: "Teste novo", order: 2 },
    ],
  );
});

test("maintenance approval accepts global supervisor or ADMIN and production accepts RDO manager", () => {
  const supervisor = {
    id: "user-supervisor",
    accountType: "INTERNAL",
    moduleRoles: ["rdo:collaborator"],
  };
  assert.equal(
    canReviewMaintenance(supervisor, {
      userId: "user-supervisor",
      valid: true,
    }),
    true,
  );
  assert.equal(
    canReviewMaintenance(
      { id: "admin", accountType: "ADMIN" },
      { userId: "other", valid: true },
    ),
    true,
  );
  assert.equal(
    canReviewMaintenance(
      { id: "other", accountType: "INTERNAL" },
      { userId: "supervisor", valid: true },
    ),
    false,
  );
  assert.equal(
    canReviewMaintenance(
      { id: "admin", accountType: "ADMIN" },
      { userId: null, valid: false },
    ),
    true,
  );
  assert.equal(canReviewProduction({ moduleRoles: ["rdo:manager"] }), true);
  assert.equal(
    canReviewProduction({ moduleRoles: ["rdo:coordinator"] }),
    false,
  );
});

test("supervisor ausente bloqueia aprovação documental, mas não o acesso administrativo à revisão", () => {
  assert.equal(
    canReviewMaintenance(
      { id: "admin", accountType: "ADMIN" },
      { userId: null, valid: false },
    ),
    true,
  );
});

test("status and overtime rules reject invalid transitions or missing reason", () => {
  assert.equal(
    operationalStatusInputSchema.safeParse({ status: "APPROVED" }).success,
    true,
  );
  assert.equal(
    operationalStatusInputSchema.safeParse({ status: "SIGNED" }).success,
    false,
  );
  assert.doesNotThrow(() =>
    validateOvertimeReason({ totalOvertimeMinutes: 0 }, ""),
  );
  assert.throws(
    () => validateOvertimeReason({ totalOvertimeMinutes: 60 }, ""),
    /justificativa/,
  );
});

test("internal operational RDOs never generate a general report document", () => {
  assert.equal(shouldGenerateGeneralReportDocument("RDO_MAINTENANCE"), false);
  assert.equal(shouldGenerateGeneralReportDocument("RDO_PRODUCTION"), false);
  assert.equal(shouldGenerateGeneralReportDocument("RDO"), true);
});

test("programação preventiva calcula próxima data e diferencia vencimento, ausência de histórico e configuração", () => {
  const equipment = {
    id: "equipment-1",
    code: "UFI 001",
    name: "Unidade de filtragem",
    category: {
      id: "category-1",
      name: "UFI",
      maintenanceIntervalDays: 30,
    },
    maintenanceRecords: [
      { id: "maintenance-1", maintenanceDate: new Date("2026-08-01T00:00:00.000Z") },
    ],
  };

  assert.deepEqual(buildMaintenanceScheduleItem(equipment, "2026-09-04"), {
    equipment: {
      id: "equipment-1",
      code: "UFI 001",
      name: "Unidade de filtragem",
    },
    category: {
      id: "category-1",
      name: "UFI",
      maintenanceIntervalDays: 30,
    },
    lastMaintenanceId: "maintenance-1",
    lastMaintenanceDate: "2026-08-01",
    nextMaintenanceDate: "2026-08-31",
    status: "OVERDUE",
    daysUntilDue: -4,
  });
  assert.equal(
    buildMaintenanceScheduleItem(
      { ...equipment, maintenanceRecords: [] },
      "2026-09-04",
    ).status,
    "NO_HISTORY",
  );
  assert.equal(
    buildMaintenanceScheduleItem(
      {
        ...equipment,
        category: { ...equipment.category, maintenanceIntervalDays: null },
      },
      "2026-09-04",
    ).status,
    "UNCONFIGURED",
  );
  assert.equal(
    buildMaintenanceScheduleItem(
      {
        ...equipment,
        maintenanceRecords: [
          { id: "maintenance-2", maintenanceDate: "2026-08-05" },
        ],
      },
      "2026-09-04",
    ).status,
    "DUE_TODAY",
  );
  assert.equal(
    maintenanceScheduleQuerySchema.safeParse({ status: "UNKNOWN" }).success,
    false,
  );
});
