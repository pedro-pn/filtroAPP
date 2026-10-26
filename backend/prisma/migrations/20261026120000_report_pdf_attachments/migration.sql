ALTER TYPE "ReportAuditAction" ADD VALUE 'PDF_ATTACHMENT_ADDED';
ALTER TYPE "ReportAuditAction" ADD VALUE 'PDF_ATTACHMENT_REMOVED';

CREATE TABLE "ReportPdfAttachment" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportPdfAttachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReportPdfAttachment_sizeBytes_check" CHECK ("sizeBytes" > 0),
    CONSTRAINT "ReportPdfAttachment_pageCount_check" CHECK ("pageCount" > 0)
);

CREATE UNIQUE INDEX "ReportPdfAttachment_storagePath_key" ON "ReportPdfAttachment"("storagePath");
CREATE INDEX "ReportPdfAttachment_reportId_createdAt_idx" ON "ReportPdfAttachment"("reportId", "createdAt");
ALTER TABLE "ReportPdfAttachment" ADD CONSTRAINT "ReportPdfAttachment_reportId_fkey"
    FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
