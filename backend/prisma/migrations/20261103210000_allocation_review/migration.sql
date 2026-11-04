-- CreateEnum
CREATE TYPE "AllocationReviewKind" AS ENUM ('PROJECT', 'TRAVEL', 'SEDE', 'FOLGA', 'FERIAS', 'AFASTAMENTO', 'TREINAMENTO');

-- CreateEnum
CREATE TYPE "AllocationReviewWeekStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AllocationReviewEventType" AS ENUM ('CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "AllocationReviewAlertStatus" AS ENUM ('OPEN', 'RESOLVED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ModuleRoleCode" ADD VALUE IF NOT EXISTS 'EFETIVO_ALLOCATION_REVIEW';

-- CreateTable
CREATE TABLE "AllocationReviewWeek" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" "AllocationReviewWeekStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationReviewWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationReviewWeekEvent" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "type" "AllocationReviewEventType" NOT NULL,
    "actorUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllocationReviewWeekEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationReviewRow" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationReviewRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationReviewDay" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "kind" "AllocationReviewKind" NOT NULL,
    "note" TEXT,
    "differsFromSuggestion" BOOLEAN NOT NULL DEFAULT false,
    "suggestionSnapshot" JSONB,
    "sourceFingerprint" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationReviewDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationReviewDayProject" (
    "dayId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "AllocationReviewDayProject_pkey" PRIMARY KEY ("dayId","projectId")
);

-- CreateTable
CREATE TABLE "AllocationReviewAbsenceAlert" (
    "id" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,
    "absenceType" "CollaboratorAbsenceType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "AllocationReviewAlertStatus" NOT NULL DEFAULT 'OPEN',
    "sourceWeekId" TEXT NOT NULL,
    "notificationEventId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAbsenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationReviewAbsenceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AllocationReviewWeek_weekStart_key" ON "AllocationReviewWeek"("weekStart");

-- CreateIndex
CREATE INDEX "AllocationReviewWeek_status_weekStart_idx" ON "AllocationReviewWeek"("status", "weekStart");

-- CreateIndex
CREATE INDEX "AllocationReviewWeekEvent_weekId_createdAt_idx" ON "AllocationReviewWeekEvent"("weekId", "createdAt");

-- CreateIndex
CREATE INDEX "AllocationReviewRow_collaboratorId_idx" ON "AllocationReviewRow"("collaboratorId");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationReviewRow_weekId_collaboratorId_key" ON "AllocationReviewRow"("weekId", "collaboratorId");

-- CreateIndex
CREATE INDEX "AllocationReviewDay_workDate_idx" ON "AllocationReviewDay"("workDate");

-- CreateIndex
CREATE INDEX "AllocationReviewDay_rowId_idx" ON "AllocationReviewDay"("rowId");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationReviewDay_collaboratorId_workDate_key" ON "AllocationReviewDay"("collaboratorId", "workDate");

-- CreateIndex
CREATE INDEX "AllocationReviewDayProject_projectId_idx" ON "AllocationReviewDayProject"("projectId");

-- CreateIndex
CREATE INDEX "AllocationReviewAbsenceAlert_status_collaboratorId_idx" ON "AllocationReviewAbsenceAlert"("status", "collaboratorId");

-- CreateIndex
CREATE INDEX "AllocationReviewAbsenceAlert_sourceWeekId_idx" ON "AllocationReviewAbsenceAlert"("sourceWeekId");

-- AddForeignKey
ALTER TABLE "AllocationReviewWeekEvent" ADD CONSTRAINT "AllocationReviewWeekEvent_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "AllocationReviewWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationReviewRow" ADD CONSTRAINT "AllocationReviewRow_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "AllocationReviewWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationReviewRow" ADD CONSTRAINT "AllocationReviewRow_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationReviewDay" ADD CONSTRAINT "AllocationReviewDay_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "AllocationReviewRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationReviewDay" ADD CONSTRAINT "AllocationReviewDay_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationReviewDayProject" ADD CONSTRAINT "AllocationReviewDayProject_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "AllocationReviewDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationReviewDayProject" ADD CONSTRAINT "AllocationReviewDayProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationReviewAbsenceAlert" ADD CONSTRAINT "AllocationReviewAbsenceAlert_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationReviewAbsenceAlert" ADD CONSTRAINT "AllocationReviewAbsenceAlert_sourceWeekId_fkey" FOREIGN KEY ("sourceWeekId") REFERENCES "AllocationReviewWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

