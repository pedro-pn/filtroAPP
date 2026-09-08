ALTER TABLE "QualityNature"
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

WITH ordered AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (ORDER BY "name" ASC, "createdAt" ASC) - 1 AS "nextPosition"
  FROM "QualityNature"
)
UPDATE "QualityNature"
SET "position" = ordered."nextPosition"
FROM ordered
WHERE "QualityNature"."id" = ordered."id";

DROP INDEX IF EXISTS "QualityNature_isActive_name_idx";

CREATE INDEX "QualityNature_isActive_position_name_idx" ON "QualityNature"("isActive", "position", "name");
CREATE INDEX "QualityNature_position_idx" ON "QualityNature"("position");
