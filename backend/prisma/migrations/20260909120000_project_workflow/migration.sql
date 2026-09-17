CREATE TYPE "ProjectWorkflowStage" AS ENUM ('HANDOVER', 'INITIAL_ANALYSIS', 'WAITING_PLANNING', 'MOBILIZATION_PLANNING');
CREATE TYPE "ProjectWorkflowChecklistStatus" AS ENUM ('PENDING', 'DONE', 'NOT_APPLICABLE');
CREATE TYPE "ProjectWorkflowIssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');
CREATE TYPE "ProjectWorkflowCriticality" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

CREATE TABLE "ProjectWorkflow" (
    "projectId" TEXT NOT NULL,
    "stage" "ProjectWorkflowStage" NOT NULL DEFAULT 'HANDOVER',
    "leaderUserId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "plannedMobilizationDate" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectWorkflow_pkey" PRIMARY KEY ("projectId")
);

CREATE TABLE "ProjectWorkflowChecklist" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" "ProjectWorkflowChecklistStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectWorkflowChecklist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectWorkflowCriticalAnswer" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "answer" BOOLEAN NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectWorkflowCriticalAnswer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectWorkflowIssue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceQuestion" TEXT,
    "description" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "ownerName" TEXT,
    "requiredLeadTimeDays" INTEGER,
    "dueDate" DATE,
    "criticality" "ProjectWorkflowCriticality" NOT NULL DEFAULT 'HIGH',
    "status" "ProjectWorkflowIssueStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectWorkflowIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectWorkflowEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectWorkflowEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectWorkflow_stage_plannedMobilizationDate_idx" ON "ProjectWorkflow"("stage", "plannedMobilizationDate");
CREATE INDEX "ProjectWorkflow_leaderUserId_idx" ON "ProjectWorkflow"("leaderUserId");
CREATE UNIQUE INDEX "ProjectWorkflowChecklist_projectId_key_key" ON "ProjectWorkflowChecklist"("projectId", "key");
CREATE INDEX "ProjectWorkflowChecklist_updatedByUserId_idx" ON "ProjectWorkflowChecklist"("updatedByUserId");
CREATE UNIQUE INDEX "ProjectWorkflowCriticalAnswer_projectId_key_key" ON "ProjectWorkflowCriticalAnswer"("projectId", "key");
CREATE INDEX "ProjectWorkflowCriticalAnswer_updatedByUserId_idx" ON "ProjectWorkflowCriticalAnswer"("updatedByUserId");
CREATE UNIQUE INDEX "ProjectWorkflowIssue_projectId_sourceQuestion_key" ON "ProjectWorkflowIssue"("projectId", "sourceQuestion");
CREATE INDEX "ProjectWorkflowIssue_projectId_status_dueDate_idx" ON "ProjectWorkflowIssue"("projectId", "status", "dueDate");
CREATE INDEX "ProjectWorkflowEvent_projectId_createdAt_idx" ON "ProjectWorkflowEvent"("projectId", "createdAt");
CREATE INDEX "ProjectWorkflowEvent_actorUserId_idx" ON "ProjectWorkflowEvent"("actorUserId");

ALTER TABLE "ProjectWorkflow" ADD CONSTRAINT "ProjectWorkflow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflow" ADD CONSTRAINT "ProjectWorkflow_leaderUserId_fkey" FOREIGN KEY ("leaderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowChecklist" ADD CONSTRAINT "ProjectWorkflowChecklist_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectWorkflow"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowChecklist" ADD CONSTRAINT "ProjectWorkflowChecklist_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowCriticalAnswer" ADD CONSTRAINT "ProjectWorkflowCriticalAnswer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectWorkflow"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowCriticalAnswer" ADD CONSTRAINT "ProjectWorkflowCriticalAnswer_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowIssue" ADD CONSTRAINT "ProjectWorkflowIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectWorkflow"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowEvent" ADD CONSTRAINT "ProjectWorkflowEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectWorkflow"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowEvent" ADD CONSTRAINT "ProjectWorkflowEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
