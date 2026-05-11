-- Track closed-loop follow-up for detractor survey responses.
ALTER TABLE "SatisfactionSurvey"
  ADD COLUMN "followUpStatus" TEXT,
  ADD COLUMN "followUpNotes" TEXT,
  ADD COLUMN "followUpUpdatedAt" TIMESTAMP(3);
