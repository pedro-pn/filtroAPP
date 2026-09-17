ALTER TYPE "ProjectWorkflowStage" ADD VALUE 'FINAL_MEASUREMENT' AFTER 'POST_JOB';

CREATE TABLE "ProjectWorkflowMeasurement" (
  "projectId" TEXT NOT NULL,
  "quantitiesSummary" TEXT,
  "additionalServicesNote" TEXT,
  "evidenceNote" TEXT,
  "executedAmount" DECIMAL(14,2),
  "measuredAmount" DECIMAL(14,2),
  "approvedAmount" DECIMAL(14,2),
  "preparedAt" DATE,
  "sentAt" DATE,
  "approvedAt" DATE,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectWorkflowMeasurement_pkey" PRIMARY KEY ("projectId")
);

CREATE INDEX "ProjectWorkflowMeasurement_createdByUserId_idx" ON "ProjectWorkflowMeasurement"("createdByUserId");
CREATE INDEX "ProjectWorkflowMeasurement_updatedByUserId_idx" ON "ProjectWorkflowMeasurement"("updatedByUserId");

ALTER TABLE "ProjectWorkflowMeasurement"
  ADD CONSTRAINT "ProjectWorkflowMeasurement_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "ProjectWorkflow"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectWorkflowMeasurement"
  ADD CONSTRAINT "ProjectWorkflowMeasurement_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectWorkflowMeasurement"
  ADD CONSTRAINT "ProjectWorkflowMeasurement_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
