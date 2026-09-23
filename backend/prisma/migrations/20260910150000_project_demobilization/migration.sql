ALTER TYPE "ProjectWorkflowStage" ADD VALUE 'DEMOBILIZATION' AFTER 'EXECUTION';

ALTER TABLE "ProjectWorkflow"
  ADD COLUMN "fieldCompletionDate" DATE;
