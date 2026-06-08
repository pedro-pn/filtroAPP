CREATE INDEX CONCURRENTLY IF NOT EXISTS "Report_active_date_created_idx"
ON "Report"("reportDate" DESC, "createdAt" DESC)
WHERE "deletedAt" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Report_active_project_date_created_idx"
ON "Report"("projectId", "reportDate" DESC, "createdAt" DESC)
WHERE "deletedAt" IS NULL;
