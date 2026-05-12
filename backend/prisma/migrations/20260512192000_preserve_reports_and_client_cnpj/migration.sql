-- Preserve report records and client account grouping metadata.
ALTER TABLE "Project" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Project_deletedAt_idx" ON "Project"("deletedAt");

ALTER TABLE "Report" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Report_deletedAt_idx" ON "Report"("deletedAt");

ALTER TABLE "User" ADD COLUMN "clientCnpj" TEXT;

UPDATE "User"
SET "clientCnpj" = "username"
WHERE "role" = 'CLIENT'
  AND "username" ~ '^[0-9]{14}$';

UPDATE "User" AS u
SET "clientCnpj" = p."clientCnpj"
FROM "Project" AS p
WHERE u."role" = 'CLIENT'
  AND u."clientCnpj" IS NULL
  AND EXISTS (
    SELECT 1
    FROM unnest(p."clientEmailCc") AS cc(email)
    WHERE lower(cc.email) = lower(coalesce(u."email", u."username"))
  );

CREATE INDEX "User_clientCnpj_idx" ON "User"("clientCnpj");

ALTER TABLE "Report" DROP CONSTRAINT "Report_projectId_fkey";
ALTER TABLE "Report"
  ADD CONSTRAINT "Report_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
