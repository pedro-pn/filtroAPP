ALTER TYPE "ProjectWorkflowStage" ADD VALUE 'EXECUTION';

ALTER TABLE "ProjectWorkflow"
ADD COLUMN "executionReportTargets" JSONB NOT NULL DEFAULT '{}';
