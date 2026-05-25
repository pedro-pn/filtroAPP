ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

UPDATE "User"
SET "emailVerifiedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
WHERE "email" IS NOT NULL
  AND "accountType" IN ('ADMIN', 'INTERNAL')
  AND POSITION('@' IN "username") > 0
  AND lower(trim("email")) = lower(trim("username"));

UPDATE "User"
SET "clientCnpj" = regexp_replace("username", '\D', '', 'g')
WHERE "accountType" = 'CLIENT'
  AND regexp_replace("username", '\D', '', 'g') ~ '^[0-9]{14}$'
  AND ("clientCnpj" IS NULL OR "clientCnpj" = '');
