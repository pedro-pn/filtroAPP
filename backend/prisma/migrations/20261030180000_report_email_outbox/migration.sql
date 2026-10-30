-- Persist the delivery intent atomically with the business transition, even if
-- the HTTP process crashes immediately after committing a signature.
CREATE TABLE "ReportEmailJob" (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockToken" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "deliveredKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "lastError" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ReportEmailJob_status_nextAttemptAt_idx" ON "ReportEmailJob" (status, "nextAttemptAt");
CREATE INDEX "ReportEmailJob_status_lockedUntil_idx" ON "ReportEmailJob" (status, "lockedUntil");

CREATE FUNCTION enqueue_report_signature_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status::text = 'SIGNED' AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'SIGNED') THEN
    INSERT INTO "ReportEmailJob" (id, kind, payload)
      VALUES ('signature-notice:' || NEW.id || ':' || NEW."signedAt"::text, 'SIGNATURE_NOTICE',
        jsonb_build_object('signatureId', NEW.id, 'signedAt', to_char(NEW."signedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) ON CONFLICT DO NOTHING;
    IF EXISTS (SELECT 1 FROM "Report" WHERE id = NEW."reportId" AND "reportType"::text = 'RDO') THEN
      INSERT INTO "ReportEmailJob" (id, kind, payload)
        VALUES ('signed-copy:' || NEW.id || ':' || NEW."signedAt"::text, 'SIGNED_COPY',
          jsonb_build_object('signatureId', NEW.id, 'signedAt', to_char(NEW."signedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER report_signature_email_outbox AFTER INSERT OR UPDATE ON "ReportSignature"
  FOR EACH ROW EXECUTE FUNCTION enqueue_report_signature_email();

CREATE FUNCTION enqueue_report_release_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."reportType"::text = 'RDO' AND NEW.status::text = 'SIGNED'
    AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'SIGNED') THEN
    INSERT INTO "ReportEmailJob" (id, kind, payload)
      VALUES ('release-scan:' || NEW.id || ':' || NEW."updatedAt"::text, 'RELEASE_SCAN',
        jsonb_build_object('rdoId', NEW.id)) ON CONFLICT DO NOTHING;
  ELSIF NEW."reportType"::text <> 'RDO' AND NEW."specialConditions"->>'parentRdoId' IS NOT NULL THEN
    IF NEW."clientReleasedAt" IS NOT NULL AND NEW."clientReleasedAt" = NEW."updatedAt"
      AND (TG_OP = 'INSERT' OR OLD."clientReleasedAt" IS DISTINCT FROM NEW."clientReleasedAt") THEN
      INSERT INTO "ReportEmailJob" (id, kind, payload)
        VALUES ('service-release:' || NEW.id || ':' || (extract(epoch from NEW."updatedAt") * 1000)::bigint::text, 'MANUAL_RELEASE',
          jsonb_build_object('reportId', NEW.id, 'revision', to_char(NEW."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) ON CONFLICT DO NOTHING;
    ELSIF NEW.status::text IN ('APPROVED', 'SIGNED') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status
      OR OLD."updatedAt" IS DISTINCT FROM NEW."updatedAt") THEN
      INSERT INTO "ReportEmailJob" (id, kind, payload)
        VALUES ('release-scan:' || NEW.id || ':' || NEW."updatedAt"::text, 'RELEASE_SCAN',
          jsonb_build_object('rdoId', NEW."specialConditions"->>'parentRdoId')) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER report_release_email_outbox AFTER INSERT OR UPDATE ON "Report"
  FOR EACH ROW EXECUTE FUNCTION enqueue_report_release_email();
