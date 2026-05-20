ALTER TABLE "EpiSignatureRequest"
  ADD COLUMN IF NOT EXISTS "signedPdfPath" TEXT,
  ADD COLUMN IF NOT EXISTS "signedPdfHash" TEXT,
  ADD COLUMN IF NOT EXISTS "signedPdfFileName" TEXT;
