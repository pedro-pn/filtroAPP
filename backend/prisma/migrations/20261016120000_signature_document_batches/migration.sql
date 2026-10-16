CREATE TABLE "SignatureDocumentBatch" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "signers" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SignatureDocumentBatch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SignatureDocument" ADD COLUMN "batchId" TEXT, ADD COLUMN "batchPosition" INTEGER;
ALTER TABLE "SignatureDocumentSigner" ADD COLUMN "batchSignerId" TEXT;
CREATE INDEX "SignatureDocumentBatch_ownerUserId_idx" ON "SignatureDocumentBatch"("ownerUserId");
CREATE INDEX "SignatureDocument_batchId_batchPosition_idx" ON "SignatureDocument"("batchId", "batchPosition");
ALTER TABLE "SignatureDocumentBatch" ADD CONSTRAINT "SignatureDocumentBatch_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SignatureDocument" ADD CONSTRAINT "SignatureDocument_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "SignatureDocumentBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
