import assert from "node:assert/strict";
import test from "node:test";

import {
  ReportEmissionPermissions,
  emissionPermissionForReportType,
  existingUserEmissionPermissionBackfill,
  hasReportEmissionPermission,
  normalizeReportEmissionPermissions,
} from "../src/lib/operational-reports/permissions.js";

test("normalizes independent permissions and rejects emission for clients", () => {
  assert.deepEqual(
    normalizeReportEmissionPermissions(
      ["PRODUCTION", "SITE_RDO", "PRODUCTION"],
      "INTERNAL",
    ),
    ["SITE_RDO", "PRODUCTION"],
  );
  assert.deepEqual(
    normalizeReportEmissionPermissions(["SITE_RDO"], "CLIENT"),
    [],
  );
  assert.throws(
    () => normalizeReportEmissionPermissions(["UNKNOWN"], "INTERNAL"),
    /Permissão de emissão inválida/,
  );
});

test("maps report types to their emission capability", () => {
  assert.equal(
    emissionPermissionForReportType("RDO"),
    ReportEmissionPermissions.SITE_RDO,
  );
  assert.equal(
    emissionPermissionForReportType("RDO_MAINTENANCE"),
    ReportEmissionPermissions.MAINTENANCE,
  );
  assert.equal(
    emissionPermissionForReportType("RDO_PRODUCTION"),
    ReportEmissionPermissions.PRODUCTION,
  );
  assert.equal(emissionPermissionForReportType("RTP"), null);
});

test("checks loaded account permissions without implicit grants", () => {
  const user = { reportEmissionPermissions: ["MAINTENANCE"] };
  assert.equal(hasReportEmissionPermission(user, "MAINTENANCE"), true);
  assert.equal(hasReportEmissionPermission(user, "SITE_RDO"), false);
  assert.equal(hasReportEmissionPermission({}, "SITE_RDO"), false);
});

test("backfill preserves site RDO only for existing internal RDO actors", () => {
  assert.deepEqual(
    existingUserEmissionPermissionBackfill({
      accountType: "INTERNAL",
      moduleRoles: [{ role: "RDO_COLLABORATOR" }],
    }),
    ["SITE_RDO"],
  );
  assert.deepEqual(
    existingUserEmissionPermissionBackfill({
      accountType: "ADMIN",
      moduleRoles: [{ role: "RDO_MANAGER" }],
    }),
    ["SITE_RDO"],
  );
  assert.deepEqual(
    existingUserEmissionPermissionBackfill({
      accountType: "INTERNAL",
      moduleRoles: [{ role: "EQUIPAMENTOS_VIEWER" }],
    }),
    [],
  );
  assert.deepEqual(
    existingUserEmissionPermissionBackfill({
      accountType: "CLIENT",
      moduleRoles: [{ role: "RDO_CLIENT" }],
    }),
    [],
  );
});
