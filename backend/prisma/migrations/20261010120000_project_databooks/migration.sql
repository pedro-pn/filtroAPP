-- Data Book: documento consolidado por intervalo do projeto e suas revisões (fila do worker).
CREATE TYPE "DatabookRevisionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "ProjectDatabook" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "docNumber" TEXT NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectDatabook_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectDatabook_docNumber_key" ON "ProjectDatabook"("docNumber");
CREATE UNIQUE INDEX "ProjectDatabook_projectId_sequence_key" ON "ProjectDatabook"("projectId", "sequence");
CREATE UNIQUE INDEX "ProjectDatabook_projectId_startDate_endDate_key" ON "ProjectDatabook"("projectId", "startDate", "endDate");
ALTER TABLE "ProjectDatabook" ADD CONSTRAINT "ProjectDatabook_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectDatabook" ADD CONSTRAINT "ProjectDatabook_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProjectDatabookRevision" (
  "id" TEXT NOT NULL,
  "databookId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "DatabookRevisionStatus" NOT NULL DEFAULT 'PENDING',
  "description" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "warnings" JSONB NOT NULL DEFAULT '[]',
  "pageCount" INTEGER,
  "storagePath" TEXT,
  "fileSize" INTEGER,
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectDatabookRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectDatabookRevision_databookId_revision_key" ON "ProjectDatabookRevision"("databookId", "revision");
CREATE INDEX "ProjectDatabookRevision_status_lockedAt_idx" ON "ProjectDatabookRevision"("status", "lockedAt");
ALTER TABLE "ProjectDatabookRevision" ADD CONSTRAINT "ProjectDatabookRevision_databookId_fkey"
  FOREIGN KEY ("databookId") REFERENCES "ProjectDatabook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectDatabookRevision" ADD CONSTRAINT "ProjectDatabookRevision_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FDS no cadastro de produtos químicos do Estoque (vínculo com o nome químico citado no RLQ).
ALTER TABLE "StockItem" ADD COLUMN "fdsSynonyms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "StockItem" ADD COLUMN "fdsCode" TEXT;
ALTER TABLE "StockItem" ADD COLUMN "fdsRevision" TEXT;
ALTER TABLE "StockItem" ADD COLUMN "fdsDate" DATE;
