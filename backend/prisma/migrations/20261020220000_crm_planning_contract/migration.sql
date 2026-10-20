-- Preserva os retratos do contrato inicial sem interpretá-los como a nova intenção.
ALTER TABLE "CrmOpportunity" DROP CONSTRAINT "CrmOpportunity_project_status_check";
DROP INDEX "CrmOpportunity_externalId_key";
DROP INDEX "CrmOpportunity_projectId_key";
DROP INDEX "CrmOpportunity_status_updatedAt_idx";
ALTER TABLE "CrmOpportunity" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "CrmOpportunity" RENAME COLUMN "status" TO "legacyStatus";
ALTER TABLE "CrmOpportunity" ALTER COLUMN "legacyStatus" DROP NOT NULL;
ALTER TABLE "CrmOpportunityEvent" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "CrmOpportunityEvent" RENAME COLUMN "status" TO "legacyStatus";
ALTER TABLE "CrmOpportunityEvent" ALTER COLUMN "legacyStatus" DROP NOT NULL;
DROP TYPE "CrmOpportunityStatus";
CREATE TYPE "CrmCommercialStatus" AS ENUM ('OPEN','WON','LOST','DISCARDED','CANCELLED','POSTPONED');

ALTER TABLE "CrmOpportunity"
  ALTER COLUMN "clientName" DROP NOT NULL,
  ALTER COLUMN "sourceVersion" TYPE BIGINT,
  ADD COLUMN "sourceSystem" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "contractVersion" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "commercialStatus" "CrmCommercialStatus",
  ADD COLUMN "planningRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sourceRecordDeleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "scopeKind" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
  ADD COLUMN "description" TEXT,
  ADD COLUMN "clientExternalId" TEXT,
  ADD COLUMN "proposalSystem" TEXT,
  ADD COLUMN "expectedEndDate" DATE,
  ADD COLUMN "snapshot" JSONB,
  ADD COLUMN "currentEventId" TEXT,
  ADD COLUMN "prismaMissionId" TEXT,
  ADD COLUMN "projectLinkStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "projectLinkReason" TEXT,
  ADD COLUMN "targetProjectId" TEXT,
  ADD CONSTRAINT "CrmOpportunity_targetProjectId_fkey" FOREIGN KEY ("targetProjectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "CrmOpportunity_namespace_external_key" ON "CrmOpportunity"("sourceSystem","tenantId","environment","externalId");
CREATE INDEX "CrmOpportunity_namespace_updated_idx" ON "CrmOpportunity"("sourceSystem","tenantId","environment","updatedAt","id");
CREATE INDEX "CrmOpportunity_namespace_mission_idx" ON "CrmOpportunity"("sourceSystem","tenantId","environment","prismaMissionId");
CREATE INDEX "CrmOpportunity_commercialStatus_planningRequested_idx" ON "CrmOpportunity"("commercialStatus","planningRequested");
CREATE INDEX "CrmOpportunity_projectId_idx" ON "CrmOpportunity"("projectId");
CREATE INDEX "CrmOpportunity_targetProjectId_idx" ON "CrmOpportunity"("targetProjectId");
ALTER TABLE "CrmOpportunityEvent" ALTER COLUMN "sourceVersion" TYPE BIGINT,
  ADD COLUMN "eventId" TEXT,
  ADD COLUMN "versionHash" TEXT,
  ADD COLUMN "applied" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CrmPlanningReceipt" (
  "id" TEXT PRIMARY KEY, "sourceSystem" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "environment" TEXT NOT NULL,
  "eventId" TEXT NOT NULL, "payloadHash" TEXT NOT NULL, "opportunityId" TEXT NOT NULL,
  "versionEventId" TEXT NOT NULL, "disposition" TEXT NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmPlanningReceipt_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CrmPlanningReceipt_versionEventId_fkey" FOREIGN KEY ("versionEventId") REFERENCES "CrmOpportunityEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CrmPlanningReceipt_namespace_event_key" ON "CrmPlanningReceipt"("sourceSystem","tenantId","environment","eventId");
CREATE INDEX "CrmPlanningReceipt_opportunityId_idx" ON "CrmPlanningReceipt"("opportunityId");

CREATE TABLE "CrmProjectMapping" (
  "id" TEXT PRIMARY KEY, "sourceSystem" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "environment" TEXT NOT NULL,
  "prismaMissionId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "number" TEXT, "numberScope" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmProjectMapping_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CrmProjectMapping_namespace_mission_key" ON "CrmProjectMapping"("sourceSystem","tenantId","environment","prismaMissionId");
CREATE UNIQUE INDEX "CrmProjectMapping_namespace_project_key" ON "CrmProjectMapping"("sourceSystem","tenantId","environment","projectId");

CREATE TABLE "CrmOpportunityLinkEvent" (
  "id" TEXT PRIMARY KEY, "opportunityId" TEXT NOT NULL, "sourceVersion" BIGINT NOT NULL,
  "fromStatus" TEXT, "toStatus" TEXT NOT NULL, "projectId" TEXT, "targetProjectId" TEXT, "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmOpportunityLinkEvent_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CrmOpportunityLinkEvent_opportunityId_createdAt_idx" ON "CrmOpportunityLinkEvent"("opportunityId","createdAt");
