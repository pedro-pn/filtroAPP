CREATE TABLE "ProjectManagementNote" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProjectManagementNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectManagementNote_projectId_createdAt_idx"
  ON "ProjectManagementNote"("projectId", "createdAt");

CREATE INDEX "ProjectManagementNote_createdByUserId_idx"
  ON "ProjectManagementNote"("createdByUserId");

ALTER TABLE "ProjectManagementNote"
  ADD CONSTRAINT "ProjectManagementNote_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectManagementNote"
  ADD CONSTRAINT "ProjectManagementNote_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
