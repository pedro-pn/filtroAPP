-- Generalize successful point snapshots and add stable external identity fields.
ALTER TABLE "PontoImport"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'XLSX';

ALTER TABLE "PontoPeriodSummary"
  ADD COLUMN "sourceKey" TEXT,
  ADD COLUMN "externalEmployeeId" TEXT,
  ADD COLUMN "registrationNumber" TEXT;

DROP INDEX "PontoPeriodSummary_importId_normalizedName_key";
CREATE UNIQUE INDEX "PontoPeriodSummary_importId_sourceKey_key"
  ON "PontoPeriodSummary"("importId", "sourceKey");

CREATE TABLE "PontoSyncRun" (
  "id" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "requestedByUserId" TEXT,
  "importId" TEXT,
  "employeesRead" INTEGER NOT NULL DEFAULT 0,
  "workDaysRead" INTEGER NOT NULL DEFAULT 0,
  "timeCardsRead" INTEGER NOT NULL DEFAULT 0,
  "collaboratorsMatched" INTEGER NOT NULL DEFAULT 0,
  "pendingCount" INTEGER NOT NULL DEFAULT 0,
  "summary" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "PontoSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PontoSyncRun_status_startedAt_idx" ON "PontoSyncRun"("status", "startedAt");
CREATE INDEX "PontoSyncRun_importId_idx" ON "PontoSyncRun"("importId");
ALTER TABLE "PontoSyncRun" ADD CONSTRAINT "PontoSyncRun_importId_fkey"
  FOREIGN KEY ("importId") REFERENCES "PontoImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PontoExternalEmployeeLink" (
  "id" TEXT NOT NULL,
  "externalEmployeeId" TEXT NOT NULL,
  "registrationNumber" TEXT,
  "externalName" TEXT NOT NULL,
  "collaboratorId" TEXT NOT NULL,
  "matchSource" TEXT NOT NULL DEFAULT 'MANUAL',
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PontoExternalEmployeeLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PontoExternalEmployeeLink_externalEmployeeId_key"
  ON "PontoExternalEmployeeLink"("externalEmployeeId");
CREATE INDEX "PontoExternalEmployeeLink_collaboratorId_idx"
  ON "PontoExternalEmployeeLink"("collaboratorId");
ALTER TABLE "PontoExternalEmployeeLink" ADD CONSTRAINT "PontoExternalEmployeeLink_collaboratorId_fkey"
  FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PontoProjectTagAlias" (
  "id" TEXT NOT NULL,
  "normalizedTag" TEXT NOT NULL,
  "rawTag" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PontoProjectTagAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PontoProjectTagAlias_normalizedTag_key"
  ON "PontoProjectTagAlias"("normalizedTag");
CREATE INDEX "PontoProjectTagAlias_projectId_idx"
  ON "PontoProjectTagAlias"("projectId");
ALTER TABLE "PontoProjectTagAlias" ADD CONSTRAINT "PontoProjectTagAlias_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
