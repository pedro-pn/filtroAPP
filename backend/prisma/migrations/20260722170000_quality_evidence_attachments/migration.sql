CREATE TYPE "QualityEvidenceKind" AS ENUM ('LINK', 'ATTACHMENT');

CREATE TABLE "QualityEvidence" (
  "id" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "kind" "QualityEvidenceKind" NOT NULL,
  "label" TEXT,
  "url" TEXT,
  "fileName" TEXT,
  "mimeType" TEXT,
  "storagePath" TEXT,
  "publicToken" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "QualityEvidence_pkey" PRIMARY KEY ("id")
);

INSERT INTO "QualityEvidence" ("id", "recordId", "kind", "label", "url", "position", "createdAt")
SELECT 'legacy-evidence-' || "id", "id", 'LINK'::"QualityEvidenceKind", 'Evidência', "evidence", 0, CURRENT_TIMESTAMP
FROM "QualityRecord"
WHERE "evidence" IS NOT NULL AND btrim("evidence") <> '';

CREATE UNIQUE INDEX "QualityEvidence_publicToken_key" ON "QualityEvidence"("publicToken");
CREATE INDEX "QualityEvidence_recordId_position_idx" ON "QualityEvidence"("recordId", "position");
CREATE INDEX "QualityEvidence_kind_idx" ON "QualityEvidence"("kind");
CREATE INDEX "QualityEvidence_storagePath_idx" ON "QualityEvidence"("storagePath");

ALTER TABLE "QualityEvidence"
  ADD CONSTRAINT "QualityEvidence_recordId_fkey"
  FOREIGN KEY ("recordId") REFERENCES "QualityRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
