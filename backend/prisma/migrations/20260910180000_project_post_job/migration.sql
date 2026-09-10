ALTER TYPE "ProjectWorkflowStage" ADD VALUE 'POST_JOB' AFTER 'DEMOBILIZATION';

CREATE TABLE "ProjectWorkflowPostJob" (
  "projectId" TEXT NOT NULL,
  "meetingDate" DATE,
  "fieldLeaderFeedback" TEXT,
  "teamFeedback" TEXT,
  "problemsFound" TEXT,
  "solutionsAdopted" TEXT,
  "improvementOpportunities" TEXT,
  "lessonsLearned" TEXT,
  "equipmentFeedback" TEXT,
  "planningFeedback" TEXT,
  "serviceTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "qualityRecordId" TEXT,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectWorkflowPostJob_pkey" PRIMARY KEY ("projectId")
);

CREATE UNIQUE INDEX "ProjectWorkflowPostJob_qualityRecordId_key" ON "ProjectWorkflowPostJob"("qualityRecordId");
CREATE INDEX "ProjectWorkflowPostJob_meetingDate_idx" ON "ProjectWorkflowPostJob"("meetingDate");
CREATE INDEX "ProjectWorkflowPostJob_createdByUserId_idx" ON "ProjectWorkflowPostJob"("createdByUserId");
CREATE INDEX "ProjectWorkflowPostJob_updatedByUserId_idx" ON "ProjectWorkflowPostJob"("updatedByUserId");

ALTER TABLE "ProjectWorkflowPostJob"
  ADD CONSTRAINT "ProjectWorkflowPostJob_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "ProjectWorkflow"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectWorkflowPostJob"
  ADD CONSTRAINT "ProjectWorkflowPostJob_qualityRecordId_fkey"
  FOREIGN KEY ("qualityRecordId") REFERENCES "QualityRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectWorkflowPostJob"
  ADD CONSTRAINT "ProjectWorkflowPostJob_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectWorkflowPostJob"
  ADD CONSTRAINT "ProjectWorkflowPostJob_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
