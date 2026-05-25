ALTER TABLE "Collaborator" ADD COLUMN "signatureNoticeAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Collaborator" ADD COLUMN "signatureNoticeVersion" TEXT;

CREATE TABLE "CollaboratorSignatureNoticeLog" (
  "id" TEXT NOT NULL,
  "collaboratorId" TEXT NOT NULL,
  "userId" TEXT,
  "noticeVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CollaboratorSignatureNoticeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CollaboratorSignatureNoticeLog_collaboratorId_idx" ON "CollaboratorSignatureNoticeLog"("collaboratorId");
CREATE INDEX "CollaboratorSignatureNoticeLog_userId_idx" ON "CollaboratorSignatureNoticeLog"("userId");
CREATE INDEX "CollaboratorSignatureNoticeLog_createdAt_idx" ON "CollaboratorSignatureNoticeLog"("createdAt");

ALTER TABLE "CollaboratorSignatureNoticeLog" ADD CONSTRAINT "CollaboratorSignatureNoticeLog_collaboratorId_fkey"
  FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CollaboratorSignatureNoticeLog" ADD CONSTRAINT "CollaboratorSignatureNoticeLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
