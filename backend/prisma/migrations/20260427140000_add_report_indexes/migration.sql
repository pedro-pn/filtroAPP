-- AddIndex: melhora performance de listagens e filtros na tabela Report

CREATE INDEX IF NOT EXISTS "Report_projectId_idx" ON "Report"("projectId");
CREATE INDEX IF NOT EXISTS "Report_createdByUserId_idx" ON "Report"("createdByUserId");
CREATE INDEX IF NOT EXISTS "Report_status_idx" ON "Report"("status");
CREATE INDEX IF NOT EXISTS "Report_projectId_status_idx" ON "Report"("projectId", "status");
CREATE INDEX IF NOT EXISTS "Report_projectId_reportType_idx" ON "Report"("projectId", "reportType");
CREATE INDEX IF NOT EXISTS "Report_reportDate_idx" ON "Report"("reportDate");
CREATE INDEX IF NOT EXISTS "Report_zapsignDocToken_idx" ON "Report"("zapsignDocToken");
