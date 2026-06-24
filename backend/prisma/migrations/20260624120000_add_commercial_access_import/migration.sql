-- Importação do banco comercial Access (propostas_bd.accdb) — módulo Acompanhamento de Projetos

-- CreateEnum
CREATE TYPE "ServiceModality" AS ENUM ('INLOCO', 'POP_SEDE');
CREATE TYPE "BudgetSelectionStatus" AS ENUM ('UNKNOWN', 'CHOSEN', 'LOST');
CREATE TYPE "AccessImportSource" AS ENUM ('SCRIPT', 'MANUAL');
CREATE TYPE "AccessImportStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'ERROR');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "commercialProposalCode" TEXT;

-- CreateTable
CREATE TABLE "CommercialProposal" (
    "id" TEXT NOT NULL,
    "codBd" INTEGER NOT NULL,
    "codProp" INTEGER NOT NULL,
    "nRev" INTEGER NOT NULL DEFAULT 0,
    "codNectar" INTEGER,
    "proposalDate" TIMESTAMP(3),
    "createdInAccessAt" TIMESTAMP(3),
    "modifiedInAccessAt" TIMESTAMP(3),
    "clientName" TEXT,
    "clientCnpj" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "localObra" TEXT,
    "sede" TEXT,
    "elaborador" TEXT,
    "vendedor" TEXT,
    "serviceModality" "ServiceModality",
    "salePrice" DECIMAL(14,2),
    "plannedCost" DECIMAL(14,2),
    "expectedProfit" DECIMAL(14,2),
    "expectedMargin" DECIMAL(6,2),
    "taxes" DECIMAL(14,2),
    "plannedDays" INTEGER,
    "workedDays" INTEGER,
    "numOperators" INTEGER,
    "numSupervisors" INTEGER,
    "numPerDay" INTEGER,
    "numPerNight" INTEGER,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "rawRow" JSONB NOT NULL,
    "lastImportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "source" "AccessImportSource" NOT NULL DEFAULT 'SCRIPT',
    "status" "AccessImportStatus" NOT NULL DEFAULT 'SUCCESS',
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "pendingProjectsCreated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "summary" JSONB,
    "importedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBudget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceProposalCodBd" INTEGER,
    "serviceModality" "ServiceModality",
    "salePrice" DECIMAL(14,2),
    "plannedTotalCost" DECIMAL(14,2),
    "expectedProfit" DECIMAL(14,2),
    "expectedMargin" DECIMAL(6,2),
    "taxes" DECIMAL(14,2),
    "plannedDays" INTEGER,
    "selectionStatus" "BudgetSelectionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "selectedByUserId" TEXT,
    "selectedAt" TIMESTAMP(3),
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'ACCESS_IMPORT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_commercialProposalCode_idx" ON "Project"("commercialProposalCode");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialProposal_codBd_key" ON "CommercialProposal"("codBd");
CREATE INDEX "CommercialProposal_codProp_nRev_idx" ON "CommercialProposal"("codProp", "nRev");
CREATE INDEX "CommercialProposal_clientCnpj_idx" ON "CommercialProposal"("clientCnpj");
CREATE INDEX "CommercialProposal_lastImportId_idx" ON "CommercialProposal"("lastImportId");

-- CreateIndex
CREATE INDEX "AccessImport_status_createdAt_idx" ON "AccessImport"("status", "createdAt");
CREATE INDEX "AccessImport_contentHash_idx" ON "AccessImport"("contentHash");
CREATE INDEX "AccessImport_createdAt_idx" ON "AccessImport"("createdAt");

-- CreateIndex
CREATE INDEX "ProjectBudget_projectId_idx" ON "ProjectBudget"("projectId");
CREATE INDEX "ProjectBudget_sourceProposalCodBd_idx" ON "ProjectBudget"("sourceProposalCodBd");
CREATE INDEX "ProjectBudget_selectionStatus_idx" ON "ProjectBudget"("selectionStatus");
CREATE UNIQUE INDEX "ProjectBudget_projectId_version_key" ON "ProjectBudget"("projectId", "version");

-- AddForeignKey
ALTER TABLE "AccessImport" ADD CONSTRAINT "AccessImport_importedByUserId_fkey" FOREIGN KEY ("importedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudget" ADD CONSTRAINT "ProjectBudget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudget" ADD CONSTRAINT "ProjectBudget_selectedByUserId_fkey" FOREIGN KEY ("selectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
