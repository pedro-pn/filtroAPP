-- Propostas adicionais do banco comercial: quando preenchida, a coluna parentCodProp aponta para a proposta principal.
ALTER TABLE "CommercialProposal" ADD COLUMN "parentCodProp" INTEGER;

CREATE INDEX "CommercialProposal_parentCodProp_codProp_nRev_idx"
  ON "CommercialProposal"("parentCodProp", "codProp", "nRev");

CREATE TABLE "ProjectAdditionalProposal" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "codProp" INTEGER NOT NULL,
  "sourceProposalCodBd" INTEGER NOT NULL,
  "selectedByUserId" TEXT,
  "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectAdditionalProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectAdditionalProposal_projectId_codProp_key"
  ON "ProjectAdditionalProposal"("projectId", "codProp");

CREATE INDEX "ProjectAdditionalProposal_projectId_idx"
  ON "ProjectAdditionalProposal"("projectId");

CREATE INDEX "ProjectAdditionalProposal_sourceProposalCodBd_idx"
  ON "ProjectAdditionalProposal"("sourceProposalCodBd");

CREATE INDEX "ProjectAdditionalProposal_selectedByUserId_idx"
  ON "ProjectAdditionalProposal"("selectedByUserId");

ALTER TABLE "ProjectAdditionalProposal"
  ADD CONSTRAINT "ProjectAdditionalProposal_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectAdditionalProposal"
  ADD CONSTRAINT "ProjectAdditionalProposal_selectedByUserId_fkey"
  FOREIGN KEY ("selectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
