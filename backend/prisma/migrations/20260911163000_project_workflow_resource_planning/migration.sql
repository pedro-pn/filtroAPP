ALTER TABLE "ProjectWorkflow"
ADD COLUMN "teamPlanDefined" BOOLEAN,
ADD COLUMN "equipmentPlanDefined" BOOLEAN;

CREATE TABLE "ProjectWorkflowTeamDemand" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobRoleId" TEXT NOT NULL,
    "requiredCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectWorkflowTeamDemand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectWorkflowEquipmentCategoryPlan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectWorkflowEquipmentCategoryPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectWorkflowTeamDemand_projectId_jobRoleId_key" ON "ProjectWorkflowTeamDemand"("projectId", "jobRoleId");
CREATE INDEX "ProjectWorkflowTeamDemand_jobRoleId_idx" ON "ProjectWorkflowTeamDemand"("jobRoleId");
CREATE UNIQUE INDEX "ProjectWorkflowEquipmentCategoryPlan_projectId_categoryId_key" ON "ProjectWorkflowEquipmentCategoryPlan"("projectId", "categoryId");
CREATE INDEX "ProjectWorkflowEquipmentCategoryPlan_categoryId_idx" ON "ProjectWorkflowEquipmentCategoryPlan"("categoryId");

ALTER TABLE "ProjectWorkflowTeamDemand" ADD CONSTRAINT "ProjectWorkflowTeamDemand_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectWorkflow"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowTeamDemand" ADD CONSTRAINT "ProjectWorkflowTeamDemand_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowEquipmentCategoryPlan" ADD CONSTRAINT "ProjectWorkflowEquipmentCategoryPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectWorkflow"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowEquipmentCategoryPlan" ADD CONSTRAINT "ProjectWorkflowEquipmentCategoryPlan_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EquipmentCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
