-- Categorias sensíveis podem permanecer disponíveis para administradores sem serem expostas
-- nas listas, filtros e totais consultados por outras contas.
ALTER TABLE "OmieCategory"
  ADD COLUMN "adminOnly" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "OmieCategory_adminOnly_idx" ON "OmieCategory"("adminOnly");
