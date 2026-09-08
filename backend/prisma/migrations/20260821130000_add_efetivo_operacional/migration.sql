-- CreateEnum
CREATE TYPE "CollaboratorAbsenceType" AS ENUM ('FERIAS', 'FOLGA', 'AFASTAMENTO', 'ASO', 'TREINAMENTO');

-- AlterEnum
ALTER TYPE "AppModule" ADD VALUE 'EFETIVO';

-- AlterEnum
-- PostgreSQL 12+ supports adding both role values in one migration transaction.
ALTER TYPE "ModuleRoleCode" ADD VALUE 'EFETIVO_MANAGER';
ALTER TYPE "ModuleRoleCode" ADD VALUE 'EFETIVO_VIEWER';

-- AlterTable
ALTER TABLE "Collaborator" ADD COLUMN "terminationDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "JobRole" ADD COLUMN "isOperational" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "EfetivoSetting" (
    "key" TEXT NOT NULL,
    "numberValue" DOUBLE PRECISION,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EfetivoSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CollaboratorAbsence" (
    "id" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,
    "type" "CollaboratorAbsenceType" NOT NULL DEFAULT 'FERIAS',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollaboratorAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollaboratorAbsence_collaboratorId_startDate_idx" ON "CollaboratorAbsence"("collaboratorId", "startDate");

-- CreateIndex
CREATE INDEX "CollaboratorAbsence_type_startDate_idx" ON "CollaboratorAbsence"("type", "startDate");

-- CreateIndex
CREATE INDEX "CollaboratorAbsence_deletedAt_idx" ON "CollaboratorAbsence"("deletedAt");

-- AddForeignKey
ALTER TABLE "CollaboratorAbsence" ADD CONSTRAINT "CollaboratorAbsence_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
