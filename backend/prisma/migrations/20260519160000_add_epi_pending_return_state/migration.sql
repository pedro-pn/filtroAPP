ALTER TABLE "EpiRecord"
  ADD COLUMN "pendingReturn" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "returnSourceRecordId" TEXT;

CREATE INDEX "EpiRecord_pendingReturn_idx" ON "EpiRecord"("pendingReturn");
CREATE INDEX "EpiRecord_returnSourceRecordId_idx" ON "EpiRecord"("returnSourceRecordId");
CREATE UNIQUE INDEX "EpiRecord_openReturnSourceRecordId_key"
  ON "EpiRecord"("returnSourceRecordId")
  WHERE "returnSourceRecordId" IS NOT NULL AND "archivedAt" IS NULL;
