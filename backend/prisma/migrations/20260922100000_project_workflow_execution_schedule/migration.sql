-- Previsão operacional de início e fim da execução, definida na análise inicial e refletida na definição da equipe.
ALTER TABLE "ProjectWorkflow"
ADD COLUMN "plannedExecutionStartDate" DATE,
ADD COLUMN "plannedExecutionEndDate" DATE;
