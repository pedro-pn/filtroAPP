-- Enquanto não existe integração com o CRM, as datas comerciais estimadas (mobilização/início) são digitadas
-- manualmente; este campo guarda a confirmação (ou correção) de cada uma no D-15, antes da mobilização.
ALTER TABLE "ProjectWorkflow" ADD COLUMN "commercialScheduleConfirmation" JSONB NOT NULL DEFAULT '{}';
