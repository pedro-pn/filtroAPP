ALTER TABLE "EpiSignatureRequest"
  ADD COLUMN "ipAddress" TEXT,
  ADD COLUMN "userAgent" TEXT;

CREATE TABLE "EpiSignatureRequestAuditLog" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EpiSignatureRequestAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EpiSignatureRequestAuditLog_requestId_idx" ON "EpiSignatureRequestAuditLog"("requestId");
CREATE INDEX "EpiSignatureRequestAuditLog_action_idx" ON "EpiSignatureRequestAuditLog"("action");
CREATE INDEX "EpiSignatureRequestAuditLog_createdAt_idx" ON "EpiSignatureRequestAuditLog"("createdAt");

ALTER TABLE "EpiSignatureRequestAuditLog"
  ADD CONSTRAINT "EpiSignatureRequestAuditLog_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "EpiSignatureRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
