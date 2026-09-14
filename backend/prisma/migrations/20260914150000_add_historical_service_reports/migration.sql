CREATE TABLE "HistoricalServiceReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "items" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sourceFileName" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HistoricalServiceReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HistoricalServiceReport_projectId_reportType_sequenceNumber_key"
    ON "HistoricalServiceReport"("projectId", "reportType", "sequenceNumber");
CREATE INDEX "HistoricalServiceReport_projectId_reportDate_idx"
    ON "HistoricalServiceReport"("projectId", "reportDate");
ALTER TABLE "HistoricalServiceReport" ADD CONSTRAINT "HistoricalServiceReport_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
