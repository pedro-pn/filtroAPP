ALTER TYPE "ReportAuditAction" ADD VALUE 'PDF_ATTACHMENT_REORDERED';

ALTER TABLE "ReportPdfAttachment" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

WITH ordered AS (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "reportId" ORDER BY "createdAt", "id") - 1 AS position
    FROM "ReportPdfAttachment"
)
UPDATE "ReportPdfAttachment" AS attachment
SET "position" = ordered.position
FROM ordered WHERE attachment."id" = ordered."id";

ALTER TABLE "ReportPdfAttachment" ADD CONSTRAINT "ReportPdfAttachment_position_check" CHECK ("position" >= 0);
CREATE INDEX "ReportPdfAttachment_reportId_position_idx" ON "ReportPdfAttachment"("reportId", "position");
