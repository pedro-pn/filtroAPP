-- Etiquetas do Ponto Mais que o gestor decidiu não cadastrar como projeto.
-- Saem das pendências e da contagem; remover a linha volta a cobrar o cadastro.
CREATE TABLE "PontoIgnoredProjectTag" (
  "normalizedTag"   TEXT NOT NULL,
  "rawTag"          TEXT NOT NULL,
  "ignoredByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PontoIgnoredProjectTag_pkey" PRIMARY KEY ("normalizedTag")
);

CREATE INDEX "PontoIgnoredProjectTag_createdAt_idx" ON "PontoIgnoredProjectTag"("createdAt");
