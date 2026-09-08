-- Preserva o histórico da equipe quando apenas uma pessoa entra ou sai da missão.
-- Datas nulas continuam herdando o período geral da missão para manter compatibilidade
-- com as alocações existentes.
ALTER TABLE "EfetivoMissionAllocation"
  ADD COLUMN "mobilizationDate" DATE,
  ADD COLUMN "demobilizationDate" DATE,
  ADD COLUMN "allowMissionOverlap" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "EfetivoMissionAllocation_collaboratorId_mobilizationDat_idx"
  ON "EfetivoMissionAllocation"("collaboratorId", "mobilizationDate", "demobilizationDate", "deletedAt");
