CREATE TABLE "ReportApprovalPostProcessingJob" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "approvedTransition" BOOLEAN NOT NULL DEFAULT false,
  "wasClientRejection" BOOLEAN NOT NULL DEFAULT false,
  "reviewedByUserId" TEXT,
  "evidence" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReportApprovalPostProcessingJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportApprovalPostProcessingJob_reportId_key" ON "ReportApprovalPostProcessingJob"("reportId");
CREATE INDEX "ReportApprovalPostProcessingJob_status_lockedAt_idx" ON "ReportApprovalPostProcessingJob"("status", "lockedAt");
CREATE INDEX "ReportApprovalPostProcessingJob_createdAt_idx" ON "ReportApprovalPostProcessingJob"("createdAt");

ALTER TABLE "ReportApprovalPostProcessingJob"
  ADD CONSTRAINT "ReportApprovalPostProcessingJob_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
