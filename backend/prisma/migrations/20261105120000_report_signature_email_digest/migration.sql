BEGIN;

-- A group is mutable only until its first delivery attempt. Once claimed, its
-- contents stay fixed so saved recipient receipts remain valid on retries.
CREATE UNIQUE INDEX "ReportEmailJob_pending_signature_group_idx"
  ON "ReportEmailJob" (kind, (payload->>'projectId'), (coalesce(payload->>'recipientEmail', '')))
  WHERE status = 'PENDING' AND attempts = 0
    AND kind IN ('SIGNATURE_NOTICE', 'SIGNED_COPY') AND payload ? 'signatures';

CREATE FUNCTION enqueue_report_signature_email_group(
  job_id TEXT, email_kind TEXT, project_id TEXT, recipient_email TEXT, signature_event JSONB
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ReportEmailJob" WHERE id = job_id) THEN RETURN; END IF;
  INSERT INTO "ReportEmailJob" (id, kind, payload, "nextAttemptAt")
    VALUES (job_id, email_kind, jsonb_build_object(
      'projectId', project_id, 'recipientEmail', recipient_email,
      'signatures', jsonb_build_array(signature_event)
    ), clock_timestamp() + interval '10 minutes')
    ON CONFLICT (kind, (payload->>'projectId'), (coalesce(payload->>'recipientEmail', '')))
      WHERE status = 'PENDING' AND attempts = 0
        AND kind IN ('SIGNATURE_NOTICE', 'SIGNED_COPY') AND payload ? 'signatures'
    DO UPDATE SET
      payload = jsonb_set("ReportEmailJob".payload, '{signatures}',
        ("ReportEmailJob".payload->'signatures') || (EXCLUDED.payload->'signatures')),
      "nextAttemptAt" = greatest("ReportEmailJob"."nextAttemptAt", clock_timestamp() + interval '10 minutes'),
      "updatedAt" = clock_timestamp()
    WHERE NOT (("ReportEmailJob".payload->'signatures') @> (EXCLUDED.payload->'signatures'));
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_report_signature_email() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  project_id TEXT;
  report_type TEXT;
  signature_event JSONB;
BEGIN
  IF NEW.status::text = 'SIGNED' AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'SIGNED') THEN
    SELECT "projectId", "reportType"::text INTO project_id, report_type FROM "Report" WHERE id = NEW."reportId";
    signature_event := jsonb_build_object('signatureId', NEW.id,
      'signedAt', to_char(NEW."signedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    PERFORM enqueue_report_signature_email_group(
      'signature-notice:' || NEW.id || ':' || NEW."signedAt"::text,
      'SIGNATURE_NOTICE', project_id, '', signature_event);
    IF report_type = 'RDO' THEN
      PERFORM enqueue_report_signature_email_group(
        'signed-copy:' || NEW.id || ':' || NEW."signedAt"::text,
        'SIGNED_COPY', project_id, lower(btrim(NEW."signerEmail")), signature_event);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Consolidate unsent legacy intents too. Never change jobs that a worker has
-- already attempted: those may have durable receipts for some recipients.
DO $$
DECLARE legacy RECORD;
BEGIN
  FOR legacy IN
    DELETE FROM "ReportEmailJob" j USING "ReportSignature" s, "Report" r
      WHERE j.kind IN ('SIGNATURE_NOTICE', 'SIGNED_COPY')
        AND j.status = 'PENDING' AND j.attempts = 0 AND cardinality(j."deliveredKeys") = 0
        AND NOT (j.payload ? 'signatures')
        AND s.id = j.payload->>'signatureId' AND r.id = s."reportId"
      RETURNING j.id, j.kind, j.payload, r."projectId", s."signerEmail"
  LOOP
    PERFORM enqueue_report_signature_email_group(legacy.id, legacy.kind, legacy."projectId",
      CASE WHEN legacy.kind = 'SIGNED_COPY' THEN lower(btrim(legacy."signerEmail")) ELSE '' END,
      legacy.payload);
  END LOOP;
END;
$$;

COMMIT;
