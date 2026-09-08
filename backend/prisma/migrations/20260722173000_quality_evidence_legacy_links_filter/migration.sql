DELETE FROM "QualityEvidence"
WHERE "kind" = 'LINK'
  AND "id" LIKE 'legacy-evidence-%'
  AND (
    "url" IS NULL
    OR btrim("url") = ''
    OR btrim("url") !~* '^https?://'
  );
