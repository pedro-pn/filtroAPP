ALTER TABLE "EpiSignatureRequest"
  ADD COLUMN "validationCode" TEXT,
  ADD COLUMN "sourceDocumentHash" TEXT,
  ADD COLUMN "signatureImageHash" TEXT;

CREATE UNIQUE INDEX "EpiSignatureRequest_validationCode_key"
  ON "EpiSignatureRequest"("validationCode");
