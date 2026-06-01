DO $$
DECLARE
  account_record RECORD;
  project_record RECORD;
  cc_email TEXT;
  normalized_email TEXT;
  signer JSONB;
  signer_email TEXT;
  next_primary TEXT;
  next_cc TEXT[];
  next_signers JSONB[];
  seen_signer_emails TEXT[];
  changed BOOLEAN;
BEGIN
  FOR account_record IN
    SELECT u.id, lower(u.username) AS old_email, lower(u.email) AS new_email
    FROM "User" u
    WHERE u.email IS NOT NULL
      AND u.username ILIKE '%@%'
      AND lower(u.username) <> lower(u.email)
      AND NOT EXISTS (
        SELECT 1
        FROM "User" conflicting_user
        WHERE conflicting_user.id <> u.id
          AND (
            lower(conflicting_user.username) = lower(u.email)
            OR lower(COALESCE(conflicting_user.email, '')) = lower(u.email)
          )
      )
  LOOP
    FOR project_record IN
      SELECT id, "clientEmailPrimary", "clientEmailCc", "clientSigners"
      FROM "Project"
      WHERE lower("clientEmailPrimary") = account_record.old_email
        OR EXISTS (
          SELECT 1
          FROM unnest("clientEmailCc") AS cc_item(email)
          WHERE lower(cc_item.email) = account_record.old_email
        )
        OR EXISTS (
          SELECT 1
          FROM unnest("clientSigners") AS signer_item(value)
          WHERE lower(signer_item.value->>'email') = account_record.old_email
        )
    LOOP
      changed := false;
      next_primary := COALESCE(project_record."clientEmailPrimary", '');

      IF lower(next_primary) = account_record.old_email THEN
        next_primary := account_record.new_email;
        changed := true;
      END IF;

      next_cc := ARRAY[]::TEXT[];
      FOREACH cc_email IN ARRAY COALESCE(project_record."clientEmailCc", ARRAY[]::TEXT[]) LOOP
        normalized_email := lower(btrim(COALESCE(cc_email, '')));
        IF normalized_email = account_record.old_email THEN
          normalized_email := account_record.new_email;
          changed := true;
        ELSIF normalized_email <> COALESCE(cc_email, '') THEN
          changed := true;
        END IF;

        IF normalized_email <> ''
          AND normalized_email <> lower(next_primary)
          AND NOT normalized_email = ANY(next_cc)
        THEN
          next_cc := array_append(next_cc, normalized_email);
        ELSE
          changed := true;
        END IF;
      END LOOP;

      next_signers := ARRAY[]::JSONB[];
      seen_signer_emails := ARRAY[]::TEXT[];
      FOREACH signer IN ARRAY COALESCE(project_record."clientSigners", ARRAY[]::JSONB[]) LOOP
        IF jsonb_typeof(signer) <> 'object' THEN
          next_signers := array_append(next_signers, signer);
          CONTINUE;
        END IF;

        signer_email := lower(btrim(COALESCE(signer->>'email', '')));
        IF signer_email = account_record.old_email THEN
          signer_email := account_record.new_email;
          changed := true;
        ELSIF signer_email <> COALESCE(signer->>'email', '') THEN
          changed := true;
        END IF;

        IF signer_email = ''
          OR signer_email = lower(next_primary)
          OR signer_email = ANY(seen_signer_emails)
        THEN
          changed := true;
          CONTINUE;
        END IF;

        seen_signer_emails := array_append(seen_signer_emails, signer_email);
        next_signers := array_append(next_signers, jsonb_set(signer, '{email}', to_jsonb(signer_email), true));
      END LOOP;

      IF changed
        OR next_primary IS DISTINCT FROM project_record."clientEmailPrimary"
        OR next_cc IS DISTINCT FROM project_record."clientEmailCc"
        OR next_signers IS DISTINCT FROM project_record."clientSigners"
      THEN
        UPDATE "Project"
        SET
          "clientEmailPrimary" = next_primary,
          "clientEmailCc" = next_cc,
          "clientSigners" = next_signers,
          "updatedAt" = NOW()
        WHERE id = project_record.id;
      END IF;
    END LOOP;

    UPDATE "User"
    SET
      username = account_record.new_email,
      "updatedAt" = NOW()
    WHERE id = account_record.id
      AND lower(username) = account_record.old_email
      AND lower(email) = account_record.new_email
      AND NOT EXISTS (
        SELECT 1
        FROM "User" conflicting_user
        WHERE conflicting_user.id <> account_record.id
          AND (
            lower(conflicting_user.username) = account_record.new_email
            OR lower(COALESCE(conflicting_user.email, '')) = account_record.new_email
          )
      );
  END LOOP;
END $$;
