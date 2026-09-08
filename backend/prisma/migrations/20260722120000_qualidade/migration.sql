-- CreateEnum
CREATE TYPE "QualityRecordType" AS ENUM ('DESVIO', 'LICAO_APRENDIDA', 'INCIDENTE', 'RECLAMACAO_CLIENTE', 'MELHORIA');

-- CreateEnum
CREATE TYPE "QualityImpact" AS ENUM ('ALTO', 'MEDIO', 'BAIXO');

-- CreateEnum
CREATE TYPE "QualityDisposition" AS ENUM ('TRATAR', 'MONITORAR', 'ARQUIVAR_DIVULGAR');

-- CreateEnum
CREATE TYPE "QualityStatus" AS ENUM ('ABERTO', 'EM_TRIAGEM', 'EM_OBSERVACAO', 'EM_ACAO', 'FECHADO', 'DIVULGADO');

-- AlterEnum
ALTER TYPE "AppModule" ADD VALUE 'QUALIDADE';

-- AlterEnum
ALTER TYPE "ModuleRoleCode" ADD VALUE 'QUALIDADE_MANAGER';
ALTER TYPE "ModuleRoleCode" ADD VALUE 'QUALIDADE_VIEWER';

-- CreateTable
CREATE TABLE "QualityNature" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityNature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityRecord" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "QualityRecordType" NOT NULL,
    "seq" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL,
    "origin" TEXT NOT NULL,
    "projectId" TEXT,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "natureId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "impact" "QualityImpact" NOT NULL,
    "linkedRnc" TEXT,
    "disposition" "QualityDisposition" NOT NULL,
    "definedAction" TEXT,
    "actionOwner" TEXT,
    "actionDeadline" TIMESTAMP(3),
    "evidence" TEXT,
    "resultVerification" TEXT,
    "status" "QualityStatus" NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityRecordSeq" (
    "type" "QualityRecordType" NOT NULL,
    "year" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QualityRecordSeq_pkey" PRIMARY KEY ("type","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "QualityNature_name_lower_key" ON "QualityNature"(lower("name"));

-- CreateIndex
CREATE INDEX "QualityNature_isActive_name_idx" ON "QualityNature"("isActive", "name");

-- CreateIndex
CREATE UNIQUE INDEX "QualityRecord_number_key" ON "QualityRecord"("number");

-- CreateIndex
CREATE UNIQUE INDEX "QualityRecord_type_year_seq_key" ON "QualityRecord"("type", "year", "seq");

-- CreateIndex
CREATE INDEX "QualityRecord_projectId_type_idx" ON "QualityRecord"("projectId", "type");

-- CreateIndex
CREATE INDEX "QualityRecord_natureId_eventDate_idx" ON "QualityRecord"("natureId", "eventDate");

-- CreateIndex
CREATE INDEX "QualityRecord_status_idx" ON "QualityRecord"("status");

-- CreateIndex
CREATE INDEX "QualityRecord_impact_idx" ON "QualityRecord"("impact");

-- CreateIndex
CREATE INDEX "QualityRecord_registeredAt_idx" ON "QualityRecord"("registeredAt");

-- CreateIndex
CREATE INDEX "QualityRecord_createdById_idx" ON "QualityRecord"("createdById");

-- CreateIndex
CREATE INDEX "QualityRecord_updatedById_idx" ON "QualityRecord"("updatedById");

-- AddForeignKey
ALTER TABLE "QualityRecord" ADD CONSTRAINT "QualityRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityRecord" ADD CONSTRAINT "QualityRecord_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "QualityNature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityRecord" ADD CONSTRAINT "QualityRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityRecord" ADD CONSTRAINT "QualityRecord_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
