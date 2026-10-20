CREATE TABLE "ReportClientAccess" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "versionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportClientAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportClientAccess_tokenHash_key" ON "ReportClientAccess"("tokenHash");
CREATE INDEX "ReportClientAccess_reportId_idx" ON "ReportClientAccess"("reportId");
CREATE INDEX "ReportClientAccess_expiresAt_idx" ON "ReportClientAccess"("expiresAt");
ALTER TABLE "ReportClientAccess" ADD CONSTRAINT "ReportClientAccess_reportId_fkey"
    FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
