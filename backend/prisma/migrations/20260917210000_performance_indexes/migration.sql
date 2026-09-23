CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

CREATE INDEX IF NOT EXISTS "PontoPeriodSummary_importId_collaboratorId_idx"
ON "PontoPeriodSummary"("importId", "collaboratorId");

CREATE INDEX IF NOT EXISTS "EfetivoMissionPlan_projectId_deletedAt_idx"
ON "EfetivoMissionPlan"("projectId", "deletedAt");

CREATE INDEX IF NOT EXISTS "ReportCollaborator_collaboratorId_idx"
ON "ReportCollaborator"("collaboratorId");

CREATE INDEX IF NOT EXISTS "ReportService_equipmentId_idx"
ON "ReportService"("equipmentId");

CREATE INDEX IF NOT EXISTS "ReportDraft_userId_updatedAt_idx"
ON "ReportDraft"("userId", "updatedAt");

CREATE INDEX IF NOT EXISTS "UserSession_userId_idx"
ON "UserSession"("userId");

CREATE INDEX IF NOT EXISTS "OmiePurchase_projectId_statusTitulo_idx"
ON "OmiePurchase"("projectId", "statusTitulo");

CREATE INDEX IF NOT EXISTS "OmieReceivable_projectId_codigoTipoDocumento_idx"
ON "OmieReceivable"("projectId", "codigoTipoDocumento");
