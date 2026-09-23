ALTER TYPE "ModuleRoleCode" ADD VALUE IF NOT EXISTS 'EFETIVO_QSMS';
ALTER TYPE "ProjectWorkflowStage" ADD VALUE IF NOT EXISTS 'PREPARATION';
ALTER TYPE "ProjectWorkflowStage" ADD VALUE IF NOT EXISTS 'READY_TO_MOBILIZE';

ALTER TABLE "ProjectWorkflow"
  ADD COLUMN "mobilizationAuthorizedAt" TIMESTAMP(3),
  ADD COLUMN "mobilizationAuthorizationVersion" INTEGER;
