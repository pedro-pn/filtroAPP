ALTER TABLE "ProjectWorkflow"
ADD COLUMN "supplyPlanDefined" BOOLEAN,
ADD COLUMN "supplyPlan" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "logisticsPlan" JSONB NOT NULL DEFAULT '{}';
