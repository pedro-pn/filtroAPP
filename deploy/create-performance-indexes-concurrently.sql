-- Rode este arquivo em produção antes de `npx prisma migrate deploy` quando
-- as migrations de performance ainda não tiverem sido aplicadas.
--
-- Importante: execute com psql, via -f ou stdin, fora de BEGIN/COMMIT.
-- O PostgreSQL não permite CREATE INDEX CONCURRENTLY dentro de uma transação.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ClientReportReview_reportId_createdAt_idx"
ON "ClientReportReview"("reportId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReportService_reportId_idx"
ON "ReportService"("reportId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReportAttachment_reportId_idx"
ON "ReportAttachment"("reportId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReportAttachment_reportServiceId_idx"
ON "ReportAttachment"("reportServiceId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "EpiRecord_collaboratorId_lendDate_createdAt_idx"
ON "EpiRecord"("collaboratorId", "lendDate", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Romaneio_projectId_romaneioDate_createdAt_idx"
ON "Romaneio"("projectId", "romaneioDate", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "SatisfactionSurvey_sentAt_idx"
ON "SatisfactionSurvey"("sentAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "DataSubjectRequest_status_createdAt_idx"
ON "DataSubjectRequest"("status", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Report_active_date_created_idx"
ON "Report"("reportDate" DESC, "createdAt" DESC)
WHERE "deletedAt" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Report_active_project_date_created_idx"
ON "Report"("projectId", "reportDate" DESC, "createdAt" DESC)
WHERE "deletedAt" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "PontoPeriodSummary_importId_collaboratorId_idx"
ON "PontoPeriodSummary"("importId", "collaboratorId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "EfetivoMissionPlan_projectId_deletedAt_idx"
ON "EfetivoMissionPlan"("projectId", "deletedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReportCollaborator_collaboratorId_idx"
ON "ReportCollaborator"("collaboratorId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReportService_equipmentId_idx"
ON "ReportService"("equipmentId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReportDraft_userId_updatedAt_idx"
ON "ReportDraft"("userId", "updatedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserSession_userId_idx"
ON "UserSession"("userId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "OmiePurchase_projectId_statusTitulo_idx"
ON "OmiePurchase"("projectId", "statusTitulo");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "OmieReceivable_projectId_codigoTipoDocumento_idx"
ON "OmieReceivable"("projectId", "codigoTipoDocumento");
