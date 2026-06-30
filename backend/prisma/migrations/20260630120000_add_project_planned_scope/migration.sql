-- Escopo previsto do projeto: quantitativo de serviços vendidos + previsão de hora extra (manual)

-- CreateEnum
CREATE TYPE "PlannedMeasureUnit" AS ENUM ('M', 'KG', 'UN', 'L');

-- CreateTable
CREATE TABLE "ProjectPlannedService" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "tubingQty" DECIMAL(14,2),
    "tubingUnit" "PlannedMeasureUnit",
    "oilLiters" DECIMAL(14,2),
    "reservoirQty" DECIMAL(14,2),
    "reservoirUnit" "PlannedMeasureUnit",
    "note" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPlannedService_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectPlannedService_projectId_idx" ON "ProjectPlannedService"("projectId");

-- CreateTable
CREATE TABLE "ProjectPlannedOvertime" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobRoleId" TEXT,
    "roleName" TEXT,
    "collaboratorCount" INTEGER NOT NULL DEFAULT 1,
    "hours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPlannedOvertime_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectPlannedOvertime_projectId_idx" ON "ProjectPlannedOvertime"("projectId");
CREATE INDEX "ProjectPlannedOvertime_jobRoleId_idx" ON "ProjectPlannedOvertime"("jobRoleId");

-- AddForeignKey
ALTER TABLE "ProjectPlannedService" ADD CONSTRAINT "ProjectPlannedService_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPlannedOvertime" ADD CONSTRAINT "ProjectPlannedOvertime_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPlannedOvertime" ADD CONSTRAINT "ProjectPlannedOvertime_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
