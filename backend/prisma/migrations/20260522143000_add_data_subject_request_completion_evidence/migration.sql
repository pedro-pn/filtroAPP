ALTER TABLE "DataSubjectRequest" ADD COLUMN "completedByUserId" TEXT;
ALTER TABLE "DataSubjectRequest" ADD COLUMN "completionNotes" TEXT;
ALTER TABLE "DataSubjectRequest" ADD COLUMN "responseEmailStatus" TEXT;
ALTER TABLE "DataSubjectRequest" ADD COLUMN "responseEmailSentAt" TIMESTAMP(3);
ALTER TABLE "DataSubjectRequest" ADD COLUMN "responseEmailError" TEXT;

CREATE INDEX "DataSubjectRequest_completedByUserId_idx" ON "DataSubjectRequest"("completedByUserId");

ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_completedByUserId_fkey"
  FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
