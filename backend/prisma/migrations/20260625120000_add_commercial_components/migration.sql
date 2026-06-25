-- Componentes de custo/preço da proposta (HE, stand-by, diárias, mobilização...) para filtros do dashboard

ALTER TABLE "CommercialProposal" ADD COLUMN "components" JSONB NOT NULL DEFAULT '{}';
