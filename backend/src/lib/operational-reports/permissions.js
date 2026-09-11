export const ReportEmissionPermissions = Object.freeze({
  SITE_RDO: "SITE_RDO",
  MAINTENANCE: "MAINTENANCE",
  PRODUCTION: "PRODUCTION",
});

const ORDERED_PERMISSIONS = Object.freeze(
  Object.values(ReportEmissionPermissions),
);
const PERMISSION_SET = new Set(ORDERED_PERMISSIONS);

const REPORT_TYPE_PERMISSION = Object.freeze({
  RDO: ReportEmissionPermissions.SITE_RDO,
  RDO_MAINTENANCE: ReportEmissionPermissions.MAINTENANCE,
  RDO_PRODUCTION: ReportEmissionPermissions.PRODUCTION,
});

const INTERNAL_RDO_ROLES = new Set([
  "RDO_MANAGER",
  "RDO_COORDINATOR",
  "RDO_COLLABORATOR",
  "rdo:manager",
  "rdo:coordinator",
  "rdo:collaborator",
]);

export function normalizeReportEmissionPermissions(
  value,
  accountType = "INTERNAL",
) {
  if (accountType === "CLIENT") return [];
  const requested = Array.isArray(value) ? value : [];
  const normalized = new Set();
  for (const raw of requested) {
    const permission = String(raw || "")
      .trim()
      .toUpperCase();
    if (!PERMISSION_SET.has(permission)) {
      const error = new Error(
        `Permissão de emissão inválida: ${permission || "(vazia)"}.`,
      );
      error.statusCode = 400;
      throw error;
    }
    normalized.add(permission);
  }
  return ORDERED_PERMISSIONS.filter((permission) => normalized.has(permission));
}

export function serializeReportEmissionPermissions(user) {
  if (
    !Object.prototype.hasOwnProperty.call(
      user || {},
      "reportEmissionPermissions",
    )
  ) {
    return existingUserEmissionPermissionBackfill(user);
  }
  return normalizeReportEmissionPermissions(
    user?.reportEmissionPermissions || [],
    user?.accountType,
  );
}

export function hasReportEmissionPermission(user, permission) {
  if (!PERMISSION_SET.has(permission)) return false;
  return serializeReportEmissionPermissions(user).includes(permission);
}

export function emissionPermissionForReportType(reportType) {
  return (
    REPORT_TYPE_PERMISSION[
      String(reportType || "")
        .trim()
        .toUpperCase()
    ] || null
  );
}

export function assertReportEmissionPermission(user, permission) {
  if (hasReportEmissionPermission(user, permission)) return;
  const error = new Error(
    "Sua conta não possui permissão para emitir este tipo de relatório.",
  );
  error.statusCode = 403;
  throw error;
}

export function assertReportTypeEmissionPermission(user, reportType) {
  const permission = emissionPermissionForReportType(reportType);
  if (permission) assertReportEmissionPermission(user, permission);
}

export function existingUserEmissionPermissionBackfill(user) {
  if (!user || user.accountType === "CLIENT") return [];
  const roles = Array.isArray(user.moduleRoles) ? user.moduleRoles : [];
  const hasInternalRdoRole =
    roles.some((item) =>
      INTERNAL_RDO_ROLES.has(typeof item === "string" ? item : item?.role),
    ) || ["MANAGER", "COORDINATOR", "COLLABORATOR"].includes(user.role);
  return hasInternalRdoRole ? [ReportEmissionPermissions.SITE_RDO] : [];
}
