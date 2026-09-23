-- CreateEnum
CREATE TYPE "ProjectWorkflowDocumentationType" AS ENUM ('DOCUMENT', 'EXAM', 'TRAINING', 'CERTIFICATION');

-- CreateEnum
CREATE TYPE "ProjectWorkflowDocumentationStatus" AS ENUM ('PENDING', 'REQUESTED', 'CONFIRMED');

-- AlterTable: read-only handover snapshot reserved for the future CRM synchronization.
ALTER TABLE "ProjectWorkflow"
ADD COLUMN "commercialExpectedStartDate" DATE,
ADD COLUMN "commercialExpectedDurationDays" INTEGER,
ADD COLUMN "commercialWhatsappGroupCreated" BOOLEAN,
ADD COLUMN "commercialWhatsappGroupUrl" TEXT,
ADD COLUMN "commercialParticipantsIncluded" BOOLEAN,
ADD COLUMN "commercialClientContactName" TEXT,
ADD COLUMN "commercialClientContactPhone" TEXT,
ADD COLUMN "commercialClientContactEmail" TEXT,
ADD COLUMN "commercialAssumptions" TEXT,
ADD COLUMN "commercialSourceUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProjectWorkflowDocumentationCategory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "ProjectWorkflowDocumentationType" NOT NULL,
    "required" BOOLEAN,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectWorkflowDocumentationCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectWorkflowDocumentationRequirement" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectWorkflowDocumentationStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" DATE,
    "confirmedAt" DATE,
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectWorkflowDocumentationRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectWorkflowDocumentationHistory" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectWorkflowDocumentationHistory_pkey" PRIMARY KEY ("id")
);

-- Existing generic documentation issues are superseded by the named tracking records.
UPDATE "ProjectWorkflowIssue"
SET "status" = 'RESOLVED', "updatedAt" = CURRENT_TIMESTAMP
WHERE "sourceQuestion" = 'CLIENT_REQUIREMENTS' AND "status" <> 'RESOLVED';

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWorkflowDocumentationCategory_projectId_type_key" ON "ProjectWorkflowDocumentationCategory"("projectId", "type");
CREATE INDEX "ProjectWorkflowDocumentationCategory_updatedByUserId_idx" ON "ProjectWorkflowDocumentationCategory"("updatedByUserId");
CREATE INDEX "ProjectWorkflowDocumentationRequirement_categoryId_archivedAt_status_idx" ON "ProjectWorkflowDocumentationRequirement"("categoryId", "archivedAt", "status");
CREATE INDEX "ProjectWorkflowDocumentationRequirement_createdByUserId_idx" ON "ProjectWorkflowDocumentationRequirement"("createdByUserId");
CREATE INDEX "ProjectWorkflowDocumentationRequirement_updatedByUserId_idx" ON "ProjectWorkflowDocumentationRequirement"("updatedByUserId");
CREATE INDEX "ProjectWorkflowDocumentationHistory_requirementId_createdAt_idx" ON "ProjectWorkflowDocumentationHistory"("requirementId", "createdAt");
CREATE INDEX "ProjectWorkflowDocumentationHistory_actorUserId_idx" ON "ProjectWorkflowDocumentationHistory"("actorUserId");

-- AddForeignKey
ALTER TABLE "ProjectWorkflowDocumentationCategory" ADD CONSTRAINT "ProjectWorkflowDocumentationCategory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectWorkflow"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowDocumentationCategory" ADD CONSTRAINT "ProjectWorkflowDocumentationCategory_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowDocumentationRequirement" ADD CONSTRAINT "ProjectWorkflowDocumentationRequirement_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProjectWorkflowDocumentationCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowDocumentationRequirement" ADD CONSTRAINT "ProjectWorkflowDocumentationRequirement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowDocumentationRequirement" ADD CONSTRAINT "ProjectWorkflowDocumentationRequirement_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowDocumentationHistory" ADD CONSTRAINT "ProjectWorkflowDocumentationHistory_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "ProjectWorkflowDocumentationRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectWorkflowDocumentationHistory" ADD CONSTRAINT "ProjectWorkflowDocumentationHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
