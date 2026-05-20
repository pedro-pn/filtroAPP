WITH ranked_active_versions AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "reportId"
      ORDER BY "versionNumber" DESC, "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "ReportVersion"
  WHERE "status" = 'ACTIVE'
)
UPDATE "ReportVersion"
SET "status" = 'SUPERSEDED'
WHERE "id" IN (
  SELECT "id"
  FROM ranked_active_versions
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReportVersion_one_active_per_report_idx"
ON "ReportVersion"("reportId")
WHERE "status" = 'ACTIVE';
