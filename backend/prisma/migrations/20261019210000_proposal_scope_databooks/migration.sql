-- Preserva os Data Books existentes como documentos do projeto inteiro.
ALTER TABLE "ProjectDatabook" ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE "ProjectDatabook" ADD COLUMN "scopeSnapshot" JSONB;
DROP INDEX "ProjectDatabook_projectId_startDate_endDate_key";
CREATE UNIQUE INDEX "ProjectDatabook_projectId_startDate_endDate_scopeKey_key"
  ON "ProjectDatabook" ("projectId", "startDate", "endDate", "scopeKey");
-- Vínculos operacionais separados do conteúdo/PDF aprovado. O histórico fica no JSON.
ALTER TABLE "Report" ADD COLUMN "contributionAssignments" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "ProjectDatabookRevision" ADD COLUMN "scopeSnapshot" JSONB;
