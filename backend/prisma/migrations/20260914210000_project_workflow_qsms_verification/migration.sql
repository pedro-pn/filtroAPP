ALTER TABLE "ProjectWorkflow"
ADD COLUMN "qsmsVerified" BOOLEAN,
ADD COLUMN "qsmsVerificationNote" TEXT;

-- Preserve the answer and any notes registered in the former QSMS checklists.
UPDATE "ProjectWorkflow" workflow
SET
  "qsmsVerified" = CASE
    WHEN legacy."status" IN ('DONE', 'NOT_APPLICABLE') THEN true
    ELSE NULL
  END,
  "qsmsVerificationNote" = NULLIF(COALESCE(
    legacy."note",
    (
      SELECT release."note"
      FROM "ProjectWorkflowChecklist" release
      WHERE release."projectId" = workflow."projectId"
        AND release."key" = 'D15_QSMS_RELEASE_CONFIRMED'
      LIMIT 1
    ),
    CASE legacy."status"
      WHEN 'DONE' THEN 'Requisitos de QSMS verificados no checklist anterior.'
      WHEN 'NOT_APPLICABLE' THEN 'Verificado como não aplicável no checklist anterior.'
      ELSE NULL
    END
  ), '')
FROM "ProjectWorkflowChecklist" legacy
WHERE legacy."projectId" = workflow."projectId"
  AND legacy."key" = 'D15_QSMS_REQUIREMENTS_CHECKED';
