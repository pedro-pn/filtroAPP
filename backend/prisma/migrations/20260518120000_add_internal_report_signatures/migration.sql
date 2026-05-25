-- Internal report signatures and immutable report preservation.
-- The guards below keep this migration compatible with local databases that
-- already received the original 20260512 signature migrations before this
-- consolidated migration was created.

DO $$ BEGIN
  CREATE TYPE "ReportVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReportSignerRole" AS ENUM ('COLLABORATOR', 'MANAGER', 'CLIENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReportSignatureType" AS ENUM ('ELECTRONIC', 'DIGITAL_A1');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReportSignatureStatus" AS ENUM ('PENDING', 'SIGNED', 'REJECTED', 'INVALIDATED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
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
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "clientCnpj" TEXT;

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

CREATE TABLE IF NOT EXISTS "ReportVersion" (
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

ALTER TABLE "ReportVersion" ADD COLUMN IF NOT EXISTS "validationCode" TEXT;

CREATE TABLE IF NOT EXISTS "ReportSignature" (
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

ALTER TABLE "ReportSignature" ADD COLUMN IF NOT EXISTS "signatureImageDataUrl" TEXT;

CREATE TABLE IF NOT EXISTS "ReportAuditLog" (
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

CREATE INDEX IF NOT EXISTS "Project_deletedAt_idx" ON "Project"("deletedAt");
CREATE INDEX IF NOT EXISTS "Report_deletedAt_idx" ON "Report"("deletedAt");
CREATE INDEX IF NOT EXISTS "User_clientCnpj_idx" ON "User"("clientCnpj");

CREATE INDEX IF NOT EXISTS "ReportVersion_reportId_idx" ON "ReportVersion"("reportId");
CREATE INDEX IF NOT EXISTS "ReportVersion_reportId_status_idx" ON "ReportVersion"("reportId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "ReportVersion_reportId_versionNumber_key" ON "ReportVersion"("reportId", "versionNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "ReportVersion_validationCode_key" ON "ReportVersion"("validationCode");

CREATE UNIQUE INDEX IF NOT EXISTS "ReportSignature_tokenHash_key" ON "ReportSignature"("tokenHash");
CREATE INDEX IF NOT EXISTS "ReportSignature_reportId_idx" ON "ReportSignature"("reportId");
CREATE INDEX IF NOT EXISTS "ReportSignature_versionId_idx" ON "ReportSignature"("versionId");
CREATE INDEX IF NOT EXISTS "ReportSignature_status_idx" ON "ReportSignature"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "ReportSignature_versionId_signerEmail_key" ON "ReportSignature"("versionId", "signerEmail");

CREATE INDEX IF NOT EXISTS "ReportAuditLog_reportId_idx" ON "ReportAuditLog"("reportId");
CREATE INDEX IF NOT EXISTS "ReportAuditLog_versionId_idx" ON "ReportAuditLog"("versionId");
CREATE INDEX IF NOT EXISTS "ReportAuditLog_userId_idx" ON "ReportAuditLog"("userId");
CREATE INDEX IF NOT EXISTS "ReportAuditLog_action_idx" ON "ReportAuditLog"("action");
CREATE INDEX IF NOT EXISTS "ReportAuditLog_createdAt_idx" ON "ReportAuditLog"("createdAt");

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Report_projectId_fkey'
  ) THEN
    ALTER TABLE "Report" DROP CONSTRAINT "Report_projectId_fkey";
  END IF;

  ALTER TABLE "Report"
    ADD CONSTRAINT "Report_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReportVersion_reportId_fkey') THEN
    ALTER TABLE "ReportVersion"
      ADD CONSTRAINT "ReportVersion_reportId_fkey"
      FOREIGN KEY ("reportId") REFERENCES "Report"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReportVersion_createdByUserId_fkey') THEN
    ALTER TABLE "ReportVersion"
      ADD CONSTRAINT "ReportVersion_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReportSignature_reportId_fkey') THEN
    ALTER TABLE "ReportSignature"
      ADD CONSTRAINT "ReportSignature_reportId_fkey"
      FOREIGN KEY ("reportId") REFERENCES "Report"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReportSignature_versionId_fkey') THEN
    ALTER TABLE "ReportSignature"
      ADD CONSTRAINT "ReportSignature_versionId_fkey"
      FOREIGN KEY ("versionId") REFERENCES "ReportVersion"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReportSignature_userId_fkey') THEN
    ALTER TABLE "ReportSignature"
      ADD CONSTRAINT "ReportSignature_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReportAuditLog_reportId_fkey') THEN
    ALTER TABLE "ReportAuditLog"
      ADD CONSTRAINT "ReportAuditLog_reportId_fkey"
      FOREIGN KEY ("reportId") REFERENCES "Report"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReportAuditLog_versionId_fkey') THEN
    ALTER TABLE "ReportAuditLog"
      ADD CONSTRAINT "ReportAuditLog_versionId_fkey"
      FOREIGN KEY ("versionId") REFERENCES "ReportVersion"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReportAuditLog_userId_fkey') THEN
    ALTER TABLE "ReportAuditLog"
      ADD CONSTRAINT "ReportAuditLog_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
