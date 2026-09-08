import assert from "node:assert/strict";
import test from "node:test";

import { buildSedeOperationalMetrics } from "../src/lib/acompanhamento/sede-operational-metrics.js";

const reports = [
  {
    id: "m1",
    reportType: "RDO_MAINTENANCE",
    status: "APPROVED",
    reportDate: new Date("2026-09-02"),
    daytimeWorkedMinutes: 480,
    nighttimeWorkedMinutes: 120,
    totalOvertimeMinutes: 60,
    collaborators: [{ collaboratorId: "c1" }, { collaboratorId: "c2" }],
    chemicalCleanings: [],
  },
  {
    id: "p1",
    reportType: "RDO_PRODUCTION",
    status: "APPROVED",
    reportDate: new Date("2026-09-03"),
    daytimeWorkedMinutes: 420,
    nighttimeWorkedMinutes: 0,
    totalOvertimeMinutes: 30,
    collaborators: [{ collaboratorId: "c2" }, { collaboratorId: "c3" }],
    chemicalCleanings: [
      { material: "CARBON_STEEL", quantityKg: 12.5 },
      { material: "OTHER", otherMaterial: "Titânio", quantityKg: 2 },
    ],
  },
  {
    id: "ignored",
    reportType: "RDO_PRODUCTION",
    status: "PENDING",
    reportDate: new Date("2026-09-03"),
    daytimeWorkedMinutes: 999,
    nighttimeWorkedMinutes: 0,
    totalOvertimeMinutes: 999,
    collaborators: [{ collaboratorId: "c9" }],
    chemicalCleanings: [{ material: "CUNIFE", quantityKg: 999 }],
  },
];

const maintenanceRecords = [
  {
    id: "mr1",
    status: "APPROVED",
    maintenanceDate: new Date("2026-09-02"),
    profileNameSnapshot: "UFI",
    equipment: { id: "e1", code: "EQ-1", name: "Unidade 1" },
  },
  {
    id: "mr2",
    status: "APPROVED",
    maintenanceDate: new Date("2026-09-05"),
    profileNameSnapshot: "UFI",
    equipment: { id: "e1", code: "EQ-1", name: "Unidade 1" },
  },
  {
    id: "mr3",
    status: "APPROVED",
    maintenanceDate: new Date("2026-09-06"),
    profileNameSnapshot: "UTH",
    equipment: { id: "e2", code: "EQ-2", name: "Unidade 2" },
  },
  {
    id: "ignored",
    status: "RETURNED",
    maintenanceDate: new Date("2026-09-06"),
    profileNameSnapshot: "UTH",
    equipment: { id: "e2", code: "EQ-2", name: "Unidade 2" },
  },
];

test("agrega somente aprovados por tipo, perfil, equipamento e material", () => {
  const result = buildSedeOperationalMetrics({ reports, maintenanceRecords });
  assert.deepEqual(result.maintenance.summary, {
    reportCount: 1,
    maintenanceCount: 3,
    workedMinutes: 600,
    overtimeMinutes: 60,
    collaboratorCount: 2,
  });
  assert.equal(result.maintenance.byProfile[0].profileName, "UFI");
  assert.equal(result.maintenance.byProfile[0].maintenanceCount, 2);
  assert.equal(result.maintenance.byEquipment[0].equipmentCode, "EQ-1");
  assert.equal(result.production.summary.totalKg, 14.5);
  assert.equal(result.production.summary.collaboratorCount, 2);
  assert.deepEqual(
    result.production.byMaterial.map((item) => [item.material, item.totalKg]),
    [
      ["CARBON_STEEL", 12.5],
      ["OTHER", 2],
    ],
  );
});

test("respeita período mensal inclusivo", () => {
  const result = buildSedeOperationalMetrics({
    reports,
    maintenanceRecords,
    range: { fromMonth: "2026-09", toMonth: "2026-09" },
  });
  assert.equal(result.maintenance.summary.maintenanceCount, 3);
  const empty = buildSedeOperationalMetrics({
    reports,
    maintenanceRecords,
    range: { fromMonth: "2026-08", toMonth: "2026-08" },
  });
  assert.equal(empty.maintenance.summary.reportCount, 0);
  assert.equal(empty.production.summary.totalKg, 0);
});
