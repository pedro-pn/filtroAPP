-- A participação passa a ser escolhida na administração do Efetivo.
-- Novos cadastros não entram na conferência sem essa escolha.
ALTER TABLE "Collaborator" ALTER COLUMN "allocationReviewEnabled" SET DEFAULT false;

-- Corrige o antigo "Sim" para pessoas que já estavam fora da conferência.
-- Preserva inclusões operacionais existentes e todas as dispensas individuais.
UPDATE "Collaborator" AS c
SET "allocationReviewEnabled" = false,
    "classificationVersion" = c."classificationVersion" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "JobRole" AS j
WHERE c."jobRoleId" = j."id"
  AND c."allocationReviewEnabled" = true
  AND (
    COALESCE(c."workforceClassificationOverride"::text, j."workforceClassification"::text,
      CASE WHEN j."isOperational" THEN 'OPERATIONAL' ELSE 'NON_OPERATIONAL' END) <> 'OPERATIONAL'
    OR NOT COALESCE((
      SELECT (s."textValue"::jsonb -> 'ALLOCATION_REVIEW') @> '["OPERATIONAL"]'::jsonb
      FROM "EfetivoSetting" AS s WHERE s."key" = 'workforce.visibility.v1'
    ), true)
  );
