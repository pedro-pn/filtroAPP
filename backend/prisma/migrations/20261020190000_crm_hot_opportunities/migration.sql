CREATE TYPE "CrmOpportunityStatus" AS ENUM ('HOT', 'WITHDRAWN', 'LOST', 'CANCELLED', 'WON');

CREATE TABLE "CrmOpportunity" (
  "id" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "status" "CrmOpportunityStatus" NOT NULL,
  "name" TEXT NOT NULL,
  "clientName" TEXT NOT NULL,
  "clientCnpj" TEXT,
  "location" TEXT,
  "proposalCode" TEXT,
  "revision" INTEGER,
  "estimatedValue" DECIMAL(14,2),
  "expectedCloseDate" DATE,
  "expectedStartDate" DATE,
  "externalUrl" TEXT,
  "sourceVersion" INTEGER NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "convertedAt" TIMESTAMP(3),
  "projectId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmOpportunity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CrmOpportunity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CrmOpportunity_sourceVersion_check" CHECK ("sourceVersion" > 0),
  CONSTRAINT "CrmOpportunity_project_status_check" CHECK (("status" = 'WON') = ("projectId" IS NOT NULL)),
  CONSTRAINT "CrmOpportunity_estimatedValue_check" CHECK ("estimatedValue" IS NULL OR "estimatedValue" >= 0)
);
CREATE UNIQUE INDEX "CrmOpportunity_externalId_key" ON "CrmOpportunity"("externalId");
CREATE UNIQUE INDEX "CrmOpportunity_projectId_key" ON "CrmOpportunity"("projectId");
CREATE INDEX "CrmOpportunity_status_updatedAt_idx" ON "CrmOpportunity"("status", "updatedAt");

CREATE TABLE "CrmOpportunityEvent" (
  "id" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "status" "CrmOpportunityStatus" NOT NULL,
  "snapshot" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmOpportunityEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CrmOpportunityEvent_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CrmOpportunityEvent_opportunityId_sourceVersion_key" ON "CrmOpportunityEvent"("opportunityId", "sourceVersion");
