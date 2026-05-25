CREATE TABLE "DataRetentionRun" (
  "id" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'APPLY',
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "deleteAbandonedDrafts" BOOLEAN NOT NULL DEFAULT false,
  "cutoffs" JSONB,
  "summary" JSONB,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataRetentionRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataRetentionRun_status_startedAt_idx" ON "DataRetentionRun"("status", "startedAt");
CREATE INDEX "DataRetentionRun_startedAt_idx" ON "DataRetentionRun"("startedAt");
