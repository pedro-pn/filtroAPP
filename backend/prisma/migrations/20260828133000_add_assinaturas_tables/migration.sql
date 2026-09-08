CREATE TYPE "SignatureDocumentStatus" AS ENUM ('RASCUNHO', 'AGUARDANDO_ASSINATURAS', 'FINALIZANDO', 'CONCLUIDO', 'CANCELADO');
CREATE TYPE "SignatureDocumentSignerStatus" AS ENUM ('PENDENTE', 'VISUALIZADO', 'ASSINADO', 'EXPIRADO', 'REVOGADO');
CREATE TYPE "SignatureDocumentEmailStatus" AS ENUM ('NAO_APLICAVEL', 'PENDENTE', 'EM_ENVIO', 'ENVIADO', 'FALHOU', 'REVISAO_NECESSARIA');
CREATE TYPE "SignatureDocumentInviteInvalidationReason" AS ENUM ('MANUAL', 'DOCUMENTO_CANCELADO', 'DOCUMENTO_EXCLUIDO');
CREATE TYPE "SignatureDocumentFilePurgeStatus" AS ENUM ('PREPARANDO', 'PENDENTE', 'EM_PROCESSAMENTO', 'CONCLUIDO', 'FALHOU', 'CANCELADO');
CREATE TYPE "SignatureDocumentAuditAction" AS ENUM ('DOCUMENTO_CRIADO', 'CONFIGURACAO_ATUALIZADA', 'DOCUMENTO_PUBLICADO', 'DOCUMENTO_DESPUBLICADO', 'CONVITE_CRIADO', 'EMAIL_SOLICITADO', 'EMAIL_ENVIADO', 'EMAIL_FALHOU', 'LINK_RECUPERADO', 'LINK_ACESSADO', 'DOCUMENTO_VISUALIZADO', 'ASSINATURA_REALIZADA', 'CONVITE_EXPIRADO', 'CONVITE_RENOVADO', 'CONVITE_REVOGADO', 'FINALIZACAO_INICIADA', 'FINALIZACAO_FALHOU', 'PDF_FINAL_GERADO', 'DOCUMENTO_CONCLUIDO', 'DOCUMENTO_CANCELADO', 'DOCUMENTO_ARQUIVADO', 'DOCUMENTO_RESTAURADO', 'DOCUMENTO_EXCLUIDO', 'DOCUMENTO_EXCLUSAO_DESFEITA', 'ARQUIVOS_PURGADOS', 'PROPRIETARIO_REMOVIDO', 'DADOS_ACESSO_ANONIMIZADOS');

CREATE TABLE "SignatureDocument" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT,
  "requesterNameSnapshot" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
  "fileSizeBytes" INTEGER NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "pageDimensions" JSONB NOT NULL,
  "sourceStoragePath" TEXT,
  "sourceDocumentHash" TEXT NOT NULL,
  "finalStoragePath" TEXT,
  "finalDocumentHash" TEXT,
  "validationCode" TEXT,
  "status" "SignatureDocumentStatus" NOT NULL DEFAULT 'RASCUNHO',
  "tokenExpiresAt" TIMESTAMP(3),
  "finalizationClaimedAt" TIMESTAMP(3),
  "finalizationAttempts" INTEGER NOT NULL DEFAULT 0,
  "finalizationNextAttemptAt" TIMESTAMP(3),
  "finalizationLastError" TEXT,
  "cancelReason" TEXT,
  "publishedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "filesPurgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SignatureDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignatureDocumentSigner" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "position" INTEGER NOT NULL,
  "status" "SignatureDocumentSignerStatus" NOT NULL DEFAULT 'PENDENTE',
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "tokenHash" TEXT,
  "tokenEncrypted" TEXT,
  "tokenIv" TEXT,
  "tokenAuthTag" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "renewalCount" INTEGER NOT NULL DEFAULT 0,
  "invalidationReason" "SignatureDocumentInviteInvalidationReason",
  "emailStatus" "SignatureDocumentEmailStatus" NOT NULL DEFAULT 'NAO_APLICAVEL',
  "emailAttempts" INTEGER NOT NULL DEFAULT 0,
  "emailSentAt" TIMESTAMP(3),
  "emailLastError" TEXT,
  "emailClaimedAt" TIMESTAMP(3),
  "declaredSignerName" TEXT,
  "signatureImageDataUrl" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "privacyNoticeAcceptedAt" TIMESTAMP(3),
  "privacyNoticeVersion" TEXT,
  "viewedAt" TIMESTAMP(3),
  "signedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SignatureDocumentSigner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignatureDocumentField" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "signerId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "x" DECIMAL(9,8) NOT NULL,
  "y" DECIMAL(9,8) NOT NULL,
  "width" DECIMAL(9,8) NOT NULL,
  "height" DECIMAL(9,8) NOT NULL,
  "pageWidthPt" DECIMAL(10,3) NOT NULL,
  "pageHeightPt" DECIMAL(10,3) NOT NULL,
  "pageRotation" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SignatureDocumentField_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignatureDocumentAuditLog" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "signerId" TEXT,
  "actorUserId" TEXT,
  "action" "SignatureDocumentAuditAction" NOT NULL,
  "description" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SignatureDocumentAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignatureDocumentFilePurge" (
  "id" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "quarantineRoot" TEXT NOT NULL,
  "manifest" JSONB NOT NULL,
  "status" "SignatureDocumentFilePurgeStatus" NOT NULL DEFAULT 'PREPARANDO',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "claimedAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SignatureDocumentFilePurge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignatureDocumentCompletionNotification" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "emailTo" TEXT NOT NULL,
  "status" "SignatureDocumentEmailStatus" NOT NULL DEFAULT 'PENDENTE',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "claimedAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SignatureDocumentCompletionNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignatureDocument_validationCode_key" ON "SignatureDocument"("validationCode");
CREATE INDEX "SignatureDocument_ownerUserId_deletedAt_archivedAt_createdAt_idx" ON "SignatureDocument"("ownerUserId", "deletedAt", "archivedAt", "createdAt");
CREATE INDEX "SignatureDocument_ownerUserId_idx" ON "SignatureDocument"("ownerUserId");
CREATE INDEX "SignatureDocument_ownerUserId_status_idx" ON "SignatureDocument"("ownerUserId", "status");
CREATE INDEX "SignatureDocument_status_finalizationNextAttemptAt_idx" ON "SignatureDocument"("status", "finalizationNextAttemptAt");
CREATE INDEX "SignatureDocument_deletedAt_idx" ON "SignatureDocument"("deletedAt");
CREATE INDEX "SignatureDocument_archivedAt_idx" ON "SignatureDocument"("archivedAt");
CREATE UNIQUE INDEX "SignatureDocumentSigner_tokenHash_key" ON "SignatureDocumentSigner"("tokenHash");
CREATE UNIQUE INDEX "SignatureDocumentSigner_documentId_position_key" ON "SignatureDocumentSigner"("documentId", "position");
CREATE INDEX "SignatureDocumentSigner_documentId_idx" ON "SignatureDocumentSigner"("documentId");
CREATE INDEX "SignatureDocumentSigner_documentId_status_idx" ON "SignatureDocumentSigner"("documentId", "status");
CREATE INDEX "SignatureDocumentSigner_status_tokenExpiresAt_idx" ON "SignatureDocumentSigner"("status", "tokenExpiresAt");
CREATE INDEX "SignatureDocumentSigner_emailStatus_emailClaimedAt_idx" ON "SignatureDocumentSigner"("emailStatus", "emailClaimedAt");
CREATE INDEX "SignatureDocumentField_documentId_pageNumber_idx" ON "SignatureDocumentField"("documentId", "pageNumber");
CREATE INDEX "SignatureDocumentField_signerId_idx" ON "SignatureDocumentField"("signerId");
CREATE INDEX "SignatureDocumentAuditLog_documentId_createdAt_idx" ON "SignatureDocumentAuditLog"("documentId", "createdAt");
CREATE INDEX "SignatureDocumentAuditLog_signerId_idx" ON "SignatureDocumentAuditLog"("signerId");
CREATE INDEX "SignatureDocumentAuditLog_actorUserId_idx" ON "SignatureDocumentAuditLog"("actorUserId");
CREATE INDEX "SignatureDocumentAuditLog_action_idx" ON "SignatureDocumentAuditLog"("action");
CREATE INDEX "SignatureDocumentAuditLog_createdAt_idx" ON "SignatureDocumentAuditLog"("createdAt");
CREATE UNIQUE INDEX "SignatureDocumentFilePurge_operationKey_key" ON "SignatureDocumentFilePurge"("operationKey");
CREATE INDEX "SignatureDocumentFilePurge_status_nextAttemptAt_idx" ON "SignatureDocumentFilePurge"("status", "nextAttemptAt");
CREATE INDEX "SignatureDocumentFilePurge_targetUserId_idx" ON "SignatureDocumentFilePurge"("targetUserId");
CREATE INDEX "SignatureDocumentFilePurge_createdAt_idx" ON "SignatureDocumentFilePurge"("createdAt");
CREATE UNIQUE INDEX "SignatureDocumentCompletionNotification_documentId_key" ON "SignatureDocumentCompletionNotification"("documentId");
CREATE UNIQUE INDEX "SignatureDocumentCompletionNotification_idempotencyKey_key" ON "SignatureDocumentCompletionNotification"("idempotencyKey");
CREATE INDEX "SignatureDocumentCompletionNotification_status_nextAttemptAt_idx" ON "SignatureDocumentCompletionNotification"("status", "nextAttemptAt");
CREATE INDEX "SignatureDocumentCompletionNotification_createdAt_idx" ON "SignatureDocumentCompletionNotification"("createdAt");

ALTER TABLE "SignatureDocument" ADD CONSTRAINT "SignatureDocument_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SignatureDocumentSigner" ADD CONSTRAINT "SignatureDocumentSigner_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SignatureDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SignatureDocumentField" ADD CONSTRAINT "SignatureDocumentField_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SignatureDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SignatureDocumentField" ADD CONSTRAINT "SignatureDocumentField_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "SignatureDocumentSigner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SignatureDocumentAuditLog" ADD CONSTRAINT "SignatureDocumentAuditLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SignatureDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SignatureDocumentAuditLog" ADD CONSTRAINT "SignatureDocumentAuditLog_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "SignatureDocumentSigner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SignatureDocumentAuditLog" ADD CONSTRAINT "SignatureDocumentAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SignatureDocumentCompletionNotification" ADD CONSTRAINT "SignatureDocumentCompletionNotification_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SignatureDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
