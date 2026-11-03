-- B6: apenas gatilhos aditivos, sem eventos retroativos ou alterações de tokens.
CREATE FUNCTION integration_weekly_target_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data RECORD; member RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN row_data := OLD; ELSE row_data := NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(OLD."projectId", OLD."groupId", OLD."weekStartDate", OLD."plannedPctPoints", OLD.definition, OLD."isDeleted", OLD.revision)
      IS NOT DISTINCT FROM ROW(NEW."projectId", NEW."groupId", NEW."weekStartDate", NEW."plannedPctPoints", NEW.definition, NEW."isDeleted", NEW.revision)
      THEN RETURN NEW; END IF;
  END IF;
  IF row_data."projectId" IS NOT NULL THEN
    PERFORM integration_emit('acompanhamento.meta_alterada', row_data."projectId", 'meta_semanal', row_data.id);
  ELSE
    FOR member IN SELECT m."projectId" FROM "AcompanhamentoMissionGroupMember" m
      JOIN "AcompanhamentoMissionGroup" g ON g.id = m."groupId"
      WHERE m."groupId" = row_data."groupId" AND m."activeProjectId" IS NOT NULL AND g.status::text = 'ACTIVE'
    LOOP
      PERFORM integration_emit('acompanhamento.meta_alterada', member."projectId", 'meta_semanal', row_data.id);
    END LOOP;
  END IF;
  RETURN row_data;
END $$;
CREATE TRIGGER "WeeklyTarget_integration_change" AFTER INSERT OR UPDATE OR DELETE ON "MissionWeeklyProgressTarget"
  FOR EACH ROW EXECUTE FUNCTION integration_weekly_target_change();

CREATE FUNCTION integration_review_is_complete(checks JSONB, completed_at TIMESTAMP) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT completed_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['PROGRESS','SERVICE_FRONTS','DIFFICULTIES','DEVIATIONS_INCIDENTS','REPORT_DELIVERY','REPORT_SIGNATURES']) key
      WHERE (checks -> key) IS DISTINCT FROM 'true'::jsonb
  ) AND (NOT COALESCE(checks ? 'WEEKLY_TARGET', false) OR checks -> 'WEEKLY_TARGET' = 'true'::jsonb)
$$;
CREATE FUNCTION integration_weekly_review_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT integration_review_is_complete(NEW.checks, NEW."completedAt") THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF integration_review_is_complete(OLD.checks, OLD."completedAt") AND OLD."completedAt" IS NOT DISTINCT FROM NEW."completedAt"
      THEN RETURN NEW; END IF;
  END IF;
  PERFORM integration_emit('acompanhamento.revisao_concluida', NEW."projectId", 'revisao_semanal', NEW."projectId" || '/' || NEW."weekStartDate"::text);
  RETURN NEW;
END $$;
CREATE TRIGGER "WeeklyReview_integration_change" AFTER INSERT OR UPDATE ON "ProjectExecutionWeeklyReview"
  FOR EACH ROW EXECUTE FUNCTION integration_weekly_review_change();

CREATE FUNCTION integration_allocation_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data RECORD; project_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN row_data := OLD; ELSE row_data := NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(OLD."missionId",OLD."collaboratorId",OLD."jobRoleNameSnapshot",OLD."mobilizationDate",OLD."demobilizationDate",OLD."deletedAt")
      IS NOT DISTINCT FROM ROW(NEW."missionId",NEW."collaboratorId",NEW."jobRoleNameSnapshot",NEW."mobilizationDate",NEW."demobilizationDate",NEW."deletedAt")
      THEN RETURN NEW; END IF;
  END IF;
  SELECT m."projectId" INTO project_id FROM "EfetivoMissionPlan" m JOIN "EfetivoPlan" p ON p.id = m."planId"
    WHERE m.id = row_data."missionId" AND m."deletedAt" IS NULL AND m."scheduleStatus"::text = 'CONFIRMED'
      AND p.kind::text = 'OFFICIAL' AND p.status::text = 'ACTIVE';
  IF project_id IS NOT NULL THEN
    PERFORM integration_emit('alocacao.alterada', project_id, 'alocacao', row_data.id);
  END IF;
  RETURN row_data;
END $$;
CREATE TRIGGER "Allocation_integration_change" AFTER INSERT OR UPDATE OR DELETE ON "EfetivoMissionAllocation"
  FOR EACH ROW EXECUTE FUNCTION integration_allocation_change();
