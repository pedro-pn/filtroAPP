ALTER TABLE "ProjectBudget"
  ADD COLUMN "commercialAppProposalId" TEXT,
  ADD COLUMN "commercialAppRevision" INTEGER;

CREATE TABLE "CommercialAppProposal" (
  "id" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "proposalCode" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "projectId" TEXT NOT NULL,
  "nectarOpportunityId" TEXT,
  "approvedAt" TIMESTAMP(3) NOT NULL,
  "clientName" TEXT NOT NULL,
  "clientCnpj" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "site" TEXT NOT NULL,
  "salePrice" DECIMAL(14,2) NOT NULL,
  "plannedTotalCost" DECIMAL(14,2),
  "expectedMargin" DECIMAL(6,2),
  "snapshot" JSONB NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "selectionStatus" TEXT NOT NULL DEFAULT 'STAGED',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "selectedAt" TIMESTAMP(3),
  CONSTRAINT "CommercialAppProposal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommercialAppProposal_externalId_key" ON "CommercialAppProposal"("externalId");
CREATE UNIQUE INDEX "CommercialAppProposal_proposalCode_revisionNumber_key" ON "CommercialAppProposal"("proposalCode", "revisionNumber");
CREATE INDEX "CommercialAppProposal_projectId_selectionStatus_idx" ON "CommercialAppProposal"("projectId", "selectionStatus");
ALTER TABLE "CommercialAppProposal" ADD CONSTRAINT "CommercialAppProposal_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CommercialAppDelivery" (
  "eventId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "snapshotHash" TEXT NOT NULL,
  CONSTRAINT "CommercialAppDelivery_pkey" PRIMARY KEY ("eventId")
);
