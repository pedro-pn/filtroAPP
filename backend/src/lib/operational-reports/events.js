const ALLOWED_FIELDS = new Set([
  "actorUserId",
  "attachmentCount",
  "errorCode",
  "errorName",
  "kind",
  "maintenanceId",
  "outcome",
  "photoCount",
  "reportId",
  "route",
  "status",
]);

export function operationalReportEvent(event, context = {}) {
  const details = {};
  for (const [key, value] of Object.entries(context)) {
    if (!ALLOWED_FIELDS.has(key) || value === undefined || value === null)
      continue;
    details[key] =
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
        ? value
        : String(value);
  }
  return {
    scope: "operational-reports",
    event,
    timestamp: new Date().toISOString(),
    ...details,
  };
}

export function logOperationalReportEvent(
  event,
  context = {},
  { level = "info", logger = console } = {},
) {
  const payload = operationalReportEvent(event, context);
  const write = logger[level] || logger.info || logger.log;
  write.call(logger, "[operational-reports]", payload);
  return payload;
}
