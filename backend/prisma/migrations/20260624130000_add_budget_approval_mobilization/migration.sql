-- Data de aprovação do contrato (no ato da seleção, editável) + prazo de mobilização (prev_atende)

ALTER TABLE "CommercialProposal" ADD COLUMN "mobilizationLeadDays" INTEGER;

ALTER TABLE "ProjectBudget" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "ProjectBudget" ADD COLUMN "mobilizationLeadDays" INTEGER;
