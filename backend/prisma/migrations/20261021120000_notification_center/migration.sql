CREATE TABLE "NotificationEvent" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "reportId" TEXT,
  "data" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationEvent_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NotificationEvent_dedupeKey_key" ON "NotificationEvent"("dedupeKey");
CREATE INDEX "NotificationEvent_createdAt_id_idx" ON "NotificationEvent"("createdAt", "id");
CREATE INDEX "NotificationEvent_projectId_kind_idx" ON "NotificationEvent"("projectId", "kind");
CREATE INDEX "NotificationEvent_reportId_idx" ON "NotificationEvent"("reportId");

CREATE TABLE "NotificationRead" (
  "userId" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("userId", "notificationId"),
  CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "NotificationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "NotificationRead_notificationId_idx" ON "NotificationRead"("notificationId");

-- Triggers cobrem a interface, webhooks, importações e workers na mesma transação.
-- Não há backfill: a implantação começa a registrar novos acontecimentos.
CREATE FUNCTION notification_center_project() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_kind TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_kind := CASE WHEN NEW."registrationPending" THEN 'PROJECT_RECEIVED' ELSE 'PROJECT_CREATED' END;
  ELSIF OLD."registrationPending" AND NOT NEW."registrationPending" THEN
    event_kind := 'PROJECT_READY';
  ELSE RETURN NEW;
  END IF;
  IF NEW."deletedAt" IS NULL THEN
    INSERT INTO "NotificationEvent" ("id", "kind", "dedupeKey", "projectId", "createdAt")
    VALUES (gen_random_uuid()::text, event_kind, event_kind || ':' || NEW."id", NEW."id", clock_timestamp() AT TIME ZONE 'UTC')
    ON CONFLICT ("dedupeKey") DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Project_notification_center" AFTER INSERT OR UPDATE OF "registrationPending" ON "Project"
FOR EACH ROW EXECUTE FUNCTION notification_center_project();

CREATE FUNCTION notification_center_report() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_kind TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."projectId" IS DISTINCT FROM NEW."projectId" THEN
    UPDATE "NotificationEvent" SET "projectId" = NEW."projectId" WHERE "reportId" = NEW."id";
  END IF;
  IF NEW."deletedAt" IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" IS NOT DISTINCT FROM NEW."status" THEN RETURN NEW; END IF;
  END IF;
  event_kind := CASE NEW."status"::text WHEN 'PENDING' THEN 'REPORT_PENDING' WHEN 'RETURNED' THEN 'REPORT_RETURNED' ELSE NULL END;
  IF event_kind IS NOT NULL THEN
    -- Uma nova rodada substitui o aviso anterior do mesmo estado e volta a ser não lida.
    DELETE FROM "NotificationEvent" WHERE "reportId" = NEW."id" AND "kind" = event_kind;
    INSERT INTO "NotificationEvent" ("id", "kind", "dedupeKey", "projectId", "reportId", "createdAt")
    VALUES (gen_random_uuid()::text, event_kind, gen_random_uuid()::text, NEW."projectId", NEW."id", clock_timestamp() AT TIME ZONE 'UTC');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Report_notification_center" AFTER INSERT OR UPDATE OF "status", "projectId" ON "Report"
FOR EACH ROW EXECUTE FUNCTION notification_center_report();

CREATE FUNCTION notification_center_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_key TEXT; event_data JSONB;
BEGIN
  IF TG_TABLE_NAME = 'CommercialAppProposal' THEN
    IF NEW."proposalKind" <> 'ADDITIONAL' THEN RETURN NEW; END IF;
    event_key := 'proposal:COMERCIAL_APP:' || NEW."id";
    event_data := jsonb_build_object('proposalCode', NEW."proposalCode", 'revision', NEW."revisionNumber");
  ELSE
    -- O recebimento do ComercialApp já foi registrado, inclusive quando aguarda seleção.
    IF NEW."source" <> 'ACCESS_IMPORT' OR NOT NEW."active" THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' THEN
      IF OLD."active" AND OLD."sourceProposalCodBd" IS NOT DISTINCT FROM NEW."sourceProposalCodBd" THEN RETURN NEW; END IF;
    END IF;
    event_key := 'proposal:ACCESS_IMPORT:' || NEW."id" || ':' || COALESCE(NEW."sourceProposalCodBd"::text, '0');
    event_data := jsonb_build_object('proposalCode', NEW."proposalCode");
  END IF;
  INSERT INTO "NotificationEvent" ("id", "kind", "dedupeKey", "projectId", "data", "createdAt")
  VALUES (gen_random_uuid()::text, 'PROPOSAL_RECEIVED', event_key, NEW."projectId", event_data, clock_timestamp() AT TIME ZONE 'UTC')
  ON CONFLICT ("dedupeKey") DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER "CommercialAppProposal_notification_center" AFTER INSERT ON "CommercialAppProposal"
FOR EACH ROW EXECUTE FUNCTION notification_center_proposal();
CREATE TRIGGER "ProjectAdditionalProposal_notification_center" AFTER INSERT OR UPDATE ON "ProjectAdditionalProposal"
FOR EACH ROW EXECUTE FUNCTION notification_center_proposal();
