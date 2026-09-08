-- CreateEnum
CREATE TYPE "EfetivoPlanKind" AS ENUM ('OFFICIAL', 'SCENARIO');
CREATE TYPE "EfetivoPlanStatus" AS ENUM ('ACTIVE', 'DRAFT', 'APPLIED', 'DISCARDED', 'SUPERSEDED');
CREATE TYPE "EfetivoMissionScheduleStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');
CREATE TYPE "EfetivoMissionStage" AS ENUM ('STANDBY', 'MOBILIZATION', 'EXECUTION', 'FINAL_MEASUREMENT', 'FINISHED');
CREATE TYPE "EfetivoAllocationSource" AS ENUM ('MANUAL', 'AUTOMATIC', 'SCENARIO_COPY');

-- AlterTable
ALTER TABLE "Collaborator"
  ADD COLUMN "jobRoleId" TEXT,
  ADD COLUMN "efetivoNote" TEXT;

ALTER TABLE "JobRole"
  ADD COLUMN "calendarColor" TEXT NOT NULL DEFAULT '#64748B',
  ADD COLUMN "continuousWorkLimitDays" INTEGER;

-- CreateTable
CREATE TABLE "EfetivoPlan" (
  "id" TEXT NOT NULL,
  "kind" "EfetivoPlanKind" NOT NULL,
  "status" "EfetivoPlanStatus" NOT NULL,
  "name" TEXT NOT NULL,
  "objective" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "basePlanId" TEXT,
  "baseOfficialRevision" INTEGER,
  "appliedPlanId" TEXT,
  "createdByUserId" TEXT,
  "appliedByUserId" TEXT,
  "appliedAt" TIMESTAMP(3),
  "discardedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EfetivoPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EfetivoMissionPlan" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "scheduleStatus" "EfetivoMissionScheduleStatus" NOT NULL DEFAULT 'DRAFT',
  "stage" "EfetivoMissionStage" NOT NULL DEFAULT 'STANDBY',
  "headquartersResponsibleName" TEXT NOT NULL,
  "headquartersResponsibleRole" TEXT NOT NULL,
  "headquartersResponsibleCollaboratorId" TEXT,
  "mobilizationDate" DATE NOT NULL,
  "executionStartDate" DATE NOT NULL,
  "executionEndDate" DATE NOT NULL,
  "returnDate" DATE NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "kanbanOrder" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EfetivoMissionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EfetivoMissionDemand" (
  "id" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "jobRoleId" TEXT NOT NULL,
  "requiredCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EfetivoMissionDemand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EfetivoMissionAllocation" (
  "id" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "collaboratorId" TEXT NOT NULL,
  "jobRoleId" TEXT NOT NULL,
  "jobRoleNameSnapshot" TEXT NOT NULL,
  "source" "EfetivoAllocationSource" NOT NULL DEFAULT 'MANUAL',
  "createdByUserId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EfetivoMissionAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EfetivoPlannedHire" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "jobRoleId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "availableFrom" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EfetivoPlannedHire_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EfetivoHoliday" (
  "id" TEXT NOT NULL,
  "holidayDate" DATE NOT NULL,
  "name" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EfetivoHoliday_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EfetivoAuditEvent" (
  "id" TEXT NOT NULL,
  "planId" TEXT,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EfetivoAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Collaborator_jobRoleId_idx" ON "Collaborator"("jobRoleId");
CREATE INDEX "CollaboratorAbsence_collaboratorId_deletedAt_startDate_endDate_idx" ON "CollaboratorAbsence"("collaboratorId", "deletedAt", "startDate", "endDate");
CREATE INDEX "EfetivoPlan_kind_status_idx" ON "EfetivoPlan"("kind", "status");
CREATE INDEX "EfetivoPlan_basePlanId_idx" ON "EfetivoPlan"("basePlanId");
CREATE INDEX "EfetivoPlan_createdAt_idx" ON "EfetivoPlan"("createdAt");
CREATE UNIQUE INDEX "EfetivoPlan_single_active_official_idx" ON "EfetivoPlan"("kind") WHERE "kind" = 'OFFICIAL' AND "status" = 'ACTIVE';
CREATE UNIQUE INDEX "EfetivoMissionPlan_planId_projectId_key" ON "EfetivoMissionPlan"("planId", "projectId");
CREATE INDEX "EfetivoMissionPlan_planId_scheduleStatus_mobilizationDate_returnDate_idx" ON "EfetivoMissionPlan"("planId", "scheduleStatus", "mobilizationDate", "returnDate");
CREATE INDEX "EfetivoMissionPlan_planId_stage_kanbanOrder_idx" ON "EfetivoMissionPlan"("planId", "stage", "kanbanOrder");
CREATE INDEX "EfetivoMissionPlan_planId_deletedAt_idx" ON "EfetivoMissionPlan"("planId", "deletedAt");
CREATE INDEX "EfetivoMissionPlan_headquartersResponsibleCollaboratorId_idx" ON "EfetivoMissionPlan"("headquartersResponsibleCollaboratorId");
CREATE UNIQUE INDEX "EfetivoMissionDemand_missionId_jobRoleId_key" ON "EfetivoMissionDemand"("missionId", "jobRoleId");
CREATE INDEX "EfetivoMissionDemand_jobRoleId_idx" ON "EfetivoMissionDemand"("jobRoleId");
CREATE UNIQUE INDEX "EfetivoMissionAllocation_missionId_collaboratorId_key" ON "EfetivoMissionAllocation"("missionId", "collaboratorId");
CREATE INDEX "EfetivoMissionAllocation_collaboratorId_deletedAt_idx" ON "EfetivoMissionAllocation"("collaboratorId", "deletedAt");
CREATE INDEX "EfetivoMissionAllocation_missionId_jobRoleId_deletedAt_idx" ON "EfetivoMissionAllocation"("missionId", "jobRoleId", "deletedAt");
CREATE UNIQUE INDEX "EfetivoPlannedHire_planId_jobRoleId_availableFrom_key" ON "EfetivoPlannedHire"("planId", "jobRoleId", "availableFrom");
CREATE INDEX "EfetivoPlannedHire_jobRoleId_availableFrom_idx" ON "EfetivoPlannedHire"("jobRoleId", "availableFrom");
CREATE UNIQUE INDEX "EfetivoHoliday_holidayDate_key" ON "EfetivoHoliday"("holidayDate");
CREATE INDEX "EfetivoHoliday_deletedAt_holidayDate_idx" ON "EfetivoHoliday"("deletedAt", "holidayDate");
CREATE INDEX "EfetivoAuditEvent_createdAt_idx" ON "EfetivoAuditEvent"("createdAt");
CREATE INDEX "EfetivoAuditEvent_entityType_entityId_createdAt_idx" ON "EfetivoAuditEvent"("entityType", "entityId", "createdAt");
CREATE INDEX "EfetivoAuditEvent_actorUserId_createdAt_idx" ON "EfetivoAuditEvent"("actorUserId", "createdAt");
CREATE INDEX "EfetivoAuditEvent_planId_createdAt_idx" ON "EfetivoAuditEvent"("planId", "createdAt");

-- AddForeignKey
ALTER TABLE "Collaborator" ADD CONSTRAINT "Collaborator_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EfetivoPlan" ADD CONSTRAINT "EfetivoPlan_basePlanId_fkey" FOREIGN KEY ("basePlanId") REFERENCES "EfetivoPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EfetivoPlan" ADD CONSTRAINT "EfetivoPlan_appliedPlanId_fkey" FOREIGN KEY ("appliedPlanId") REFERENCES "EfetivoPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EfetivoMissionPlan" ADD CONSTRAINT "EfetivoMissionPlan_planId_fkey" FOREIGN KEY ("planId") REFERENCES "EfetivoPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EfetivoMissionPlan" ADD CONSTRAINT "EfetivoMissionPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EfetivoMissionPlan" ADD CONSTRAINT "EfetivoMissionPlan_headquartersResponsibleCollaboratorId_fkey" FOREIGN KEY ("headquartersResponsibleCollaboratorId") REFERENCES "Collaborator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EfetivoMissionDemand" ADD CONSTRAINT "EfetivoMissionDemand_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "EfetivoMissionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EfetivoMissionDemand" ADD CONSTRAINT "EfetivoMissionDemand_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EfetivoMissionAllocation" ADD CONSTRAINT "EfetivoMissionAllocation_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "EfetivoMissionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EfetivoMissionAllocation" ADD CONSTRAINT "EfetivoMissionAllocation_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EfetivoMissionAllocation" ADD CONSTRAINT "EfetivoMissionAllocation_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EfetivoPlannedHire" ADD CONSTRAINT "EfetivoPlannedHire_planId_fkey" FOREIGN KEY ("planId") REFERENCES "EfetivoPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EfetivoPlannedHire" ADD CONSTRAINT "EfetivoPlannedHire_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EfetivoAuditEvent" ADD CONSTRAINT "EfetivoAuditEvent_planId_fkey" FOREIGN KEY ("planId") REFERENCES "EfetivoPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill only unequivocal normalized names (trim + lower); ambiguous names remain null.
WITH unique_roles AS (
  SELECT lower(trim("name")) AS normalized_name, min("id") AS id
  FROM "JobRole"
  GROUP BY lower(trim("name"))
  HAVING count(*) = 1
)
UPDATE "Collaborator" collaborator
SET "jobRoleId" = unique_roles.id
FROM unique_roles
WHERE collaborator."jobRoleId" IS NULL
  AND lower(trim(collaborator."role")) = unique_roles.normalized_name;

INSERT INTO "EfetivoSetting" ("key", "numberValue", "updatedAt")
VALUES ('plannedUtilizationTarget', 80, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
