BEGIN;

CREATE TABLE "QualitySubnature" (
    "id" TEXT NOT NULL,
    "natureId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QualitySubnature_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "QualityRecord" ADD COLUMN "subnatureId" TEXT;

-- Reset the old classification once, preserving every quality record and its evidence.
-- Include archived records because their foreign keys also reference the old catalog.
UPDATE "QualityRecord" SET "natureId" = NULL, "updatedAt" = CURRENT_TIMESTAMP
WHERE "natureId" IS NOT NULL;
DELETE FROM "QualityNature";

CREATE UNIQUE INDEX "QualitySubnature_natureId_name_key" ON "QualitySubnature"("natureId", "name");
CREATE INDEX "QualitySubnature_natureId_position_idx" ON "QualitySubnature"("natureId", "position");
CREATE INDEX "QualityRecord_subnatureId_idx" ON "QualityRecord"("subnatureId");

ALTER TABLE "QualitySubnature" ADD CONSTRAINT "QualitySubnature_natureId_fkey"
FOREIGN KEY ("natureId") REFERENCES "QualityNature"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QualityRecord" ADD CONSTRAINT "QualityRecord_subnatureId_fkey"
FOREIGN KEY ("subnatureId") REFERENCES "QualitySubnature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
