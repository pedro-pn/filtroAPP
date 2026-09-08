-- Missões e colaboradores podem interromper o trabalho e voltar ao mesmo projeto.
-- Os campos legados permanecem como envelope de compatibilidade; os ciclos passam
-- a ser a fonte de verdade para os dias efetivamente mobilizados.
CREATE TABLE "EfetivoMissionCycle" (
  "id" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "mobilizationDate" DATE NOT NULL,
  "demobilizationDate" DATE,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EfetivoMissionCycle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EfetivoMissionCycle_missionId_fkey"
    FOREIGN KEY ("missionId") REFERENCES "EfetivoMissionPlan"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "EfetivoAllocationCycle" (
  "id" TEXT NOT NULL,
  "allocationId" TEXT NOT NULL,
  "mobilizationDate" DATE NOT NULL,
  "demobilizationDate" DATE,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EfetivoAllocationCycle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EfetivoAllocationCycle_allocationId_fkey"
    FOREIGN KEY ("allocationId") REFERENCES "EfetivoMissionAllocation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EfetivoMissionCycle_missionId_mobilizationDate_key"
  ON "EfetivoMissionCycle"("missionId", "mobilizationDate");
CREATE INDEX "EfetivoMissionCycle_missionId_mobilizationDate_demobilizationDate_idx"
  ON "EfetivoMissionCycle"("missionId", "mobilizationDate", "demobilizationDate");
CREATE UNIQUE INDEX "EfetivoAllocationCycle_allocationId_mobilizationDate_key"
  ON "EfetivoAllocationCycle"("allocationId", "mobilizationDate");
CREATE INDEX "EfetivoAllocationCycle_allocationId_mobilizationDate_demobilizationDate_idx"
  ON "EfetivoAllocationCycle"("allocationId", "mobilizationDate", "demobilizationDate");

-- Mantém exatamente a janela que o sistema utilizava antes desta migração.
INSERT INTO "EfetivoMissionCycle" (
  "id", "missionId", "mobilizationDate", "demobilizationDate", "createdByUserId", "createdAt", "updatedAt"
)
SELECT
  'legacy-mission-' || "id",
  "id",
  "mobilizationDate",
  COALESCE("returnDate", "executionEndDate"),
  "createdByUserId",
  "createdAt",
  CURRENT_TIMESTAMP
FROM "EfetivoMissionPlan";

-- Datas individuais nulas continuavam herdando a missão. Somente alocações que já
-- tinham alguma personalização precisam de ciclo próprio; as demais herdam todos
-- os ciclos do projeto, inclusive os que forem adicionados no futuro.
INSERT INTO "EfetivoAllocationCycle" (
  "id", "allocationId", "mobilizationDate", "demobilizationDate", "createdByUserId", "createdAt", "updatedAt"
)
SELECT
  'legacy-allocation-' || allocation."id",
  allocation."id",
  COALESCE(allocation."mobilizationDate", mission."mobilizationDate"),
  COALESCE(allocation."demobilizationDate", mission."returnDate", mission."executionEndDate"),
  allocation."createdByUserId",
  allocation."createdAt",
  CURRENT_TIMESTAMP
FROM "EfetivoMissionAllocation" allocation
JOIN "EfetivoMissionPlan" mission ON mission."id" = allocation."missionId"
WHERE allocation."mobilizationDate" IS NOT NULL
   OR allocation."demobilizationDate" IS NOT NULL;
