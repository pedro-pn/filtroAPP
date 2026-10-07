ALTER TABLE "Project"
  ADD COLUMN "commercialProposalSync" JSONB,
  ADD COLUMN "commercialProposalSyncNextAttemptAt" TIMESTAMP(3);

CREATE INDEX "Project_commercialProposalSyncNextAttemptAt_idx"
  ON "Project"("commercialProposalSyncNextAttemptAt");
