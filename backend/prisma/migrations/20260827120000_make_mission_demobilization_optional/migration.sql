-- O antigo "retorno" passa a representar a desmobilização real e, portanto, é opcional.
ALTER TABLE "EfetivoMissionPlan"
  ALTER COLUMN "returnDate" DROP NOT NULL;

-- Datas antigas eram previsões de retorno. A fonte confiável para o fato já registrado é o projeto.
UPDATE "EfetivoMissionPlan" AS mission
SET "returnDate" = project."demobilizationDate"
FROM "Project" AS project
WHERE project."id" = mission."projectId";
