CREATE INDEX CONCURRENTLY IF NOT EXISTS "ClientReportReview_reportId_createdAt_idx"
ON "ClientReportReview"("reportId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReportService_reportId_idx"
ON "ReportService"("reportId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReportAttachment_reportId_idx"
ON "ReportAttachment"("reportId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReportAttachment_reportServiceId_idx"
ON "ReportAttachment"("reportServiceId");
