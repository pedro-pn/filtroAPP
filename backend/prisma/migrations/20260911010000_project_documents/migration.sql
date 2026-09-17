-- CreateEnum
CREATE TYPE "ProjectDocumentType" AS ENUM ('COMMERCIAL_PROPOSAL', 'TECHNICAL_PROPOSAL', 'PURCHASE_ORDER', 'CONTRACT', 'DRAWING', 'SPECIFICATION', 'CERTIFICATE', 'CLIENT_REQUIREMENT', 'TECHNICAL_EVIDENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectDocumentRequirementStage" AS ENUM ('HANDOVER', 'MOBILIZATION', 'CLOSEOUT');

-- CreateEnum
CREATE TYPE "ProjectDocumentAcceptanceMode" AS ENUM ('NONE', 'INTERNAL', 'CLIENT', 'SIGNATURE');

-- CreateEnum
CREATE TYPE "ProjectDocumentSource" AS ENUM ('MANUAL', 'CRM', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ProjectDocumentContentKind" AS ENUM ('MANAGED_FILE', 'EXTERNAL_REFERENCE');

-- CreateEnum
CREATE TYPE "ProjectDocumentAcceptanceStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "ProjectWorkflowCommercialFact" ADD COLUMN "evidenceDocumentId" TEXT;

-- CreateTable
CREATE TABLE "ProjectDocument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "ProjectDocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "responsibleUserId" TEXT,
    "requirementStage" "ProjectDocumentRequirementStage",
    "acceptanceMode" "ProjectDocumentAcceptanceMode" NOT NULL DEFAULT 'NONE',
    "currentVersionId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "versionLabel" TEXT,
    "source" "ProjectDocumentSource" NOT NULL,
    "contentKind" "ProjectDocumentContentKind" NOT NULL,
    "originalFileName" TEXT,
    "mimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "storagePath" TEXT,
    "sha256" TEXT,
    "externalId" TEXT,
    "externalUrl" TEXT,
    "sourceVersion" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "signatureDocumentId" TEXT,
    "acceptanceStatus" "ProjectDocumentAcceptanceStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "acceptanceOccurredOn" DATE,
    "acceptanceReference" TEXT,
    "acceptanceNote" TEXT,
    "acceptanceRecordedAt" TIMESTAMP(3),
    "acceptanceRecordedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDocument_currentVersionId_key" ON "ProjectDocument"("currentVersionId");
CREATE INDEX "ProjectDocument_projectId_archivedAt_type_idx" ON "ProjectDocument"("projectId", "archivedAt", "type");
CREATE INDEX "ProjectDocument_responsibleUserId_idx" ON "ProjectDocument"("responsibleUserId");
CREATE UNIQUE INDEX "ProjectDocumentVersion_signatureDocumentId_key" ON "ProjectDocumentVersion"("signatureDocumentId");
CREATE UNIQUE INDEX "ProjectDocumentVersion_documentId_sequence_key" ON "ProjectDocumentVersion"("documentId", "sequence");
CREATE UNIQUE INDEX "ProjectDocumentVersion_documentId_source_sourceVersion_key" ON "ProjectDocumentVersion"("documentId", "source", "sourceVersion");
CREATE INDEX "ProjectDocumentVersion_documentId_createdAt_idx" ON "ProjectDocumentVersion"("documentId", "createdAt");
CREATE INDEX "ProjectDocumentVersion_source_externalId_sourceUpdatedAt_idx" ON "ProjectDocumentVersion"("source", "externalId", "sourceUpdatedAt");
CREATE INDEX "ProjectDocumentVersion_acceptanceRecordedByUserId_idx" ON "ProjectDocumentVersion"("acceptanceRecordedByUserId");
CREATE INDEX "ProjectDocumentVersion_createdByUserId_idx" ON "ProjectDocumentVersion"("createdByUserId");
CREATE INDEX "ProjectWorkflowCommercialFact_evidenceDocumentId_idx" ON "ProjectWorkflowCommercialFact"("evidenceDocumentId");

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ProjectDocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_archivedByUserId_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectDocumentVersion" ADD CONSTRAINT "ProjectDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectDocumentVersion" ADD CONSTRAINT "ProjectDocumentVersion_signatureDocumentId_fkey" FOREIGN KEY ("signatureDocumentId") REFERENCES "SignatureDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectDocumentVersion" ADD CONSTRAINT "ProjectDocumentVersion_acceptanceRecordedByUserId_fkey" FOREIGN KEY ("acceptanceRecordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectDocumentVersion" ADD CONSTRAINT "ProjectDocumentVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowCommercialFact" ADD CONSTRAINT "ProjectWorkflowCommercialFact_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
