ALTER TABLE "Project"
ADD COLUMN "clientEmailPrimary" TEXT NOT NULL DEFAULT '',
ADD COLUMN "clientEmailCc" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Project"
SET "clientCnpj" = regexp_replace(coalesce("clientCnpj", ''), '\D', '', 'g');
