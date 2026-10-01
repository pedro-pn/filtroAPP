ALTER TABLE "Project"
  ADD COLUMN "proposalPercentage" DECIMAL(5,2) NOT NULL DEFAULT 100,
  ADD CONSTRAINT "Project_proposalPercentage_check"
    CHECK ("proposalPercentage" >= 0 AND "proposalPercentage" <= 100);
