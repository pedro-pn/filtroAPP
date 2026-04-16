ALTER TYPE "ReportStatus" ADD VALUE 'SIGNED';

CREATE TYPE "ClientReviewAction" AS ENUM ('APPROVED', 'REJECTED');

CREATE TABLE "ClientReportReview" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "clientUserId" TEXT NOT NULL,
  "action" "ClientReviewAction" NOT NULL,
  "comment" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClientReportReview_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ClientReportReview"
ADD CONSTRAINT "ClientReportReview_reportId_fkey"
FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientReportReview"
ADD CONSTRAINT "ClientReportReview_clientUserId_fkey"
FOREIGN KEY ("clientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
