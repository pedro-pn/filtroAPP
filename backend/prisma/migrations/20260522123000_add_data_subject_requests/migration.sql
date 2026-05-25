CREATE TYPE "DataSubjectRequestType" AS ENUM (
  'CONFIRMATION',
  'ACCESS',
  'CORRECTION',
  'ANONYMIZATION',
  'BLOCKING',
  'DELETION',
  'PORTABILITY',
  'SHARING_INFO',
  'CONSENT_REVOCATION',
  'OPPOSITION',
  'OTHER'
);

CREATE TYPE "DataSubjectRequestStatus" AS ENUM (
  'OPEN',
  'IN_REVIEW',
  'COMPLETED',
  'REJECTED',
  'CANCELLED'
);

CREATE TABLE "DataSubjectRequest" (
  "id" TEXT NOT NULL,
  "protocol" TEXT NOT NULL,
  "type" "DataSubjectRequestType" NOT NULL,
  "status" "DataSubjectRequestStatus" NOT NULL DEFAULT 'OPEN',
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "identifier" TEXT,
  "details" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'PUBLIC_FORM',
  "requesterUserId" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "responseNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataSubjectRequest_protocol_key" ON "DataSubjectRequest"("protocol");
CREATE INDEX "DataSubjectRequest_email_idx" ON "DataSubjectRequest"("email");
CREATE INDEX "DataSubjectRequest_requesterUserId_idx" ON "DataSubjectRequest"("requesterUserId");
CREATE INDEX "DataSubjectRequest_status_idx" ON "DataSubjectRequest"("status");
CREATE INDEX "DataSubjectRequest_createdAt_idx" ON "DataSubjectRequest"("createdAt");

ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_requesterUserId_fkey"
  FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
