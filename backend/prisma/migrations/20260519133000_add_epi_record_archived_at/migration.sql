ALTER TABLE "EpiRecord" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "EpiRecord_archivedAt_idx" ON "EpiRecord"("archivedAt");
