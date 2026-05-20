CREATE UNIQUE INDEX IF NOT EXISTS "ReportVersion_one_active_per_report_idx"
ON "ReportVersion"("reportId")
WHERE "status" = 'ACTIVE';
