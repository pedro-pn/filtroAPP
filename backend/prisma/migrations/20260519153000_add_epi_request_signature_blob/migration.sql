ALTER TABLE "EpiSignatureRequest"
  ADD COLUMN "signatureImageDataUrl" TEXT,
  ADD COLUMN "signatureSignerName" TEXT,
  ADD COLUMN "signedPdfPath" TEXT,
  ADD COLUMN "signedPdfHash" TEXT,
  ADD COLUMN "signedPdfFileName" TEXT;
