ALTER TABLE "ClientReportReview"
DROP CONSTRAINT IF EXISTS "ClientReportReview_clientUserId_fkey";

ALTER TABLE "ClientReportReview"
ALTER COLUMN "clientUserId" DROP NOT NULL;

ALTER TABLE "ClientReportReview"
ADD CONSTRAINT "ClientReportReview_clientUserId_fkey"
FOREIGN KEY ("clientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
