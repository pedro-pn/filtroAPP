ALTER TYPE "ProjectWorkflowDocumentationType" ADD VALUE 'QUALITY';

ALTER TABLE "ProjectWorkflow"
  ALTER COLUMN "plannedMobilizationDate" DROP NOT NULL,
  ADD COLUMN "isCritical" BOOLEAN,
  ADD COLUMN "preparationLeadTimeDays" INTEGER NOT NULL DEFAULT 15;

ALTER TABLE "ProjectWorkflow"
  ADD CONSTRAINT "ProjectWorkflow_preparationLeadTimeDays_check"
  CHECK ("preparationLeadTimeDays" >= 15);
