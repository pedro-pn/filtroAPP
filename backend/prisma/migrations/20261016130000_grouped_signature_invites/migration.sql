CREATE TABLE "SignatureInviteGroup" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenEncrypted" TEXT NOT NULL,
  "tokenIv" TEXT NOT NULL,
  "tokenAuthTag" TEXT NOT NULL,
  "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "emailStatus" "SignatureDocumentEmailStatus" NOT NULL DEFAULT 'NAO_APLICAVEL',
  "emailAttempts" INTEGER NOT NULL DEFAULT 0,
  "emailSentAt" TIMESTAMP(3),
  "emailLastError" TEXT,
  "emailClaimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SignatureInviteGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SignatureInviteGroup_tokenHash_key" ON "SignatureInviteGroup"("tokenHash");
CREATE INDEX "SignatureInviteGroup_emailStatus_emailClaimedAt_idx" ON "SignatureInviteGroup"("emailStatus", "emailClaimedAt");
ALTER TABLE "SignatureDocumentSigner" ADD COLUMN "groupInviteId" TEXT;
CREATE INDEX "SignatureDocumentSigner_groupInviteId_idx" ON "SignatureDocumentSigner"("groupInviteId");
ALTER TABLE "SignatureDocumentSigner" ADD CONSTRAINT "SignatureDocumentSigner_groupInviteId_fkey"
  FOREIGN KEY ("groupInviteId") REFERENCES "SignatureInviteGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
