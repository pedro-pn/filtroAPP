-- LGPD: marca de anonimização por retenção e exceção (legal hold) por colaborador.
ALTER TABLE "Collaborator" ADD COLUMN "privacyAnonymizedAt" TIMESTAMP(3);
ALTER TABLE "Collaborator" ADD COLUMN "retentionHold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Collaborator" ADD COLUMN "retentionHoldReason" TEXT;
ALTER TABLE "Collaborator" ADD COLUMN "retentionHoldSetAt" TIMESTAMP(3);
