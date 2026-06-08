CREATE INDEX CONCURRENTLY IF NOT EXISTS "EpiRecord_collaboratorId_lendDate_createdAt_idx"
ON "EpiRecord"("collaboratorId", "lendDate", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Romaneio_projectId_romaneioDate_createdAt_idx"
ON "Romaneio"("projectId", "romaneioDate", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "SatisfactionSurvey_sentAt_idx"
ON "SatisfactionSurvey"("sentAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "DataSubjectRequest_status_createdAt_idx"
ON "DataSubjectRequest"("status", "createdAt");
