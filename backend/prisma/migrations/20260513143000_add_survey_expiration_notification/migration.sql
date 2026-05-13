ALTER TABLE "SatisfactionSurvey"
ADD COLUMN "expirationNotifiedAt" TIMESTAMP(3);

CREATE INDEX "SatisfactionSurvey_expirationNotifiedAt_expiresAt_idx"
ON "SatisfactionSurvey"("expirationNotifiedAt", "expiresAt");
