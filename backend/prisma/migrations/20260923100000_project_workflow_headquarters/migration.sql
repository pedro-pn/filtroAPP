-- Projetos executados na Sede não têm mobilização em campo. NULL = ainda não respondido
-- (projetos existentes continuam no fluxo de campo até o Líder responder na Análise inicial).
ALTER TABLE "ProjectWorkflow" ADD COLUMN "executedAtHeadquarters" BOOLEAN;
