ALTER TABLE "DataSubjectRequest" ADD COLUMN "identityVerifiedAt" TIMESTAMP(3);
ALTER TABLE "DataSubjectRequest" ADD COLUMN "identityVerifiedByUserId" TEXT;
ALTER TABLE "DataSubjectRequest" ADD COLUMN "identityVerificationEvidence" TEXT;

CREATE TABLE "DataSubjectRequestResponseAttempt" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "responseKind" TEXT NOT NULL DEFAULT 'SUBSTANTIVE',
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "emailTo" TEXT NOT NULL,
  "emailSubject" TEXT,
  "providerMessageId" TEXT,
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataSubjectRequestResponseAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataSubjectRequestResponseAttempt_idempotencyKey_key" ON "DataSubjectRequestResponseAttempt"("idempotencyKey");
CREATE INDEX "DataSubjectRequest_identityVerifiedByUserId_idx" ON "DataSubjectRequest"("identityVerifiedByUserId");
CREATE INDEX "DataSubjectRequestResponseAttempt_requestId_idx" ON "DataSubjectRequestResponseAttempt"("requestId");
CREATE INDEX "DataSubjectRequestResponseAttempt_createdByUserId_idx" ON "DataSubjectRequestResponseAttempt"("createdByUserId");
CREATE INDEX "DataSubjectRequestResponseAttempt_status_idx" ON "DataSubjectRequestResponseAttempt"("status");

ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_identityVerifiedByUserId_fkey"
  FOREIGN KEY ("identityVerifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DataSubjectRequestResponseAttempt" ADD CONSTRAINT "DataSubjectRequestResponseAttempt_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "DataSubjectRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DataSubjectRequestResponseAttempt" ADD CONSTRAINT "DataSubjectRequestResponseAttempt_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
