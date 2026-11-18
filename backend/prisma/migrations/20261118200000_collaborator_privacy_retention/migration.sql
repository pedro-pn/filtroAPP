-- LGPD: marca de anonimização por retenção e exceções (legal hold) em tabela própria.
ALTER TABLE "Collaborator" ADD COLUMN "privacyAnonymizedAt" TIMESTAMP(3);

CREATE TABLE "DataRetentionHold" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "setByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataRetentionHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataRetentionHold_kind_targetId_key" ON "DataRetentionHold"("kind", "targetId");

-- Mantém a nova tabela no contrato compartilhado de revisão de leituras derivadas.
CREATE TRIGGER performance_read_revision
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public."DataRetentionHold"
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_performance_read_revision();
