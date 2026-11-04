CREATE TYPE "SignatureDocumentSharePermission" AS ENUM ('VIEW', 'EDIT');

CREATE TABLE "SignatureDocumentShare" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permission" "SignatureDocumentSharePermission" NOT NULL DEFAULT 'VIEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SignatureDocumentShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignatureDocumentShare_documentId_userId_key" ON "SignatureDocumentShare"("documentId", "userId");
CREATE INDEX "SignatureDocumentShare_userId_documentId_idx" ON "SignatureDocumentShare"("userId", "documentId");
ALTER TABLE "SignatureDocumentShare" ADD CONSTRAINT "SignatureDocumentShare_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SignatureDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SignatureDocumentShare" ADD CONSTRAINT "SignatureDocumentShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
