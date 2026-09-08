ALTER TABLE "QualityRecord"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT;

CREATE INDEX "QualityRecord_deletedAt_idx" ON "QualityRecord"("deletedAt");
CREATE INDEX "QualityRecord_deletedById_idx" ON "QualityRecord"("deletedById");
CREATE INDEX "QualityRecord_projectId_type_deletedAt_idx" ON "QualityRecord"("projectId", "type", "deletedAt");
CREATE INDEX "QualityRecord_natureId_eventDate_deletedAt_idx" ON "QualityRecord"("natureId", "eventDate", "deletedAt");

ALTER TABLE "QualityRecord" ADD CONSTRAINT "QualityRecord_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
