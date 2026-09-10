ALTER TYPE "ProjectWorkflowStage" ADD VALUE 'FINISHED' AFTER 'FINAL_MEASUREMENT';

ALTER TABLE "ProjectWorkflow"
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "closedByUserId" TEXT;

CREATE INDEX "ProjectWorkflow_closedByUserId_idx" ON "ProjectWorkflow"("closedByUserId");

ALTER TABLE "ProjectWorkflow"
  ADD CONSTRAINT "ProjectWorkflow_closedByUserId_fkey"
  FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
