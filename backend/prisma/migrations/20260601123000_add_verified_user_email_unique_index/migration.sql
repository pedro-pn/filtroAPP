DO $$
DECLARE
  duplicate_email TEXT;
BEGIN
  SELECT lower(btrim("email"))
  INTO duplicate_email
  FROM "User"
  WHERE "email" IS NOT NULL
    AND btrim("email") <> ''
    AND "emailVerifiedAt" IS NOT NULL
  GROUP BY lower(btrim("email"))
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF duplicate_email IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot create unique verified user email index: duplicate verified email %', duplicate_email;
  END IF;
END $$;

CREATE UNIQUE INDEX "User_verifiedEmail_lower_key"
ON "User" (lower(btrim("email")))
WHERE "email" IS NOT NULL
  AND btrim("email") <> ''
  AND "emailVerifiedAt" IS NOT NULL;
