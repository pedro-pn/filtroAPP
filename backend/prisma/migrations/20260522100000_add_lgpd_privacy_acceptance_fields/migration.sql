ALTER TABLE "ReportSignature"
  ADD COLUMN "privacyNoticeAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "privacyNoticeVersion" TEXT;

ALTER TABLE "EpiSignatureRequest"
  ADD COLUMN "privacyNoticeAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "privacyNoticeVersion" TEXT;

ALTER TABLE "SatisfactionSurvey"
  ADD COLUMN "privacyNoticeAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "privacyNoticeVersion" TEXT;
