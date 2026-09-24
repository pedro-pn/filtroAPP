-- Fluxo legado resumido: projetos que já vinham do Efetivo antigo (com EfetivoMissionPlan, sem ProjectWorkflow)
-- podem iniciar a gestão direto numa etapa a partir da Mobilização, pulando o handover/análise/planejamento.
-- Esta coluna guarda a etapa de nascimento para tratar as etapas anteriores como "não se aplica" (régua de
-- etapas e gate de mobilização), em vez de pendência real. Nula em todo projeto que passou pelo handover normal.
ALTER TABLE "ProjectWorkflow" ADD COLUMN "legacySummaryEntryStage" "ProjectWorkflowStage";
