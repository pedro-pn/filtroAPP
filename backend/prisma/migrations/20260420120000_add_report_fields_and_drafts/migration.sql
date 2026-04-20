ALTER TABLE "Report"
ADD COLUMN IF NOT EXISTS "sequenceNumber" INTEGER,
ADD COLUMN IF NOT EXISTS "daytimeWorkedMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "nighttimeWorkedMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "daytimeOvertimeMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "nighttimeOvertimeMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "totalOvertimeMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "pendingDerivedTypes" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "Report_projectId_reportType_sequenceNumber_key"
ON "Report"("projectId", "reportType", "sequenceNumber");

CREATE TABLE IF NOT EXISTS "ReportDraft" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT,
  "title" TEXT,
  "reportDate" TEXT,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReportDraft_userId_idx" ON "ReportDraft"("userId");
CREATE INDEX IF NOT EXISTS "ReportDraft_projectId_idx" ON "ReportDraft"("projectId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ReportDraft_userId_fkey'
  ) THEN
    ALTER TABLE "ReportDraft"
    ADD CONSTRAINT "ReportDraft_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ReportDraft_projectId_fkey'
  ) THEN
    ALTER TABLE "ReportDraft"
    ADD CONSTRAINT "ReportDraft_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
