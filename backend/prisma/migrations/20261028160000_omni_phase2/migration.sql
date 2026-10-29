-- Alterações aditivas. Sem eventos retroativos; legado recebe apenas datas conhecidas.
ALTER TABLE "Report" ADD COLUMN "submittedAt" TIMESTAMP(3), ADD COLUMN "signedAt" TIMESTAMP(3);
UPDATE "Report" r SET "submittedAt" = r."createdAt", "signedAt" = COALESCE(
  (SELECT max(a."createdAt") FROM "ReportAuditLog" a WHERE a."reportId" = r.id AND a.action::text = 'SIGNED'),
  r."zapsignSignedAt", r."physicalSignedAt") WHERE r.status::text = 'SIGNED';
UPDATE "Report" SET "submittedAt" = "createdAt" WHERE "submittedAt" IS NULL;
ALTER TABLE "Romaneio" ADD COLUMN "emittedAt" TIMESTAMP(3);
UPDATE "Romaneio" SET "emittedAt" = "createdAt" WHERE type::text = 'OUTBOUND' AND ("pdfUrl" IS NOT NULL OR "docxUrl" IS NOT NULL);
ALTER TABLE "QualityRecord" ADD COLUMN "actionOwnerUserId" TEXT, ADD COLUMN "externalRef" JSONB;
ALTER TABLE "QualityRecord" ADD CONSTRAINT "QualityRecord_actionOwnerUserId_fkey" FOREIGN KEY ("actionOwnerUserId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "QualityRecord_actionOwnerUserId_idx" ON "QualityRecord"("actionOwnerUserId");

CREATE TABLE "IntegrationEventSequence" (id INTEGER PRIMARY KEY, value BIGINT NOT NULL DEFAULT 0, CHECK (id = 1));
INSERT INTO "IntegrationEventSequence" (id) VALUES (1);
CREATE TABLE "IntegrationEvent" (
  id TEXT PRIMARY KEY, sequence BIGINT NOT NULL, type TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "projectId" TEXT, "projectCode" TEXT, resource TEXT NOT NULL, "resourceId" TEXT NOT NULL
);
CREATE UNIQUE INDEX "IntegrationEvent_sequence_key" ON "IntegrationEvent"(sequence);
CREATE INDEX "IntegrationEvent_occurredAt_idx" ON "IntegrationEvent"("occurredAt");
CREATE INDEX "IntegrationEvent_projectId_sequence_idx" ON "IntegrationEvent"("projectId", sequence);
CREATE INDEX "IntegrationEvent_type_sequence_idx" ON "IntegrationEvent"(type, sequence);
CREATE TABLE "IntegrationQualityReceipt" (
  "credentialId" TEXT NOT NULL, key TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "projectId" TEXT NOT NULL, response JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("credentialId", key),
  CONSTRAINT "IntegrationQualityReceipt_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ApiCredential"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "QualityRecordAuditLog" (
  id TEXT PRIMARY KEY, "recordId" TEXT NOT NULL, action TEXT NOT NULL, origin TEXT,
  "actorUserId" TEXT, "actorCredentialId" TEXT, "actorReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualityRecordAuditLog_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "QualityRecord"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QualityRecordAuditLog_actorCredentialId_fkey" FOREIGN KEY ("actorCredentialId") REFERENCES "ApiCredential"(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "QualityRecordAuditLog_recordId_createdAt_idx" ON "QualityRecordAuditLog"("recordId", "createdAt");

-- O bloqueio persiste até commit. nextval sozinho permitiria perda quando
-- uma transação com sequência menor confirma depois da leitura.
CREATE FUNCTION integration_emit(event_type TEXT, project_id TEXT, resource_type TEXT, resource_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE seq BIGINT; project_code TEXT;
BEGIN
  UPDATE "IntegrationEventSequence" SET value = value + 1 WHERE id = 1 RETURNING value INTO seq;
  SELECT code INTO project_code FROM "Project" WHERE id = project_id;
  INSERT INTO "IntegrationEvent" (id, sequence, type, "occurredAt", "projectId", "projectCode", resource, "resourceId")
  VALUES ('evt_' || gen_random_uuid()::text, seq, event_type, clock_timestamp() AT TIME ZONE 'UTC', project_id, project_code, resource_type, resource_id);
END $$;

CREATE FUNCTION integration_report_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."submittedAt" := COALESCE(NEW."submittedAt", NEW."createdAt", clock_timestamp() AT TIME ZONE 'UTC');
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW."updatedAt" := clock_timestamp() AT TIME ZONE 'UTC';
    IF NEW.status::text = 'PENDING' THEN NEW."submittedAt" := NEW."updatedAt"; END IF;
  ELSE RETURN NEW;
  END IF;
  IF NEW.status::text = 'SIGNED' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW."signedAt" IS NOT DISTINCT FROM OLD."signedAt" THEN NEW."signedAt" := clock_timestamp() AT TIME ZONE 'UTC'; END IF;
    END IF;
    NEW."signedAt" := COALESCE(NEW."signedAt", clock_timestamp() AT TIME ZONE 'UTC');
  END IF;
  IF NEW.status::text = 'APPROVED' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW."approvedAt" IS NOT DISTINCT FROM OLD."approvedAt" THEN NEW."approvedAt" := clock_timestamp() AT TIME ZONE 'UTC'; END IF;
    END IF;
    NEW."approvedAt" := COALESCE(NEW."approvedAt", clock_timestamp() AT TIME ZONE 'UTC');
  END IF;
  IF NEW.status::text = 'RETURNED' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW."returnedAt" IS NOT DISTINCT FROM OLD."returnedAt" THEN NEW."returnedAt" := clock_timestamp() AT TIME ZONE 'UTC'; END IF;
    END IF;
    NEW."returnedAt" := COALESCE(NEW."returnedAt", clock_timestamp() AT TIME ZONE 'UTC');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Report_integration_dates" BEFORE INSERT OR UPDATE ON "Report" FOR EACH ROW EXECUTE FUNCTION integration_report_dates();
CREATE FUNCTION integration_report_events() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_type TEXT;
BEGIN
  IF NEW."deletedAt" IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF; END IF;
  IF TG_OP = 'INSERT' OR NEW.status::text = 'PENDING' THEN
    PERFORM integration_emit('rdo.criado', NEW."projectId", 'rdo', NEW.id);
  END IF;
  event_type := CASE NEW.status::text WHEN 'APPROVED' THEN 'rdo.aprovado' WHEN 'RETURNED' THEN 'rdo.devolvido' WHEN 'SIGNED' THEN 'rdo.assinado' END;
  IF event_type IS NOT NULL THEN PERFORM integration_emit(event_type, NEW."projectId", 'rdo', NEW.id); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Report_integration_events" AFTER INSERT OR UPDATE ON "Report" FOR EACH ROW EXECUTE FUNCTION integration_report_events();

CREATE FUNCTION integration_workflow_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM integration_emit('workflow.etapa_alterada', NEW."projectId", 'workflow', NEW.id);
    IF NEW."leaderUserId" IS NOT NULL OR NEW."plannerUserId" IS NOT NULL THEN
      PERFORM integration_emit('projeto.responsaveis_alterados', NEW."projectId", 'projeto', NEW."projectId");
    END IF;
  ELSE
    IF OLD.stage IS DISTINCT FROM NEW.stage THEN PERFORM integration_emit('workflow.etapa_alterada', NEW."projectId", 'workflow', NEW.id); END IF;
    IF OLD."leaderUserId" IS DISTINCT FROM NEW."leaderUserId" OR OLD."plannerUserId" IS DISTINCT FROM NEW."plannerUserId" THEN
      PERFORM integration_emit('projeto.responsaveis_alterados', NEW."projectId", 'projeto', NEW."projectId");
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProjectWorkflow_integration_events" AFTER INSERT OR UPDATE ON "ProjectWorkflow" FOR EACH ROW EXECUTE FUNCTION integration_workflow_events();
CREATE FUNCTION integration_project_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."operatorId" IS NULL THEN RETURN NEW; END IF;
  ELSIF OLD."operatorId" IS NOT DISTINCT FROM NEW."operatorId" THEN RETURN NEW;
  END IF;
  PERFORM integration_emit('projeto.responsaveis_alterados', NEW.id, 'projeto', NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER "Project_integration_events" AFTER INSERT OR UPDATE ON "Project" FOR EACH ROW EXECUTE FUNCTION integration_project_events();

-- Um registro pode mudar junto com várias evidências na mesma transação.
-- A marca local evita duplicar o evento/auditoria e não sobrevive ao commit.
CREATE FUNCTION integration_quality_change(record_id TEXT, project_id TEXT, event_type TEXT, audit_action TEXT, record_origin TEXT, actor_id TEXT, evidence_change BOOLEAN DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE credential_id TEXT; marker TEXT;
BEGIN
  marker := 'app.integration_quality_' || md5(record_id);
  IF current_setting(marker, true) = event_type OR (evidence_change AND NULLIF(current_setting(marker, true), '') IS NOT NULL) THEN RETURN; END IF;
  PERFORM set_config(marker, event_type, true);
  PERFORM integration_emit(event_type, project_id, 'qualidade', record_id);
  credential_id := NULLIF(current_setting('app.integration_credential_id', true), '');
  INSERT INTO "QualityRecordAuditLog" (id, "recordId", action, origin, "actorUserId", "actorCredentialId", "actorReference")
  VALUES (gen_random_uuid()::text, record_id, audit_action, record_origin,
    CASE WHEN credential_id IS NULL THEN actor_id END, credential_id, COALESCE(credential_id, actor_id));
END $$;
CREATE FUNCTION integration_quality_events() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_id TEXT; audit_action TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(OLD) - 'updatedAt') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'updatedAt') THEN RETURN NEW; END IF;
    audit_action := CASE WHEN OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt" AND NEW."deletedAt" IS NOT NULL THEN 'DELETED' ELSE 'UPDATED' END;
    actor_id := CASE WHEN audit_action = 'DELETED' THEN NEW."deletedById" ELSE NEW."updatedById" END;
    PERFORM integration_quality_change(NEW.id, NEW."projectId", 'qualidade.alterado', audit_action, NEW.origin, actor_id);
  ELSE
    PERFORM integration_quality_change(NEW.id, NEW."projectId", 'qualidade.criado', 'CREATED', NEW.origin, NEW."createdById");
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "QualityRecord_integration_events" AFTER INSERT OR UPDATE ON "QualityRecord" FOR EACH ROW EXECUTE FUNCTION integration_quality_events();
CREATE FUNCTION integration_quality_evidence_events() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE record_row "QualityRecord"%ROWTYPE; record_id TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN record_id := OLD."recordId"; ELSE record_id := NEW."recordId"; END IF;
  SELECT * INTO record_row FROM "QualityRecord" WHERE id = record_id;
  IF FOUND THEN
    PERFORM integration_quality_change(record_row.id, record_row."projectId", 'qualidade.alterado', 'UPDATED', record_row.origin, record_row."updatedById", true);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "QualityEvidence_integration_events" AFTER INSERT OR UPDATE OR DELETE ON "QualityEvidence" FOR EACH ROW EXECUTE FUNCTION integration_quality_evidence_events();

CREATE FUNCTION integration_romaneio_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN NEW."emittedAt" := OLD."emittedAt"; END IF;
  IF NEW.type::text = 'OUTBOUND' AND NEW."emittedAt" IS NULL AND (NEW."pdfUrl" IS NOT NULL OR NEW."docxUrl" IS NOT NULL) THEN
    NEW."emittedAt" := clock_timestamp() AT TIME ZONE 'UTC';
    PERFORM integration_emit('romaneio.emitido', NEW."projectId", 'romaneio', NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Romaneio_integration_events" BEFORE INSERT OR UPDATE ON "Romaneio" FOR EACH ROW EXECUTE FUNCTION integration_romaneio_dates();
