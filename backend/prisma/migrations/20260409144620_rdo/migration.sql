-- CreateEnum
CREATE TYPE "UnitCategory" AS ENUM ('FILTRAGEM', 'FLUSHING', 'LIMPEZA_QUIMICA', 'DESIDRATACAO', 'UTH', 'OUTRA');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('RDO', 'RTP', 'RLQ', 'RCP', 'RLM', 'RLF', 'RLI');

-- CreateTable
CREATE TABLE "Collaborator" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "email" TEXT,
    "signatureImage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientCnpj" TEXT NOT NULL,
    "contractCode" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "workdayHours" TEXT NOT NULL DEFAULT '09:00',
    "weekendWorkdayHours" TEXT NOT NULL DEFAULT '08:00',
    "includesSaturday" BOOLEAN NOT NULL DEFAULT false,
    "includesSunday" BOOLEAN NOT NULL DEFAULT false,
    "operatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectReportSeq" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProjectReportSeq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceTags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" "UnitCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manometer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "scale" TEXT NOT NULL,
    "calibrationCertCode" TEXT NOT NULL,
    "calibratedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Manometer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParticleCounter" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "calibratedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParticleCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Collaborator_code_key" ON "Collaborator"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectReportSeq_projectId_reportType_key" ON "ProjectReportSeq"("projectId", "reportType");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_code_key" ON "Equipment"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_code_key" ON "Unit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Manometer_code_key" ON "Manometer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ParticleCounter_code_key" ON "ParticleCounter"("code");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Collaborator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReportSeq" ADD CONSTRAINT "ProjectReportSeq_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
