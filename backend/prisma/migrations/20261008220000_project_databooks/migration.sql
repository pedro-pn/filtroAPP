CREATE TABLE "ProjectDatabook" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "familyId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL, "title" TEXT NOT NULL,
  "startDate" DATE NOT NULL, "endDate" DATE NOT NULL,
  "options" JSONB NOT NULL, "snapshot" JSONB NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL, "createdByName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "progress" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0, "lockedAt" TIMESTAMP(3), "leaseToken" TEXT,
  "error" TEXT, "pdfPath" TEXT, "zipPath" TEXT, "pdfSha256" TEXT, "zipSha256" TEXT,
  "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectDatabook_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectDatabook_period_check" CHECK ("startDate" <= "endDate"),
  CONSTRAINT "ProjectDatabook_progress_check" CHECK ("progress" BETWEEN 0 AND 100),
  CONSTRAINT "ProjectDatabook_status_check" CHECK ("status" IN ('PENDING', 'RUNNING', 'FAILED', 'COMPLETED')),
  CONSTRAINT "ProjectDatabook_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectDatabook_familyId_revision_key" ON "ProjectDatabook"("familyId", "revision");
CREATE INDEX "ProjectDatabook_projectId_createdAt_idx" ON "ProjectDatabook"("projectId", "createdAt");
CREATE INDEX "ProjectDatabook_status_lockedAt_idx" ON "ProjectDatabook"("status", "lockedAt");
