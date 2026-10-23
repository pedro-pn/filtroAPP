CREATE TABLE "CommercialAppReceipt" (
  "eventId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "proposalCode" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "attemptId" TEXT,
  "attemptAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "acknowledgement" JSONB,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialAppReceipt_pkey" PRIMARY KEY ("eventId"),
  CONSTRAINT "CommercialAppReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommercialAppReceipt_status_check" CHECK ("status" IN ('PENDING', 'SENDING', 'DELIVERED', 'REVIEW')),
  CONSTRAINT "CommercialAppReceipt_attempts_check" CHECK ("attempts" >= 0)
);
CREATE INDEX "CommercialAppReceipt_status_nextAttemptAt_idx" ON "CommercialAppReceipt"("status", "nextAttemptAt");
CREATE INDEX "CommercialAppReceipt_externalId_importedAt_idx" ON "CommercialAppReceipt"("externalId", "importedAt");
