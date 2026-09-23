-- Remove a etapa "Pronto para mobilizar": a Preparação passa a ir direto para a Mobilização (ou, na Sede, para
-- a Execução) quando o gate de mobilização está limpo, sem autorização manual separada.

-- Nenhum projeto deveria estar parado nessa etapa, mas o backfill evita que dados antigos impeçam a troca de
-- enum: seguem para Mobilização, a etapa seguinte do fluxo antigo.
UPDATE "ProjectWorkflow" SET "stage" = 'MOBILIZATION' WHERE "stage" = 'READY_TO_MOBILIZE';

ALTER TYPE "ProjectWorkflowStage" RENAME TO "ProjectWorkflowStage_old";
CREATE TYPE "ProjectWorkflowStage" AS ENUM ('HANDOVER', 'INITIAL_ANALYSIS', 'WAITING_PLANNING', 'MOBILIZATION_PLANNING', 'PREPARATION', 'MOBILIZATION', 'EXECUTION', 'DEMOBILIZATION', 'POST_JOB', 'FINAL_MEASUREMENT', 'FINISHED');
ALTER TABLE "ProjectWorkflow" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "ProjectWorkflow" ALTER COLUMN "stage" TYPE "ProjectWorkflowStage" USING ("stage"::text::"ProjectWorkflowStage");
ALTER TABLE "ProjectWorkflow" ALTER COLUMN "stage" SET DEFAULT 'HANDOVER';
DROP TYPE "ProjectWorkflowStage_old";

-- A autorização de mobilização manual deixou de existir: o gate de mobilização (reavaliado a cada consulta) é
-- quem libera a Mobilização/Execução agora. As colunas ficam sem uso, mas preservadas por valor histórico/auditoria.
