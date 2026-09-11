-- Add the CRM dates and the operational client-contact record used during initial analysis.
ALTER TABLE "ProjectWorkflow"
ADD COLUMN "commercialExpectedMobilizationDate" DATE,
ADD COLUMN "analysisClientContactMade" BOOLEAN,
ADD COLUMN "analysisClientContactName" TEXT,
ADD COLUMN "analysisClientContactDate" DATE;

-- Preserve the answer from the former generic contact checklist for existing workflows.
UPDATE "ProjectWorkflow" AS workflow
SET "analysisClientContactMade" = CASE checklist."status"
  WHEN 'DONE' THEN TRUE
  WHEN 'NOT_APPLICABLE' THEN FALSE
  ELSE NULL
END
FROM "ProjectWorkflowChecklist" AS checklist
WHERE checklist."projectId" = workflow."projectId"
  AND checklist."key" = 'ANALYSIS_CLIENT_CONTACT';
