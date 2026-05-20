WITH ranked_active_versions AS (
  SELECT
    rv."id",
    ROW_NUMBER() OVER (
      PARTITION BY rv."reportId"
      ORDER BY
        CASE
          WHEN rv."finalDocumentHash" IS NOT NULL
            AND rv."finalPdfUrl" IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM "ReportSignature" rs
              WHERE rs."versionId" = rv."id"
                AND rs."isRequired" = true
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "ReportSignature" rs
              WHERE rs."versionId" = rv."id"
                AND rs."isRequired" = true
                AND rs."status" <> 'SIGNED'
            )
            THEN 0
          WHEN rv."finalDocumentHash" IS NOT NULL
            AND rv."finalPdfUrl" IS NOT NULL
            THEN 1
          ELSE 2
        END,
        rv."versionNumber" DESC,
        rv."createdAt" DESC,
        rv."id" DESC
    ) AS rn
    FROM "ReportVersion" rv
    WHERE rv."status" = 'ACTIVE'
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
