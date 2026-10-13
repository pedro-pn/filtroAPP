-- Uma proposta consultada antes do evento de aprovação não deve inventar aceite.
ALTER TABLE "CommercialAppProposal" ALTER COLUMN "approvedAt" DROP NOT NULL;

-- Completa somente buscas já concluídas pelo fluxo anterior. Projetos sem busca
-- e decisões manuais de orçamento/escopo permanecem preservados pelo worker.
UPDATE "Project" p
SET "commercialProposalSync" = p."commercialProposalSync" ||
      '{"status":"PENDING","attempts":0,"errorCode":null}'::jsonb,
    "commercialProposalSyncNextAttemptAt" = CURRENT_TIMESTAMP
WHERE p."isActive" = true AND p."deletedAt" IS NULL
  AND p."commercialProposalSync"->>'status' = 'SYNCED'
  AND p."commercialProposalSync"->>'requestId' IS NOT NULL
  AND p."commercialProposalSync"->>'commercialDataVersion' IS NULL
  AND NOT EXISTS (SELECT 1 FROM "ProjectWorkflow" w
    WHERE w."projectId" = p.id AND w.stage = 'FINISHED');
