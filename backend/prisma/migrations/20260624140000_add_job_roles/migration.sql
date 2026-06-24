-- Lista gerenciável de cargos (JobRole) — substitui o texto livre em Collaborator.role

CREATE TABLE "JobRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobRole_name_key" ON "JobRole"("name");
CREATE INDEX "JobRole_isActive_order_idx" ON "JobRole"("isActive", "order");

-- Carga inicial dos cargos fornecidos
INSERT INTO "JobRole" ("id", "name", "order", "updatedAt") VALUES
  (gen_random_uuid()::text, 'Almoxarife', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Assistente de Operações', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Assistente de Operações II', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Assistente de Operações III', 4, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Assistente de Operações IV', 5, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Assistente de Produção', 6, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Assistente de Produção II', 7, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Assistente de Produção III', 8, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Assistente de Produção IV', 9, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Auxiliar de Produção', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Auxiliar de Produção II', 11, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Auxiliar de Produção III', 12, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Auxiliar de Produção IV', 13, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Coordenador(a) de Operações', 14, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Coordenador(a) de Operações II', 15, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Coordenador(a) de Operações III', 16, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Coordenador(a) de Operações IV', 17, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Encarregado(a) de Manutenção', 18, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Encarregado(a) de Operações', 19, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Encarregado(a) de Operações II', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Encarregado(a) de Operações III', 21, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Encarregado(a) de Operações IV', 22, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Encarregado(a) Técnico', 23, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Encarregado(a) Técnico II', 24, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Encarregado(a) Técnico III', 25, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Encarregado(a) Técnico IV', 26, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Especialista em Operações', 27, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Especialista em Operações II', 28, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Especialista em Operações III', 29, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Especialista em Operações IV', 30, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Especialista em Operações Pleno', 31, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Especialista em Operações Pleno II', 32, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Especialista em Operações Pleno III', 33, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Especialista em Operações Pleno IV', 34, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Especialista em Operações Senior', 35, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Especialista em Operações Senior II', 36, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Especialista em Operações Senior III', 37, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Especialista em Operações Senior IV', 38, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Gerente de Operação', 39, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Líder de Produção', 40, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Líder de Produção II', 41, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Líder de Produção III', 42, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Líder de Produção IV', 43, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Mantenedor I', 44, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Mantenedor II', 45, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Mantenedor III', 46, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Mantenedor IV', 47, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Químico Responsável', 48, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Supervisor de Operações', 49, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Supervisor de Operações II', 50, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Supervisor de Operações III', 51, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Supervisor de Operações IV', 52, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
