CREATE TYPE "ApiWriteMode" AS ENUM ('LIVE', 'SIMULATE');
ALTER TABLE "ApiCredential" ADD COLUMN "writeMode" "ApiWriteMode" NOT NULL DEFAULT 'LIVE';
ALTER TABLE "ApiRequestLog" ADD COLUMN "simulated" BOOLEAN NOT NULL DEFAULT false;

-- ProjectWorkflow é identificado por projectId, não possui coluna id.
-- Preservar gatilhos/eventos em escritas reais e nas transações simuladas.
CREATE OR REPLACE FUNCTION integration_workflow_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM integration_emit('workflow.etapa_alterada', NEW."projectId", 'workflow', NEW."projectId");
    IF NEW."leaderUserId" IS NOT NULL OR NEW."plannerUserId" IS NOT NULL THEN
      PERFORM integration_emit('projeto.responsaveis_alterados', NEW."projectId", 'projeto', NEW."projectId");
    END IF;
  ELSE
    IF OLD.stage IS DISTINCT FROM NEW.stage THEN
      PERFORM integration_emit('workflow.etapa_alterada', NEW."projectId", 'workflow', NEW."projectId");
    END IF;
    IF OLD."leaderUserId" IS DISTINCT FROM NEW."leaderUserId" OR OLD."plannerUserId" IS DISTINCT FROM NEW."plannerUserId" THEN
      PERFORM integration_emit('projeto.responsaveis_alterados', NEW."projectId", 'projeto', NEW."projectId");
    END IF;
  END IF;
  RETURN NEW;
END $$;
