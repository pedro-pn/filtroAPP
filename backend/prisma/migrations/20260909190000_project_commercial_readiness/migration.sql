ALTER TYPE "ModuleRoleCode" ADD VALUE IF NOT EXISTS 'EFETIVO_COMMERCIAL';

CREATE TYPE "ProjectWorkflowCommercialFactStatus" AS ENUM ('PENDING', 'CONFIRMED', 'NOT_APPLICABLE');
CREATE TYPE "ProjectWorkflowCommercialFactSource" AS ENUM ('MANUAL', 'CRM');

CREATE TABLE "ProjectWorkflowCommercialFact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" "ProjectWorkflowCommercialFactStatus" NOT NULL DEFAULT 'PENDING',
    "source" "ProjectWorkflowCommercialFactSource" NOT NULL DEFAULT 'MANUAL',
    "reference" TEXT,
    "note" TEXT,
    "occurredOn" DATE,
    "externalId" TEXT,
    "externalUrl" TEXT,
    "sourceVersion" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectWorkflowCommercialFact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectWorkflowCommercialFact_projectId_key_key" ON "ProjectWorkflowCommercialFact"("projectId", "key");
CREATE INDEX "ProjectWorkflowCommercialFact_projectId_status_idx" ON "ProjectWorkflowCommercialFact"("projectId", "status");
CREATE INDEX "ProjectWorkflowCommercialFact_source_idx" ON "ProjectWorkflowCommercialFact"("source");
CREATE INDEX "ProjectWorkflowCommercialFact_updatedByUserId_idx" ON "ProjectWorkflowCommercialFact"("updatedByUserId");

ALTER TABLE "ProjectWorkflowCommercialFact" ADD CONSTRAINT "ProjectWorkflowCommercialFact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectWorkflow"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowCommercialFact" ADD CONSTRAINT "ProjectWorkflowCommercialFact_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
