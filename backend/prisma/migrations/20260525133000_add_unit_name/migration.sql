ALTER TABLE "Unit" ADD COLUMN "name" TEXT;

UPDATE "Unit"
SET "name" = "code"
WHERE "name" IS NULL OR "name" = '';

ALTER TABLE "Unit" ALTER COLUMN "name" SET NOT NULL;
