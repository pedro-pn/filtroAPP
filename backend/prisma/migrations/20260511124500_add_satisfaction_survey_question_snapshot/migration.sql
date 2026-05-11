-- Store the exact question set used by each survey when it is created.
ALTER TABLE "SatisfactionSurvey" ADD COLUMN "questions" JSONB;
