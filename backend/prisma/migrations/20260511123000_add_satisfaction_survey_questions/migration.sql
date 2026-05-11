-- CreateTable
CREATE TABLE "SatisfactionSurveyQuestion" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SatisfactionSurveyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SatisfactionSurveyQuestion_isActive_order_idx" ON "SatisfactionSurveyQuestion"("isActive", "order");

-- Seed default questions using the legacy response keys.
INSERT INTO "SatisfactionSurveyQuestion" ("id", "label", "type", "options", "required", "order", "isActive", "updatedAt")
VALUES
  ('nps', 'Probabilidade de recomendar a Filtrovali', 'NPS', NULL, true, 1, true, CURRENT_TIMESTAMP),
  ('serviceQuality', 'Qualidade dos serviços prestados', 'SCALE', NULL, true, 2, true, CURRENT_TIMESTAMP),
  ('communication', 'Comunicação da equipe durante o projeto', 'SCALE', NULL, true, 3, true, CURRENT_TIMESTAMP),
  ('deadlines', 'Cumprimento de prazos', 'SCALE', NULL, true, 4, true, CURRENT_TIMESTAMP),
  ('documentation', 'Qualidade da documentação entregue', 'SCALE', NULL, true, 5, true, CURRENT_TIMESTAMP),
  ('improvement', 'O que podemos melhorar?', 'TEXT', NULL, false, 6, true, CURRENT_TIMESTAMP),
  ('highlight', 'Algo que gostaria de destacar?', 'TEXT', NULL, false, 7, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
