CREATE TABLE "ProjectWorkflowTeamMemberCheck" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" "ProjectWorkflowChecklistStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceRecordId" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectWorkflowTeamMemberCheck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectWorkflowClientRelease" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "attendanceDate" DATE,
    "attendanceConfirmedAt" TIMESTAMP(3),
    "requested" BOOLEAN NOT NULL DEFAULT false,
    "requestedAt" DATE,
    "requestedTo" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" DATE,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceRecordId" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectWorkflowClientRelease_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectWorkflowTeamMemberCheck_projectId_collaboratorId_key_key"
ON "ProjectWorkflowTeamMemberCheck"("projectId", "collaboratorId", "key");

CREATE INDEX "ProjectWorkflowTeamMemberCheck_collaboratorId_idx"
ON "ProjectWorkflowTeamMemberCheck"("collaboratorId");

CREATE INDEX "ProjectWorkflowTeamMemberCheck_updatedByUserId_idx"
ON "ProjectWorkflowTeamMemberCheck"("updatedByUserId");

CREATE INDEX "ProjectWorkflowTeamMemberCheck_source_sourceUpdatedAt_idx"
ON "ProjectWorkflowTeamMemberCheck"("source", "sourceUpdatedAt");

CREATE UNIQUE INDEX "ProjectWorkflowClientRelease_projectId_key_key"
ON "ProjectWorkflowClientRelease"("projectId", "key");

CREATE INDEX "ProjectWorkflowClientRelease_updatedByUserId_idx"
ON "ProjectWorkflowClientRelease"("updatedByUserId");

CREATE INDEX "ProjectWorkflowClientRelease_source_sourceUpdatedAt_idx"
ON "ProjectWorkflowClientRelease"("source", "sourceUpdatedAt");

ALTER TABLE "ProjectWorkflowTeamMemberCheck"
ADD CONSTRAINT "ProjectWorkflowTeamMemberCheck_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "ProjectWorkflow"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectWorkflowTeamMemberCheck"
ADD CONSTRAINT "ProjectWorkflowTeamMemberCheck_collaboratorId_fkey"
FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectWorkflowTeamMemberCheck"
ADD CONSTRAINT "ProjectWorkflowTeamMemberCheck_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectWorkflowClientRelease"
ADD CONSTRAINT "ProjectWorkflowClientRelease_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "ProjectWorkflow"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectWorkflowClientRelease"
ADD CONSTRAINT "ProjectWorkflowClientRelease_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
