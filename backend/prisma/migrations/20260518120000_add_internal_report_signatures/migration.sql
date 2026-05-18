-- Internal report signatures and immutable report preservation.

CREATE TYPE "ReportVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'REJECTED');
CREATE TYPE "ReportSignerRole" AS ENUM ('COLLABORATOR', 'MANAGER', 'CLIENT');
CREATE TYPE "ReportSignatureType" AS ENUM ('ELECTRONIC', 'DIGITAL_A1');
CREATE TYPE "ReportSignatureStatus" AS ENUM ('PENDING', 'SIGNED', 'REJECTED', 'INVALIDATED', 'EXPIRED');
CREATE TYPE "ReportAuditAction" AS ENUM (
  'SIGNATURE_ROUND_CREATED',
  'SIGNED',
  'REJECTED',
  'SIGNATURES_INVALIDATED',
  'VERSION_CREATED',
  'TOKEN_ACCESSED',
  'TOKEN_EXPIRED',
  'REPORT_LOCKED'
);

ALTER TABLE "Project" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Report" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "clientCnpj" TEXT;

UPDATE "User"
SET "clientCnpj" = "username"
WHERE "role" = 'CLIENT'
  AND "username" ~ '^[0-9]{14}$';

UPDATE "User" AS u
SET "clientCnpj" = p."clientCnpj"
FROM "Project" AS p
WHERE u."role" = 'CLIENT'
  AND u."clientCnpj" IS NULL
  AND EXISTS (
    SELECT 1
    FROM unnest(p."clientEmailCc") AS cc(email)
    WHERE lower(cc.email) = lower(coalesce(u."email", u."username"))
  );

CREATE TABLE "ReportVersion" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "sourcePdfUrl" TEXT NOT NULL,
  "finalPdfUrl" TEXT,
  "sourceDocumentHash" TEXT NOT NULL,
  "finalDocumentHash" TEXT,
  "validationCode" TEXT,
  "status" "ReportVersionStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportVersion_pkey" PRIMARY KEY ("id")
);

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

CREATE INDEX "Project_deletedAt_idx" ON "Project"("deletedAt");
CREATE INDEX "Report_deletedAt_idx" ON "Report"("deletedAt");
CREATE INDEX "User_clientCnpj_idx" ON "User"("clientCnpj");

CREATE INDEX "ReportVersion_reportId_idx" ON "ReportVersion"("reportId");
CREATE INDEX "ReportVersion_reportId_status_idx" ON "ReportVersion"("reportId", "status");
CREATE UNIQUE INDEX "ReportVersion_reportId_versionNumber_key" ON "ReportVersion"("reportId", "versionNumber");
CREATE UNIQUE INDEX "ReportVersion_validationCode_key" ON "ReportVersion"("validationCode");

CREATE UNIQUE INDEX "ReportSignature_tokenHash_key" ON "ReportSignature"("tokenHash");
CREATE INDEX "ReportSignature_reportId_idx" ON "ReportSignature"("reportId");
CREATE INDEX "ReportSignature_versionId_idx" ON "ReportSignature"("versionId");
CREATE INDEX "ReportSignature_status_idx" ON "ReportSignature"("status");
CREATE UNIQUE INDEX "ReportSignature_versionId_signerEmail_key" ON "ReportSignature"("versionId", "signerEmail");

CREATE INDEX "ReportAuditLog_reportId_idx" ON "ReportAuditLog"("reportId");
CREATE INDEX "ReportAuditLog_versionId_idx" ON "ReportAuditLog"("versionId");
CREATE INDEX "ReportAuditLog_userId_idx" ON "ReportAuditLog"("userId");
CREATE INDEX "ReportAuditLog_action_idx" ON "ReportAuditLog"("action");
CREATE INDEX "ReportAuditLog_createdAt_idx" ON "ReportAuditLog"("createdAt");

ALTER TABLE "Report" DROP CONSTRAINT "Report_projectId_fkey";
ALTER TABLE "Report"
  ADD CONSTRAINT "Report_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReportVersion"
  ADD CONSTRAINT "ReportVersion_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "Report"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportVersion"
  ADD CONSTRAINT "ReportVersion_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReportSignature"
  ADD CONSTRAINT "ReportSignature_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "Report"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportSignature"
  ADD CONSTRAINT "ReportSignature_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "ReportVersion"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportSignature"
  ADD CONSTRAINT "ReportSignature_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReportAuditLog"
  ADD CONSTRAINT "ReportAuditLog_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "Report"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportAuditLog"
  ADD CONSTRAINT "ReportAuditLog_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "ReportVersion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReportAuditLog"
  ADD CONSTRAINT "ReportAuditLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
