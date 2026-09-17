ALTER TABLE "ProjectWorkflow"
ADD COLUMN "plannerUserId" TEXT;

UPDATE "ProjectWorkflow"
SET "plannerUserId" = "leaderUserId"
WHERE "plannerUserId" IS NULL;

ALTER TABLE "ProjectWorkflowEquipmentCategoryPlan"
ADD COLUMN "exceptionReasons" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "ProjectWorkflowEmailNotification" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "milestone" TEXT NOT NULL,
  "plannedMobilizationDate" DATE NOT NULL,
  "recipientUserId" TEXT,
  "recipientEmail" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectWorkflowEmailNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectWorkflow_plannerUserId_idx"
ON "ProjectWorkflow"("plannerUserId");

CREATE UNIQUE INDEX "ProjectWorkflowEmailNotification_projectId_milestone_plannedMobilizationDate_recipientEmail_key"
ON "ProjectWorkflowEmailNotification"("projectId", "milestone", "plannedMobilizationDate", "recipientEmail");

CREATE INDEX "ProjectWorkflowEmailNotification_status_lastAttemptAt_idx"
ON "ProjectWorkflowEmailNotification"("status", "lastAttemptAt");

CREATE INDEX "ProjectWorkflowEmailNotification_recipientUserId_idx"
ON "ProjectWorkflowEmailNotification"("recipientUserId");

ALTER TABLE "ProjectWorkflow"
ADD CONSTRAINT "ProjectWorkflow_plannerUserId_fkey"
FOREIGN KEY ("plannerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectWorkflowEmailNotification"
ADD CONSTRAINT "ProjectWorkflowEmailNotification_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "ProjectWorkflow"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectWorkflowEmailNotification"
ADD CONSTRAINT "ProjectWorkflowEmailNotification_recipientUserId_fkey"
FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
