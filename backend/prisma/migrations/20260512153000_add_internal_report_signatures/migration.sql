-- CreateEnum
CREATE TYPE "ReportVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReportSignerRole" AS ENUM ('COLLABORATOR', 'MANAGER', 'CLIENT');

-- CreateEnum
CREATE TYPE "ReportSignatureType" AS ENUM ('ELECTRONIC', 'DIGITAL_A1');

-- CreateEnum
CREATE TYPE "ReportSignatureStatus" AS ENUM ('PENDING', 'SIGNED', 'REJECTED', 'INVALIDATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReportAuditAction" AS ENUM ('SIGNATURE_ROUND_CREATED', 'SIGNED', 'REJECTED', 'SIGNATURES_INVALIDATED', 'VERSION_CREATED', 'TOKEN_ACCESSED', 'TOKEN_EXPIRED', 'REPORT_LOCKED');

-- CreateTable
CREATE TABLE "ReportVersion" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "sourcePdfUrl" TEXT NOT NULL,
    "finalPdfUrl" TEXT,
    "sourceDocumentHash" TEXT NOT NULL,
    "finalDocumentHash" TEXT,
    "status" "ReportVersionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSignature" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "userId" TEXT,
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "signerRole" "ReportSignerRole" NOT NULL,
    "signatureType" "ReportSignatureType" NOT NULL DEFAULT 'ELECTRONIC',
    "status" "ReportSignatureStatus" NOT NULL DEFAULT 'PENDING',
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "signatureImageDataUrl" TEXT,
    "sourceDocumentHash" TEXT NOT NULL,
    "finalDocumentHash" TEXT,
    "signedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "invalidatedAt" TIMESTAMP(3),
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportAuditLog" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "versionId" TEXT,
    "userId" TEXT,
    "action" "ReportAuditAction" NOT NULL,
    "description" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportVersion_reportId_idx" ON "ReportVersion"("reportId");

-- CreateIndex
CREATE INDEX "ReportVersion_reportId_status_idx" ON "ReportVersion"("reportId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReportVersion_reportId_versionNumber_key" ON "ReportVersion"("reportId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ReportSignature_tokenHash_key" ON "ReportSignature"("tokenHash");

-- CreateIndex
CREATE INDEX "ReportSignature_reportId_idx" ON "ReportSignature"("reportId");

-- CreateIndex
CREATE INDEX "ReportSignature_versionId_idx" ON "ReportSignature"("versionId");

-- CreateIndex
CREATE INDEX "ReportSignature_status_idx" ON "ReportSignature"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReportSignature_versionId_signerEmail_key" ON "ReportSignature"("versionId", "signerEmail");

-- CreateIndex
CREATE INDEX "ReportAuditLog_reportId_idx" ON "ReportAuditLog"("reportId");

-- CreateIndex
CREATE INDEX "ReportAuditLog_versionId_idx" ON "ReportAuditLog"("versionId");

-- CreateIndex
CREATE INDEX "ReportAuditLog_userId_idx" ON "ReportAuditLog"("userId");

-- CreateIndex
CREATE INDEX "ReportAuditLog_action_idx" ON "ReportAuditLog"("action");

-- CreateIndex
CREATE INDEX "ReportAuditLog_createdAt_idx" ON "ReportAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ReportVersion" ADD CONSTRAINT "ReportVersion_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportVersion" ADD CONSTRAINT "ReportVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSignature" ADD CONSTRAINT "ReportSignature_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSignature" ADD CONSTRAINT "ReportSignature_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ReportVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSignature" ADD CONSTRAINT "ReportSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAuditLog" ADD CONSTRAINT "ReportAuditLog_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAuditLog" ADD CONSTRAINT "ReportAuditLog_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ReportVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAuditLog" ADD CONSTRAINT "ReportAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
