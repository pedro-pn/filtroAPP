-- A participação na conferência é uma decisão local, independente do cargo e do RH.
-- O padrão preserva a participação de todos os colaboradores existentes.
ALTER TABLE "Collaborator" ADD COLUMN "allocationReviewEnabled" BOOLEAN NOT NULL DEFAULT true;
